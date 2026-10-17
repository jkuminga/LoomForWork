"""Immutable review decisions, safe local files, and resumable EVT closeout.

SQLite owns applied results. A plan holds decisions only; replay always checks
the original Run's saved Artifacts/Evidence before acknowledging its events.
"""

from __future__ import annotations

import json
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any

from . import state_store as store


_RUN_ID = re.compile(r"RUN-[A-Za-z0-9_-]{1,80}\Z")
_KINDS = {"file", "commit", "test_run", "lint_run", "build_run", "pull_request", "deployment", "screenshot", "report", "other"}
_VERIFICATIONS = {"pending", "passed", "failed", "not_applicable"}


def _directory(database_path: str | Path) -> Path:
    directory = Path(database_path).resolve().parent / "review-plans"
    if directory.is_symlink():
        raise store.ConflictError("review-plans directory must not be a symlink")
    return directory


def _path(run_id: str, database_path: str | Path) -> Path:
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise store.ConflictError("unsafe Review Plan Run ID")
    return _directory(database_path) / f"{run_id}.json"


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise store.ConflictError("duplicate JSON object field")
        result[key] = value
    return result


def _text(value: Any, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise store.ConflictError(f"{label} must be non-empty text")


def validate_review_plan(
    plan: dict[str, Any], *, run_id: str,
    database_path: str | Path = store.DEFAULT_DATABASE_PATH,
    require_coverage: bool = True,
) -> dict[str, Any]:
    """Validate shape, owner, targets and exact snapshot coverage against DB."""

    _path(run_id, database_path)
    fields = {"schema_version", "run_id", "work_item_id", "snapshot_max_seq", "events"}
    if not isinstance(plan, dict) or set(plan) != fields:
        raise store.ConflictError("Review Plan fields do not match schema_version 1")
    if type(plan["schema_version"]) is not int or plan["schema_version"] != 1:
        raise store.ConflictError("unsupported Review Plan schema_version")
    if plan["run_id"] != run_id:
        raise store.ConflictError("Review Plan filename/Run mismatch")
    boundary = plan["snapshot_max_seq"]
    if type(boundary) is not int or boundary < 0 or not isinstance(plan["events"], list):
        raise store.ConflictError("invalid snapshot boundary or events array")
    context = store.get_run_review_context(run_id, database_path=database_path)
    if plan["work_item_id"] != context["run"]["work_item_id"]:
        raise store.ConflictError("Review Plan WorkItem mismatch")
    events = {row["id"]: row for row in context["events"]}
    criteria = {row["id"] for row in context["acceptance_criteria"]}
    ids: set[str] = set()
    for decision in plan["events"]:
        if not isinstance(decision, dict) or set(decision) != {"event_id", "decision", "reason", "artifact", "evidence"}:
            raise store.ConflictError("invalid Review Plan decision fields")
        event_id = decision["event_id"]
        if not isinstance(event_id, str) or event_id in ids or event_id not in events:
            raise store.ConflictError("duplicate or foreign Review Plan EVT")
        ids.add(event_id)
        if events[event_id]["run_seq"] > boundary:
            raise store.ConflictError("Review Plan EVT lies outside snapshot")
        _text(decision["reason"], "decision reason")
        choice, artifact, evidence = decision["decision"], decision["artifact"], decision["evidence"]
        if not isinstance(choice, str) or choice not in {"exclude", "artifact_only", "artifact_evidence"} or not isinstance(evidence, list):
            raise store.ConflictError("unsupported Review Plan decision")
        if choice == "exclude":
            if artifact is not None or evidence:
                raise store.ConflictError("excluded EVT must have no Artifact/Evidence")
            continue
        if not isinstance(artifact, dict) or set(artifact) != {"kind", "verification_status", "summary", "uri"}:
            raise store.ConflictError("invalid planned Artifact fields")
        if not isinstance(artifact["kind"], str) or not isinstance(artifact["verification_status"], str) or artifact["kind"] not in _KINDS or artifact["verification_status"] not in _VERIFICATIONS:
            raise store.ConflictError("invalid planned Artifact kind/status")
        _text(artifact["summary"], "Artifact summary")
        if store._validate_artifact_uri(artifact["kind"], artifact["uri"]) != artifact["uri"]:
            raise store.ConflictError("planned URI must already be normalized")
        if artifact["kind"] in {"test_run", "lint_run", "build_run"} and artifact["verification_status"] == "not_applicable":
            raise store.ConflictError("execution Artifact requires a verification status")
        if (choice == "artifact_only" and evidence) or (choice == "artifact_evidence" and not evidence):
            raise store.ConflictError("Evidence array does not match decision")
        ac_ids: set[str] = set()
        for link in evidence:
            if not isinstance(link, dict) or set(link) != {"criterion_id", "result", "note", "reason"}:
                raise store.ConflictError("invalid planned Evidence fields")
            ac_id = link["criterion_id"]
            if not isinstance(ac_id, str) or ac_id not in criteria or ac_id in ac_ids:
                raise store.ConflictError("duplicate or foreign planned AC")
            ac_ids.add(ac_id)
            if not isinstance(link["result"], str) or link["result"] not in {"passed", "failed"}:
                raise store.ConflictError("invalid Evidence result")
            if link["note"] is not None:
                _text(link["note"], "Evidence note")
            _text(link["reason"], "Evidence reason")
            if link["result"] == "passed" and artifact["verification_status"] not in {"passed", "not_applicable"}:
                raise store.ConflictError("failed/pending Artifact cannot pass an AC")
    if require_coverage and ids != {row["id"] for row in events.values() if row["run_seq"] <= boundary}:
        raise store.ConflictError("Review Plan does not cover the complete snapshot")
    if boundary > max((row["run_seq"] for row in events.values()), default=0):
        raise store.ConflictError("Review Plan snapshot exceeds recorded events")
    return context


def load_review_plan(run_id: str, *, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    path = _path(run_id, database_path)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise store.ConflictError("Review Plan must be a regular file")
            plan = json.load(stream, object_pairs_hook=_unique_object)
    except (OSError, ValueError) as error:
        raise store.ConflictError(f"Review Plan unavailable: {type(error).__name__}") from error
    validate_review_plan(plan, run_id=run_id, database_path=database_path)
    return plan


def save_review_plan(run_id: str, plan: dict[str, Any], *, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    context = validate_review_plan(plan, run_id=run_id, database_path=database_path)
    if context["run"]["status"] != "running":
        raise store.ConflictError("initial Review Plan requires a running Run")
    path = _path(run_id, database_path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    encoded = json.dumps(plan, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".review-", delete=False) as stream:
            temporary = stream.name
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        # link publishes a complete inode atomically and never replaces a plan.
        try:
            os.link(temporary, path)
        except FileExistsError:
            if load_review_plan(run_id, database_path=database_path) != plan:
                raise store.ConflictError("immutable Review Plan already exists with different decisions")
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
    return {"run_id": run_id, "path": str(path), "event_count": len(plan["events"]), "snapshot_max_seq": plan["snapshot_max_seq"]}


def _applied(decision: dict[str, Any], context: dict[str, Any]) -> bool:
    if decision["decision"] == "exclude":
        return True
    artifact = next((row for row in context["artifacts"] if row["source_event_id"] == decision["event_id"]), None)
    if artifact is None or any(artifact[key] != value for key, value in decision["artifact"].items()):
        return False
    criteria = {row["id"]: row for row in context["acceptance_criteria"]}
    return all(
        any(row["artifact_id"] == artifact["id"] and row["criterion_id"] == link["criterion_id"] for row in context["evidence"])
        and criteria[link["criterion_id"]]["status"] in {link["result"], "passed"}
        for link in decision["evidence"]
    )


def finalize_review_plan(run_id: str, *, database_path: str | Path = store.DEFAULT_DATABASE_PATH, recovery_work_item_id: str | None = None) -> dict[str, Any]:
    """Acknowledge applied decisions and post-snapshot bookkeeping events."""

    plan = load_review_plan(run_id, database_path=database_path)
    context = store.get_run_review_context(run_id, database_path=database_path)
    complete = [row["event_id"] for row in plan["events"] if _applied(row, context)]
    complete.extend(row["id"] for row in context["events"] if row["run_seq"] > plan["snapshot_max_seq"])
    store.mark_tool_events_reviewed(run_id, complete, recovery_work_item_id=recovery_work_item_id, database_path=database_path)
    status = store.get_run_review_status(run_id, database_path=database_path)
    return {**status, "ae_complete": all(_applied(row, context) for row in plan["events"]), "reviewed_event_ids": complete}


def delete_review_plan(run_id: str, *, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    """Remove a validated plan only after DB proves terminal, complete closeout."""

    path = _path(run_id, database_path)
    if not path.exists() and not path.is_symlink():
        return {"run_id": run_id, "deleted": False}
    plan = load_review_plan(run_id, database_path=database_path)
    context = store.get_run_review_context(run_id, database_path=database_path)
    if context["run"]["status"] == "running" or any(row["reviewed_at"] is None or row["input_summary"] or row["result_summary"] for row in context["events"]):
        raise store.ConflictError("Review Plan is still needed by its Run")
    if not all(_applied(row, context) for row in plan["events"]):
        raise store.ConflictError("Review Plan has unapplied decisions")
    path.unlink()
    return {"run_id": run_id, "deleted": True}


def _apply_decisions(work_item_id: str, run_id: str, decisions: list[dict[str, Any]], *, database_path: str | Path) -> dict[str, Any]:
    # Validate target even for an empty/replayed batch.
    with store._transaction(database_path) as database:
        store._require_recovery_target(database, work_item_id, run_id)
    results: list[dict[str, Any]] = []
    completed: list[str] = []
    for decision in decisions:
        event_id = decision["event_id"]
        try:
            if decision["decision"] != "exclude":
                artifact = store.record_artifact_for_recovery(work_item_id, run_id, source_event_id=event_id,
                                                            **decision["artifact"], database_path=database_path)
                for link in decision["evidence"]:
                    store.verify_criterion_with_evidence(artifact_id=artifact["id"], **link,
                                                        recovery_work_item_id=work_item_id, database_path=database_path)
            completed.append(event_id)
            results.append({"event_id": event_id, "status": "applied"})
        except store.StateStoreError as error:
            results.append({"event_id": event_id, "status": "failed", "reason": str(error)})
    try:
        store.mark_tool_events_reviewed(run_id, completed, recovery_work_item_id=work_item_id, database_path=database_path)
    except store.StateStoreError as error:
        return {"run_id": run_id, "results": results, "acknowledgement_error": str(error), **store.get_run_review_status(run_id, database_path=database_path)}
    return {"run_id": run_id, "results": results, **store.get_run_review_status(run_id, database_path=database_path)}


def recover_review_plan(work_item_id: str, run_id: str, *, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    with store._transaction(database_path) as database:
        store._require_recovery_target(database, work_item_id, run_id)
    path = _path(run_id, database_path)
    status = store.get_run_review_status(run_id, database_path=database_path)
    if not path.exists() and not path.is_symlink():
        if not status["unreviewed_event_ids"] and not status["inconsistent_event_ids"]:
            return {**status, "ae_complete": True, "results": [], "deleted": False}
        return {**status, "recovery_status": "plan_missing"}
    plan = load_review_plan(run_id, database_path=database_path)
    if plan["work_item_id"] != work_item_id:
        raise store.ConflictError("recovery selected WorkItem does not own the plan")
    result = _apply_decisions(work_item_id, run_id, plan["events"], database_path=database_path)
    if "acknowledgement_error" in result:
        return result
    result.update(finalize_review_plan(run_id, recovery_work_item_id=work_item_id, database_path=database_path))
    if not result["unreviewed_event_ids"] and not result["inconsistent_event_ids"]:
        try:
            result.update(delete_review_plan(run_id, database_path=database_path))
        except (store.StateStoreError, OSError) as error:
            result["cleanup_warning"] = str(error)
    return result


def apply_unplanned_review_recovery(work_item_id: str, run_id: str, decisions: list[dict[str, Any]], *, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    """Apply only confident model decisions; leave other historical EVTs alone."""

    path = _path(run_id, database_path)
    if path.exists() or path.is_symlink():
        try:
            load_review_plan(run_id, database_path=database_path)
        except store.StateStoreError:
            pass  # A corrupt plan is preserved; model decisions are not a replacement file.
        else:
            raise store.ConflictError("use recover_review_plan for a valid existing plan")
    snapshot = store.get_run_tool_event_snapshot(run_id, database_path=database_path)
    validate_review_plan({"schema_version": 1, "run_id": run_id, "work_item_id": work_item_id,
                          "snapshot_max_seq": snapshot["snapshot_max_seq"], "events": decisions},
                         run_id=run_id, database_path=database_path, require_coverage=False)
    return _apply_decisions(work_item_id, run_id, decisions, database_path=database_path)


def cleanup_orphan_review_plans(*, database_path: str | Path = store.DEFAULT_DATABASE_PATH) -> dict[str, Any]:
    """UPS sweep after stale-Run reconciliation; never infer or repair EVT value."""

    result: dict[str, Any] = {"deleted_run_ids": [], "warnings": []}
    try:
        directory = _directory(database_path)
        paths = sorted(directory.glob("*.json"))
    except (OSError, store.StateStoreError) as error:
        result["warnings"].append(f"review_plan_cleanup_failed:{type(error).__name__}")
        return result
    for path in paths:
        try:
            context = store.get_run_review_context(path.stem, database_path=database_path)
            if context["run"]["status"] == "running" or any(row["reviewed_at"] is None for row in context["events"]):
                continue
            if delete_review_plan(path.stem, database_path=database_path)["deleted"]:
                result["deleted_run_ids"].append(path.stem)
        except (store.StateStoreError, OSError, TypeError, ValueError) as error:
            result["warnings"].append(f"review_plan_cleanup_failed:{path.name}:{type(error).__name__}")
    return result
