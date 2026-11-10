"""Select an explicit WorkItem through an external terminal for ``w/`` prompts."""

from __future__ import annotations

import ctypes
import json
import os
import shlex
import signal
import subprocess
import sys
import time
from datetime import timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from .. import review_plans, runtime_binding, shared_paths, state_store, work_item_picker
from . import ups_recovery


SELECTION_TIMEOUT_SECONDS = 300
TERMINAL_FOCUS_FALLBACK_SECONDS = 5.0
TERMINAL_FOCUS_READY_DELAY_SECONDS = 0.15
TERMINAL_CLOSE_GRACE_SECONDS = 2.0
TERMINAL_CLOSE_POLL_SECONDS = 0.05
SELECTIONS_DIRECTORY_NAME = "selections"
WORK_PREFIX = "w/"


class HookInputError(ValueError):
    """Raised when a requested selection omits a required Hook identifier."""


class PickerWaitStatus(Enum):
    """Non-result outcomes while waiting for the external picker."""

    TERMINAL_CLOSED = "terminal_closed"


def _required_string(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise HookInputError(f"{field} must be a non-empty string")
    return value.strip()


def strip_work_prefix(prompt: str) -> str | None:
    """Remove a case-insensitive ``w/`` prefix, leaving the user's request."""

    if not prompt[: len(WORK_PREFIX)].lower() == WORK_PREFIX:
        return None
    return prompt[len(WORK_PREFIX) :].lstrip()


def _selection_directory(database_path: str | Path) -> Path:
    """Locate transient selection files in this worktree."""

    return state_store.PROJECT_ROOT / ".harness" / "runtime" / SELECTIONS_DIRECTORY_NAME


def _selection_packet(status: str, **fields: Any) -> dict[str, Any]:
    """Build the compact context Codex receives after a selection attempt."""

    return {"selection_status": status, **fields}


def _additional_context(packet: Mapping[str, Any]) -> str:
    return "<work-selection-context>\n" + json.dumps(
        packet, ensure_ascii=False, separators=(",", ":")
    ) + "\n</work-selection-context>"


def _hook_output(packet: Mapping[str, Any] | None = None) -> dict[str, Any]:
    output: dict[str, Any] = {"continue": True}
    if packet is not None:
        output["hookSpecificOutput"] = {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": _additional_context(packet),
        }
    return output


def write_selection_request(
    *, request_id: str, session_id: str, turn_id: str,
    work_items: list[Mapping[str, Any]], selections_directory: Path,
    timeout_seconds: int = SELECTION_TIMEOUT_SECONDS,
) -> Path:
    """Atomically create one picker request with all selectable WorkItems."""

    created_at = work_item_picker.utc_now()
    request_path = selections_directory / f"selection-{request_id}.request.json"
    payload = {
        "schema_version": work_item_picker.SCHEMA_VERSION,
        "request_id": request_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "created_at": work_item_picker.format_timestamp(created_at),
        "expires_at": work_item_picker.format_timestamp(
            created_at + timedelta(seconds=timeout_seconds)
        ),
        "work_items": [
            {
                "id": item["id"],
                "title": item["title"],
                "goal": item["goal"],
                "kind": item["kind"],
                "priority": item["priority"],
                "status": item["status"],
                "is_draft": bool(item["is_draft"]),
                "next_action": item["next_action"],
            }
            for item in work_items
        ],
    }
    work_item_picker.atomic_write_json(request_path, payload)
    return request_path


def launch_terminal_picker(request_path: Path) -> None:
    """Open the picker in its own Terminal.app instance."""

    project_root = shlex.quote(str(state_store.PROJECT_ROOT))
    request = shlex.quote(str(request_path))
    selections_directory = shlex.quote(str(request_path.parent))
    shell_process_id_path = shlex.quote(
        str(work_item_picker.terminal_shell_process_id_path_for(request_path))
    )
    venv_python = state_store.PROJECT_ROOT / ".venv" / "bin" / "python"
    direct_picker_command = (
        f"{shlex.quote(str(venv_python))} -m src.harness.work_item_picker --request {request}"
    )
    fallback_picker_command = (
        f"uv run --quiet python -m src.harness.work_item_picker --request {request}"
    )
    shell_program = f"""\
printf '\\033[2J\\033[H[Harness] WorkItem 선택기를 준비하는 중…\\n'
printf '%s\\n' "$$" > {shell_process_id_path} 2>/dev/null
show_permission_guidance() {{
  printf '\\n[Harness] WorkItem 선택 창을 열지 못했습니다.\\n\\n'
  printf '원인: Terminal이 프로젝트가 있는 Desktop 폴더에 접근할 수 없습니다.\\n\\n'
  printf '해결:\\n'
  printf '1. macOS 설정 → 개인정보 보호 및 보안 → 파일 및 폴더에서\\n'
  printf '   Terminal의 Desktop 폴더 접근을 허용하세요.\\n'
  printf '2. Codex에서 /stop으로 현재 실행을 종료하세요.\\n'
  printf '3. 같은 w/ 요청을 다시 보내세요.\\n\\n'
  printf '아무 키나 누르면 창을 닫습니다. '
  read -r -k 1
}}

if ! cd {project_root} || ! pwd -P >/dev/null 2>&1; then
  show_permission_guidance
  exit 1
fi

if ! test -r {request} || ! test -w {selections_directory}; then
  show_permission_guidance
  exit 1
fi

if test -x {shlex.quote(str(venv_python))}; then
  {direct_picker_command}
else
  {fallback_picker_command}
fi
picker_status=$?
if [ "$picker_status" -ne 0 ]; then
  printf '\\n[Harness] 선택 프로그램이 종료되었습니다 (exit %s).\\n' "$picker_status"
  printf '위 오류를 확인한 뒤 같은 w/ 요청을 다시 보내세요.\\n'
  printf '아무 키나 누르면 창을 닫습니다. '
  read -r -k 1
fi
exit "$picker_status"
"""
    launcher_path = work_item_picker.terminal_launcher_path_for(request_path)
    process_id_path = work_item_picker.terminal_process_id_path_for(request_path)
    try:
        launcher_path.parent.mkdir(parents=True, exist_ok=True)
        launcher_path.write_text("#!/bin/zsh\n" + shell_program, encoding="utf-8")
        launcher_path.chmod(0o700)
        existing_process_ids = _terminal_process_ids()
        subprocess.run(
            [
                "open", "-g", "-n", "-a", "Terminal",
                "--env", "DISABLE_AUTO_UPDATE=true", str(launcher_path),
            ],
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise HookInputError("Terminal.app picker could not be launched") from error

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        launched_process_ids = _terminal_process_ids() - existing_process_ids
        if len(launched_process_ids) == 1:
            process_id_path.write_text(
                f"{launched_process_ids.pop()}\n", encoding="utf-8"
            )
            return
        time.sleep(0.05)


def _terminal_process_ids() -> set[int]:
    """Return the current PID set for Terminal.app processes."""

    completed = subprocess.run(
        ["pgrep", "-x", "Terminal"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return set()
    return {
        int(process_id)
        for process_id in completed.stdout.splitlines()
        if process_id.isdecimal()
    }


def validate_selection_result(
    request_path: Path, result: Mapping[str, Any], *, request_text: str,
) -> dict[str, Any]:
    """Accept only a timely result tied to this exact request and listed WI."""

    request = work_item_picker.read_json_object(request_path)
    if result.get("schema_version") != work_item_picker.SCHEMA_VERSION:
        raise HookInputError("selection result schema_version is invalid")
    for field in ("request_id", "session_id", "turn_id"):
        if result.get(field) != request.get(field):
            raise HookInputError(f"selection result {field} does not match request")
    if work_item_picker.parse_timestamp(result.get("created_at"), "created_at") >= work_item_picker.parse_timestamp(request.get("expires_at"), "expires_at"):
        raise HookInputError("selection result was written after expiry")
    status = result.get("status")
    if status == "cancelled":
        if "work_item_id" in result:
            raise HookInputError("cancelled selection result must not contain work_item_id")
        return _selection_packet("cancelled", request=request_text)
    if status != "selected" or not isinstance(result.get("work_item_id"), str):
        raise HookInputError("selection result status is invalid")
    work_items = request.get("work_items")
    if not isinstance(work_items, list):
        raise HookInputError("selection request work_items is invalid")
    selected = next((item for item in work_items if item.get("id") == result["work_item_id"]), None)
    if selected is None:
        raise HookInputError("selected WorkItem was not in the request")
    return _selection_packet(
        "selected",
        work_item_id=selected["id"],
        title=selected["title"],
        is_draft=bool(selected.get("is_draft", False)),
        request=request_text,
    )


def wait_for_selection_result(
    request_path: Path, *, timeout_seconds: int = SELECTION_TIMEOUT_SECONDS,
) -> dict[str, Any] | PickerWaitStatus | None:
    """Wait for a result, noticing when the picker Terminal or shell exits."""

    result_path = work_item_picker.result_path_for(request_path)
    ready_path = work_item_picker.terminal_ready_path_for(request_path)
    process_id_path = work_item_picker.terminal_process_id_path_for(request_path)
    shell_process_id_path = work_item_picker.terminal_shell_process_id_path_for(
        request_path
    )
    started = time.monotonic()
    deadline = time.monotonic() + timeout_seconds
    focused = False
    ready_since: float | None = None
    while time.monotonic() < deadline:
        if result_path.exists():
            return work_item_picker.read_json_object(result_path)
        terminal_pid = _read_process_id(process_id_path)
        shell_pid = _read_process_id(shell_process_id_path)
        if (
            terminal_pid is not None and terminal_pid not in _terminal_process_ids()
        ) or (shell_pid is not None and not _process_is_alive(shell_pid)):
            # The picker can publish its result just before its shell exits.
            if result_path.exists():
                return work_item_picker.read_json_object(result_path)
            return PickerWaitStatus.TERMINAL_CLOSED
        now = time.monotonic()
        if ready_since is None and ready_path.exists():
            ready_since = now
        if not focused and (
            (ready_since is not None and now - ready_since >= TERMINAL_FOCUS_READY_DELAY_SECONDS)
            or now - started >= TERMINAL_FOCUS_FALLBACK_SECONDS
        ):
            if terminal_pid is not None and terminal_pid in _terminal_process_ids():
                focused = _request_terminal_activation(terminal_pid)
        time.sleep(0.1)
    return None


def _read_process_id(path: Path) -> int | None:
    """Read a request-scoped PID marker when it has been published."""

    try:
        process_id = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    return process_id if process_id > 0 else None


def _process_is_alive(process_id: int) -> bool:
    """Report whether a picker shell still has a live process ID."""

    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _request_terminal_activation(process_id: int) -> bool:
    """Bring the dedicated Terminal instance forward after fzf starts."""

    if sys.platform != "darwin":
        return False
    try:
        _appkit = ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
        objc = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
        pointer = ctypes.c_void_p
        objc.objc_getClass.restype = pointer
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = pointer
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        send_message = objc.objc_msgSend
        send_message.restype = pointer
        send_message.argtypes = [pointer, pointer, ctypes.c_int32]
        running_application = objc.objc_getClass(b"NSRunningApplication")
        lookup = objc.sel_registerName(b"runningApplicationWithProcessIdentifier:")
        app = send_message(running_application, lookup, ctypes.c_int32(process_id))
        if not app:
            return False
        send_message.restype = ctypes.c_bool
        send_message.argtypes = [pointer, pointer, ctypes.c_ulong]
        activate = objc.sel_registerName(b"activateWithOptions:")
        return bool(send_message(app, activate, ctypes.c_ulong(2)))
    except (AttributeError, OSError, TypeError, ValueError):
        return False


def close_terminal_picker(request_path: Path) -> None:
    """Gracefully quit this request's dedicated Terminal instance.

    ``SIGTERM`` stops the app process without giving Terminal.app its normal
    quit path, which can leave the picker window in macOS's restore list. Ask
    the specific process to terminate through AppKit first, then retain
    ``SIGTERM`` only as a bounded emergency fallback.
    """

    process_id_path = work_item_picker.terminal_process_id_path_for(request_path)
    try:
        process_id = int(process_id_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return
    if process_id not in _terminal_process_ids():
        return

    # The result is written before the picker shell exits. Let it end before
    # asking its isolated Terminal.app process to quit normally.
    time.sleep(0.2)
    _request_graceful_terminal_quit(process_id)
    deadline = time.monotonic() + TERMINAL_CLOSE_GRACE_SECONDS
    while time.monotonic() < deadline:
        if process_id not in _terminal_process_ids():
            return
        time.sleep(TERMINAL_CLOSE_POLL_SECONDS)

    # A hung or unavailable AppKit request must not leave the hook blocked.
    if process_id in _terminal_process_ids():
        try:
            os.kill(process_id, signal.SIGTERM)
        except OSError:
            pass


def _request_graceful_terminal_quit(process_id: int) -> bool:
    """Ask AppKit to terminate exactly one Terminal.app process by PID.

    ``NSRunningApplication.terminate`` is the AppKit equivalent of a normal
    app quit. Calling it through the Objective-C runtime keeps the request
    scoped to the recorded PID and avoids scripting the user's other Terminal
    windows.
    """

    if sys.platform != "darwin":
        return False
    try:
        _appkit = ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
        objc = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
        pointer = ctypes.c_void_p
        objc.objc_getClass.restype = pointer
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = pointer
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        send_message = objc.objc_msgSend
        send_message.restype = pointer
        send_message.argtypes = [pointer, pointer, ctypes.c_int32]
        running_application = objc.objc_getClass(b"NSRunningApplication")
        lookup = objc.sel_registerName(
            b"runningApplicationWithProcessIdentifier:"
        )
        app = send_message(running_application, lookup, ctypes.c_int32(process_id))
        if not app:
            return False

        send_message.restype = ctypes.c_bool
        send_message.argtypes = [pointer, pointer]
        terminate = objc.sel_registerName(b"terminate")
        return bool(send_message(app, terminate))
    except (AttributeError, OSError, TypeError, ValueError):
        return False


def cleanup_selection_files(request_path: Path) -> None:
    """Remove a request and its paired transient selection files."""

    for path in (
        request_path,
        work_item_picker.result_path_for(request_path),
        work_item_picker.terminal_tty_path_for(request_path),
        work_item_picker.terminal_ready_path_for(request_path),
        work_item_picker.terminal_process_id_path_for(request_path),
        work_item_picker.terminal_shell_process_id_path_for(request_path),
        work_item_picker.terminal_launcher_path_for(request_path),
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def cleanup_expired_selection_files(selections_directory: Path) -> None:
    """Remove only expired orphaned files left by an abnormal earlier process."""

    if not selections_directory.exists():
        return
    now = work_item_picker.utc_now()
    for request_path in selections_directory.glob("selection-*.request.json"):
        try:
            request = work_item_picker.read_json_object(request_path)
            if now >= work_item_picker.parse_timestamp(request.get("expires_at"), "expires_at"):
                cleanup_selection_files(request_path)
        except work_item_picker.SelectionFileError:
            continue


def dispatch_user_prompt_submit(
    event: Mapping[str, Any], *, database_path: str | Path = state_store.DEFAULT_DATABASE_PATH,
) -> dict[str, Any]:
    """Run external WI selection only when the prompt begins with ``w/``."""

    prompt = event.get("prompt")
    if not isinstance(prompt, str):
        return _hook_output()
    request_text = strip_work_prefix(prompt)
    if request_text is None:
        return _hook_output()
    recovery: ups_recovery.RecoveryReport | None = None
    try:
        session_id = _required_string(event, "session_id")
        turn_id = _required_string(event, "turn_id")
        bindings_directory = os.environ.get("HARNESS_BINDINGS_DIRECTORY") or runtime_binding.DEFAULT_BINDINGS_DIRECTORY
        recovery = ups_recovery.reconcile_current_session(
            session_id=session_id,
            current_turn_id=turn_id,
            database_path=database_path,
            bindings_directory=bindings_directory,
        )
        if not recovery.can_continue:
            return _hook_output(
                _selection_packet(
                    "error",
                    reason=(recovery.warnings[0] if recovery.warnings else "recovery_failed"),
                    recovery=recovery.as_packet(),
                    request=request_text,
                )
            )
        cleanup = review_plans.cleanup_orphan_review_plans(database_path=database_path)
        recovery.warnings.extend(cleanup["warnings"])
        selections_directory = _selection_directory(database_path)
        cleanup_expired_selection_files(selections_directory)
        request_path = write_selection_request(
            request_id=str(uuid4()), session_id=session_id, turn_id=turn_id,
            work_items=state_store.list_selectable_work_items(database_path=database_path),
            selections_directory=selections_directory,
        )
    except Exception as error:
        return _hook_output(
            _selection_packet(
                "error",
                reason=type(error).__name__,
                recovery=recovery.as_packet() if recovery else None,
                request=request_text,
            )
        )
    try:
        launch_terminal_picker(request_path)
        result = wait_for_selection_result(request_path)
        if result is None:
            return _hook_output(
                _selection_packet(
                    "timed_out",
                    recovery=recovery.as_packet() if recovery else None,
                    request=request_text,
                )
            )
        if result is PickerWaitStatus.TERMINAL_CLOSED:
            return _hook_output(
                _selection_packet(
                    "terminal_closed",
                    message="선택 창이 닫혀 대기를 끝냈습니다. 다시 선택하려면 같은 w/ 요청을 보내세요.",
                    recovery=recovery.as_packet() if recovery else None,
                    request=request_text,
                )
            )
        packet = validate_selection_result(
            request_path, result, request_text=request_text
        )
        if recovery is not None:
            packet["recovery"] = recovery.as_packet()
        return _hook_output(packet)
    except Exception as error:
        return _hook_output(
            _selection_packet(
                "error",
                reason=type(error).__name__,
                recovery=recovery.as_packet() if recovery else None,
                request=request_text,
            )
        )
    finally:
        try:
            close_terminal_picker(request_path)
        finally:
            cleanup_selection_files(request_path)


def main() -> int:
    """Read Hook JSON from stdin and emit Codex Hook JSON to stdout."""

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    result = dispatch_user_prompt_submit(
        payload,
        database_path=shared_paths.state_database_from_environment(),
    )
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
