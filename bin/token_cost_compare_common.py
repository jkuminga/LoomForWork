"""Read-only, same-fixture payload comparison for old/new closeout shapes.

The Review Plan and finalize response are illustrative in-memory payloads.
Neither variant calls a state-changing function or publishes a plan file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.harness import state_store


DEFAULT_DB = PROJECT_ROOT / ".harness/runtime/test-data/evt-preview-comparison.db"
DEFAULT_RUN = "RUN-3a2eebe44166"
COMPACT_EVENT_FIELDS = (
    "id", "run_seq", "tool_name", "tool_family", "status", "exit_code",
    "input_summary", "result_summary",
)
EVIDENCE_SEQUENCES = {11, 13}
ARTIFACT_ONLY_SEQUENCES = {12, 14, 15, 16, 17, 19}


def _read_only_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _json_length(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def _plan(snapshot: dict, *, legacy: bool) -> dict:
    """Build equivalent illustrative decisions; never validate or save them."""

    decisions = []
    excluded = []
    for event in snapshot["events"]:
        event_id = event["id"]
        sequence = event["run_seq"]
        if sequence not in EVIDENCE_SEQUENCES | ARTIFACT_ONLY_SEQUENCES:
            excluded.append(event_id)
            if legacy:
                decisions.append({
                    "event_id": event_id, "decision": "exclude", "reason": "검토 결과 등록 대상 아님",
                    "artifact": None, "evidence": [],
                })
            continue
        evidence = sequence in EVIDENCE_SEQUENCES
        decisions.append({
            "event_id": event_id,
            "decision": "artifact_evidence" if evidence else "artifact_only",
            "reason": "모의 작업 결과 보존",
            "artifact": {"kind": "test_run", "verification_status": "passed", "summary": "모의 작업 결과", "uri": None},
            "evidence": ([{"criterion_id": "AC-synthetic", "result": "passed", "note": "모의 검증", "reason": "모의 완료 근거"}]
                         if evidence else []),
        })
    common = {
        "schema_version": 1 if legacy else 2,
        "run_id": snapshot["run_id"],
        "work_item_id": snapshot["work_item_id"],
        "snapshot_max_seq": snapshot["snapshot_max_seq"],
    }
    return {**common, "events": decisions} if legacy else {
        **common, "decisions": decisions, "excluded_event_ids": excluded,
    }


def measure(database_path: Path, run_id: str, *, legacy: bool) -> dict:
    """Measure response characters without modifying the supplied SQLite DB."""

    path = database_path.resolve(strict=True)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    with patch.object(state_store, "open_database", side_effect=lambda database_path=None: _read_only_database(path)):
        snapshot = state_store.get_run_tool_event_snapshot(run_id, database_path=path)
        first_postflight = state_store.get_postflight_status(snapshot["work_item_id"], database_path=path)
        final_postflight = state_store.get_postflight_status(
            snapshot["work_item_id"], view="full" if legacy else "final", database_path=path,
        )
    after = hashlib.sha256(path.read_bytes()).hexdigest()
    if before != after:
        raise RuntimeError("Database changed during read-only comparison; use a stable fixture")

    event_list = snapshot if legacy else {
        **snapshot,
        "events": [{field: row[field] for field in COMPACT_EVENT_FIELDS} for row in snapshot["events"]],
    }
    event_ids = [event["id"] for event in snapshot["events"]]
    # Successful closeout is deliberately simulated. finalize_review_plan() is never called.
    finalize = {
        "run_id": run_id, "unreviewed_event_ids": [], "inconsistent_event_ids": [],
        "ae_complete": True,
        ("reviewed_event_ids" if legacy else "reviewed_count"): event_ids if legacy else len(event_ids),
    }
    payloads = {
        "first_postflight": first_postflight,
        "tool_events": event_list,
        "review_plan": _plan(snapshot, legacy=legacy),
        "final_postflight": final_postflight,
        "finalize_review_plan": finalize,
    }
    if legacy:
        payloads["review_status_recheck"] = {
            "run_id": run_id, "unreviewed_event_ids": [], "inconsistent_event_ids": [],
        }
    sizes = {name: _json_length(value) for name, value in payloads.items()}
    return {
        "variant": "legacy" if legacy else "current",
        "run_id": run_id,
        "event_count": len(event_ids),
        "source_sha256": before,
        "component_chars": sizes,
        "total_chars": sum(sizes.values()),
        "assumptions": [
            "Review Plan is illustrative and is not validated or stored.",
            "All EVT decisions are assumed applied; finalize response is simulated, not executed.",
            "Character counts are compact ensure_ascii=False JSON lengths, not actual token usage.",
        ],
    }


def main(*, legacy: bool) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--run", default=DEFAULT_RUN)
    args = parser.parse_args()
    print(json.dumps(measure(args.db, args.run, legacy=legacy), ensure_ascii=False, indent=2))
