"""File protocol and terminal picker for explicit WorkItem selection.

The UserPromptSubmit Hook writes a request file, while this module runs in a
separate terminal and writes its result. Keeping the two processes separated
protects the Hook JSON stdin/stdout protocol from ``fzf`` interaction.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


SCHEMA_VERSION = 1
FZF_HEADER = "상태    | 우선순위 | 종류          | 제목 / 목표"
FZF_FOOTER = "Ctrl+R Ready · Ctrl+O Backlog · Ctrl+T Draft\nEnter 선택 · Esc 취소 · 검색 입력 · ↑↓ 이동"
FILTER_STATUSES = ("ready", "backlog", "draft")
DEFAULT_FILTER_MASK = "100"
FILTER_PROMPT_PATTERN = re.compile(r"^\[Ready ([✓✗]) · Backlog ([✓✗]) · Draft ([✓✗])\] 검색>$")
FZF_PREVIEW = (
    "printf 'ID        %s\\n"
    "상태      %s\\n"
    "우선순위  %s\\n"
    "종류      %s\\n\\n"
    "◆ 제목\\n  %s\\n\\n"
    "◆ 목표\\n  %s\\n\\n"
    "◆ 다음 행동\\n  %s\\n' {1} {3} {4} {5} {6} {7} {8}"
)


class SelectionFileError(ValueError):
    """Raised when a picker request or result violates the file contract."""


def utc_now() -> datetime:
    """Return the current timezone-aware UTC timestamp."""

    return datetime.now(timezone.utc)


def format_timestamp(value: datetime) -> str:
    """Serialize one UTC timestamp in the selection-file format."""

    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_timestamp(value: object, field: str) -> datetime:
    """Parse a required UTC ISO timestamp from a selection file."""

    if not isinstance(value, str):
        raise SelectionFileError(f"{field} must be a string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SelectionFileError(f"{field} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise SelectionFileError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def result_path_for(request_path: Path) -> Path:
    """Return the paired result-file path for a selection request file."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".result.json")


def terminal_tty_path_for(request_path: Path) -> Path:
    """Return the transient Terminal TTY file paired with a selection request."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".tty")


def terminal_ready_path_for(request_path: Path) -> Path:
    """Return the marker fzf writes when its interactive screen starts."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".ready")


def terminal_process_id_path_for(request_path: Path) -> Path:
    """Return the transient dedicated-Terminal process ID file for a request."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".terminal.pid")


def terminal_shell_process_id_path_for(request_path: Path) -> Path:
    """Return the picker command shell PID file paired with a request."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".shell.pid")


def terminal_launcher_path_for(request_path: Path) -> Path:
    """Return the executable Terminal launcher file paired with a request."""

    suffix = ".request.json"
    if not request_path.name.endswith(suffix):
        raise SelectionFileError("request filename must end with .request.json")
    return request_path.with_name(request_path.name.removesuffix(suffix) + ".picker.command")


def atomic_write_json(path: Path, value: Mapping[str, Any]) -> None:
    """Atomically publish JSON so a reader never observes a partial file."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_json_object(path: Path) -> dict[str, Any]:
    """Read one JSON object or raise a contract-specific error."""

    try:
        with path.open(encoding="utf-8") as source:
            result = json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise SelectionFileError(f"cannot read {path.name}") from error
    if not isinstance(result, dict):
        raise SelectionFileError(f"{path.name} must contain a JSON object")
    return result


def _required_string(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise SelectionFileError(f"{field} must be a non-empty string")
    return value.strip()


def read_and_validate_request(path: Path) -> dict[str, Any]:
    """Read a valid request file and reject expired or malformed input."""

    request = read_json_object(path)
    if request.get("schema_version") != SCHEMA_VERSION:
        raise SelectionFileError("unsupported schema_version")
    for field in ("request_id", "session_id", "turn_id"):
        _required_string(request, field)
    expires_at = parse_timestamp(request.get("expires_at"), "expires_at")
    if utc_now() >= expires_at:
        raise SelectionFileError("selection request has expired")
    work_items = request.get("work_items")
    if not isinstance(work_items, list):
        raise SelectionFileError("work_items must be a list")
    for work_item in work_items:
        if not isinstance(work_item, dict):
            raise SelectionFileError("work_items entries must be objects")
        for field in ("id", "title", "goal", "priority"):
            _required_string(work_item, field)
        if "kind" in work_item:
            _required_string(work_item, "kind")
        if "is_draft" in work_item and not isinstance(work_item["is_draft"], bool):
            raise SelectionFileError("work_items is_draft must be a boolean")
        if "status" in work_item and work_item["status"] not in {"ready", "backlog"}:
            raise SelectionFileError("work_items status must be ready or backlog")
        if work_item.get("is_draft") and work_item.get("status", "backlog") != "backlog":
            raise SelectionFileError("Draft WorkItem must be backlog")
        if work_item.get("next_action") is not None and not isinstance(
            work_item["next_action"], str
        ):
            raise SelectionFileError("work_items next_action must be a string or null")
    return request


def filter_prompt(mask: str) -> str:
    """Show the three independent status switches in the search prompt."""

    if len(mask) != len(FILTER_STATUSES) or any(bit not in "01" for bit in mask):
        raise SelectionFileError("filter mask must contain three binary digits")
    marks = ["✓" if bit == "1" else "✗" for bit in mask]
    return f"[Ready {marks[0]} · Backlog {marks[1]} · Draft {marks[2]}] 검색> "


def selected_filter_mask(prompt: str) -> str:
    """Read the current switches exported by fzf to a transform command."""

    match = FILTER_PROMPT_PATTERN.fullmatch(prompt.rstrip())
    if match is None:
        raise SelectionFileError("fzf filter prompt is invalid")
    return "".join("1" if mark == "✓" else "0" for mark in match.groups())


def filter_rows(request: Mapping[str, Any], mask: str) -> list[str]:
    """Format only the enabled WI statuses from the original request snapshot."""

    filter_prompt(mask)
    visible = {status for status, enabled in zip(FILTER_STATUSES, mask) if enabled == "1"}
    return [
        format_fzf_line(item)
        for item in request["work_items"]
        if ("draft" if item.get("is_draft") else item.get("status", "ready")) in visible
    ]


def filter_command(request_path: Path, *arguments: str) -> str:
    """Build one safely quoted local picker command for fzf actions."""

    return " ".join(shlex.quote(part) for part in (
        sys.executable, "-m", "src.harness.work_item_picker", "--request", str(request_path), *arguments,
    ))


def toggle_filter_action(request_path: Path, status: str, prompt: str) -> str:
    """Return fzf actions that toggle one switch and reload the matching rows."""

    if status not in FILTER_STATUSES:
        raise SelectionFileError("unknown filter status")
    mask = list(selected_filter_mask(prompt))
    index = FILTER_STATUSES.index(status)
    mask[index] = "0" if mask[index] == "1" else "1"
    updated = "".join(mask)
    return f"change-prompt({filter_prompt(updated)})+reload({filter_command(request_path, '--emit-rows', '--mask', updated)})"


def run_fzf(lines: Sequence[str], *, ready_path: Path | None = None, request_path: Path | None = None) -> str | None:
    """Let the user select one tab-delimited WorkItem line with fzf."""

    initial_lines = [line for line in lines if line.split("\t")[2] == "READY"] if request_path else list(lines)
    command = [
        "fzf",
        "--delimiter=\t",
        "--with-nth=2",
        "--nth=1",
        f"--prompt={filter_prompt(DEFAULT_FILTER_MASK) if request_path else '검색> '}",
        "--layout=reverse",
        "--border=rounded",
        "--border-label= Harness · WorkItem 선택 ",
        "--border-label-pos=3",
        f"--header={FZF_HEADER}",
        "--header-first",
        "--header-border=bottom",
        f"--footer={FZF_FOOTER}",
        "--footer-border=top",
        "--info=inline-right",
        "--pointer=▶",
        f"--preview={FZF_PREVIEW}",
        "--preview-window=down:50%,border-top,wrap",
        "--preview-label= 선택한 WorkItem 상세 ",
    ]
    if ready_path is not None:
        command.append(
            f"--bind=start:execute-silent(: > {shlex.quote(str(ready_path))})"
        )
    if request_path is not None:
        for key, status in (("ctrl-r", "ready"), ("ctrl-o", "backlog"), ("ctrl-t", "draft")):
            command.append(
                f"--bind={key}:transform({filter_command(request_path, '--toggle', status)})"
            )
    try:
        completed = subprocess.run(
            command,
            input="\n".join(initial_lines) + ("\n" if initial_lines else ""),
            text=True,
            stdout=subprocess.PIPE,
            check=False,
        )
    except OSError as error:
        raise SelectionFileError("fzf could not be started") from error
    if completed.returncode == 0:
        selected = completed.stdout.rstrip("\n")
        return selected or None
    if completed.returncode in {1, 130}:
        return None
    raise SelectionFileError(f"fzf exited with status {completed.returncode}")


def _one_line(value: object) -> str:
    """Return one safe display line without changing the stored WorkItem value."""

    return " ".join(str(value).replace("\t", " ").splitlines())


def format_fzf_line(item: Mapping[str, Any]) -> str:
    """Format a fixed-column WorkItem row while preserving its ID for selection."""

    status = "DRAFT" if item.get("is_draft") else str(item.get("status", "ready")).upper()
    display = (
        f"{status:<7} | "
        f"{_one_line(item['priority']):<8} | "
        f"{_one_line(item.get('kind', 'work')):<14} | "
        f"{_one_line(item['title'])} / {_one_line(item['goal'])}"
    )
    return "\t".join(
        (
            str(item["id"]),
            display,
            status,
            _one_line(item["priority"]),
            _one_line(item.get("kind", "work")),
            _one_line(item["title"]),
            _one_line(item["goal"]),
            _one_line(item.get("next_action") or (
                "구체화 전이라 다음 행동이 없습니다." if item.get("is_draft")
                else "작업 시작 시 다음 행동을 정합니다."
            )),
        )
    )


def write_result(request: Mapping[str, Any], request_path: Path, *, status: str, work_item_id: str | None = None) -> None:
    """Write a selected or cancelled result paired with ``request``."""

    if status not in {"selected", "cancelled"}:
        raise SelectionFileError("result status must be selected or cancelled")
    result: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION, "request_id": _required_string(request, "request_id"),
        "session_id": _required_string(request, "session_id"), "turn_id": _required_string(request, "turn_id"),
        "created_at": format_timestamp(utc_now()), "status": status,
    }
    if status == "selected":
        if work_item_id is None:
            raise SelectionFileError("selected result requires work_item_id")
        result["work_item_id"] = work_item_id
    atomic_write_json(result_path_for(request_path), result)


def run_picker(request_path: Path) -> None:
    """Run the external-terminal selection flow for one request file."""

    request = read_and_validate_request(request_path)
    lines = [format_fzf_line(item) for item in request["work_items"]]
    selected_line = run_fzf(lines, ready_path=terminal_ready_path_for(request_path), request_path=request_path)
    if utc_now() >= parse_timestamp(request["expires_at"], "expires_at"):
        return
    if selected_line is None:
        write_result(request, request_path, status="cancelled")
        return
    work_item_id = selected_line.split("\t", 1)[0]
    if work_item_id not in {str(item["id"]) for item in request["work_items"]}:
        raise SelectionFileError("fzf returned an unknown WorkItem")
    write_result(request, request_path, status="selected", work_item_id=work_item_id)


def main() -> int:
    """Run the picker CLI used by the Terminal.app tab."""

    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--emit-rows", action="store_true")
    parser.add_argument("--mask")
    parser.add_argument("--toggle", choices=FILTER_STATUSES)
    arguments = parser.parse_args()
    try:
        request_path = arguments.request.resolve(strict=True)
        if arguments.emit_rows:
            if arguments.mask is None or arguments.toggle is not None:
                raise SelectionFileError("emit-rows requires a mask and no toggle")
            rows = filter_rows(read_and_validate_request(request_path), arguments.mask)
            if rows:
                sys.stdout.write("\n".join(rows) + "\n")
        elif arguments.toggle is not None:
            if arguments.mask is not None:
                raise SelectionFileError("toggle does not accept a mask")
            print(toggle_filter_action(request_path, arguments.toggle, os.environ.get("FZF_PROMPT", "")))
        elif arguments.mask is not None:
            raise SelectionFileError("mask requires emit-rows")
        else:
            run_picker(request_path)
    except (OSError, SelectionFileError) as error:
        print(f"harness-work-picker: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
