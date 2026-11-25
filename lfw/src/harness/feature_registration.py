"""Register reviewed Feature and backlog WorkItem candidates from one JSON file."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from pathlib import Path
from typing import Any, Sequence

from . import state_store


KINDS = frozenset(
    {"implementation", "bug", "research", "decision", "refactor", "migration", "verification", "maintenance"}
)
PRIORITIES = frozenset({"urgent", "high", "normal", "low"})
MOSCOW = frozenset({"Must", "Should", "Could"})
COMPLEXITIES = frozenset({"Low", "Medium", "High"})


class CandidateError(ValueError):
    """The candidate file or requested subset does not satisfy the contract."""


def _nonempty(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CandidateError(f"{label} must be a non-empty string")
    return value.strip()


def _validate_candidates(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or data.get("schema_version") != 2:
        raise CandidateError("candidate JSON requires schema_version 2")
    if set(data) - {"schema_version", "source_prd", "review", "features"}:
        raise CandidateError("candidate JSON contains unsupported top-level fields")
    _nonempty(data.get("source_prd"), "source_prd")
    if "review" in data:
        _nonempty(data["review"], "review")
    if not isinstance(data.get("features"), list) or not data["features"]:
        raise CandidateError("features must be a non-empty list")

    feature_keys: set[str] = set()
    work_ids: set[str] = set()
    for feature in data["features"]:
        if not isinstance(feature, dict):
            raise CandidateError("each Feature candidate must be an object")
        if set(feature) != {"key", "target", "work_items"}:
            raise CandidateError("Feature candidate requires key, target, work_items only")
        key = _nonempty(feature.get("key"), "Feature key")
        if key in feature_keys:
            raise CandidateError(f"duplicate Feature key: {key}")
        feature_keys.add(key)
        target = feature.get("target")
        if not isinstance(target, dict):
            raise CandidateError(f"{key}: target must be an object")
        if target.get("mode") == "create":
            if set(target) != {"mode", "title", "goal", "priority"}:
                raise CandidateError(f"{key}: invalid create target fields")
            _nonempty(target.get("title"), f"{key} title")
            _nonempty(target.get("goal"), f"{key} goal")
            if target.get("priority") not in PRIORITIES:
                raise CandidateError(f"{key}: invalid priority")
        elif target.get("mode") == "reuse":
            if set(target) != {"mode", "feature_id"}:
                raise CandidateError(f"{key}: invalid reuse target fields")
            _nonempty(target.get("feature_id"), f"{key} feature_id")
        else:
            raise CandidateError(f"{key}: target mode must be create or reuse")

        items = feature.get("work_items")
        if not isinstance(items, list) or not items:
            raise CandidateError(f"{key}: work_items must be a non-empty list")
        for item in items:
            if not isinstance(item, dict):
                raise CandidateError(f"{key}: WI candidate must be an object")
            required = {"vendor_id", "title", "goal", "kind", "priority", "acceptance_criteria", "origin"}
            if not required <= set(item) or set(item) - required - {"notes"}:
                raise CandidateError(f"{key}: invalid WI candidate fields")
            vendor_id = _nonempty(item.get("vendor_id"), f"{key} vendor_id")
            if vendor_id in work_ids:
                raise CandidateError(f"duplicate WI vendor_id: {vendor_id}")
            work_ids.add(vendor_id)
            _nonempty(item.get("title"), f"{vendor_id} title")
            _nonempty(item.get("goal"), f"{vendor_id} goal")
            if item.get("kind") not in KINDS or item.get("priority") not in PRIORITIES:
                raise CandidateError(f"{vendor_id}: invalid kind or priority")
            criteria = item.get("acceptance_criteria")
            if not isinstance(criteria, list) or not criteria:
                raise CandidateError(f"{vendor_id}: acceptance_criteria must be a non-empty list")
            for criterion in criteria:
                _nonempty(criterion, f"{vendor_id} acceptance criterion")
            origin = item.get("origin")
            if not isinstance(origin, dict):
                raise CandidateError(f"{vendor_id}: origin must be an object")
            if set(origin) != {"moscow", "complexity", "requirements"}:
                raise CandidateError(f"{vendor_id}: invalid origin fields")
            if origin.get("moscow") not in MOSCOW or origin.get("complexity") not in COMPLEXITIES:
                raise CandidateError(f"{vendor_id}: invalid origin")
            requirements = origin.get("requirements")
            if not isinstance(requirements, list) or not requirements:
                raise CandidateError(f"{vendor_id}: origin requirements must be a non-empty list")
            for requirement in requirements:
                if not isinstance(requirement, str) or not re.fullmatch(r"(?:FR|NFR)-\d+", requirement):
                    raise CandidateError(f"{vendor_id}: invalid requirement ID")
            if "notes" in item and not isinstance(item["notes"], str):
                raise CandidateError(f"{vendor_id}: notes must be a string")
    return data["features"]


def _description(item: dict[str, Any]) -> str:
    origin = item["origin"]
    lines = [
        f"후보 ID: {item['vendor_id']}",
        f"출시 범위: {origin['moscow']}",
        f"상대 난이도: {origin['complexity']}",
        f"PRD 요구사항: {', '.join(origin['requirements'])}",
    ]
    if item.get("notes", "").strip():
        lines.append(f"구현 메모: {item['notes'].strip()}")
    return "\n".join(lines)


def register_candidates(
    candidate_path: str | Path,
    *,
    database_path: str | Path = state_store.DEFAULT_DATABASE_PATH,
    only: Sequence[str] = (),
    feature_ids: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Register chosen WI candidates and return per-candidate IDs or failures.

    ``only`` contains vendor IDs. ``feature_ids`` maps candidate Feature keys
    to already-created DB Feature IDs when retrying a partial registration.
    This function deliberately does not infer prior registrations from titles.
    """

    data = json.loads(Path(candidate_path).read_text(encoding="utf-8"))
    features = _validate_candidates(data)
    selected = set(only)
    available = {item["vendor_id"] for feature in features for item in feature["work_items"]}
    unknown = selected - available
    if unknown:
        raise CandidateError(f"unknown WI candidate IDs: {', '.join(sorted(unknown))}")
    overrides = feature_ids or {}
    unknown = set(overrides) - {feature["key"] for feature in features}
    if unknown:
        raise CandidateError(f"unknown Feature candidate keys: {', '.join(sorted(unknown))}")

    result: dict[str, Any] = {"source": str(candidate_path), "features": [], "succeeded": 0, "failed": 0}
    for feature in features:
        items = [item for item in feature["work_items"] if not selected or item["vendor_id"] in selected]
        if not items:
            continue
        key = feature["key"]
        target = feature["target"]
        feature_result: dict[str, Any] = {"key": key, "work_items": []}
        result["features"].append(feature_result)

        try:
            if key in overrides:
                feature_id = _nonempty(overrides[key], f"{key} override ID")
                existing = state_store.get_feature(feature_id, database_path=database_path)
                if target["mode"] == "reuse" and feature_id != target["feature_id"]:
                    raise CandidateError(f"{key}: override differs from target.feature_id")
                feature_result["action"] = "existing"
            elif target["mode"] == "reuse":
                feature_id = target["feature_id"]
                existing = state_store.get_feature(feature_id, database_path=database_path)
                feature_result["action"] = "existing"
            else:
                existing = state_store.create_feature(
                    title=target["title"],
                    goal=target["goal"],
                    priority=target["priority"],
                    actor="feature_registration",
                    database_path=database_path,
                )
                feature_id = existing["id"]
                feature_result["action"] = "created"
            feature_result["feature_id"] = feature_id
            if existing["status"] in {"completed", "cancelled"}:
                raise CandidateError(f"{key}: Feature {feature_id} is {existing['status']}")
        except (state_store.StateStoreError, CandidateError) as error:
            feature_result["error"] = str(error)
            for item in items:
                feature_result["work_items"].append(
                    {"vendor_id": item["vendor_id"], "status": "failed", "error": f"Feature unavailable: {error}"}
                )
                result["failed"] += 1
            continue

        for item in items:
            try:
                work_item = state_store.create_work_item(
                    feature_id=feature_id,
                    title=item["title"],
                    kind=item["kind"],
                    goal=item["goal"],
                    description=_description(item),
                    priority=item["priority"],
                    acceptance_criteria=item["acceptance_criteria"],
                    actor="feature_registration",
                    database_path=database_path,
                )
                feature_result["work_items"].append(
                    {"vendor_id": item["vendor_id"], "status": "created", "work_item_id": work_item["id"]}
                )
                result["succeeded"] += 1
            except state_store.StateStoreError as error:
                feature_result["work_items"].append(
                    {"vendor_id": item["vendor_id"], "status": "failed", "error": str(error)}
                )
                result["failed"] += 1
    if result["failed"]:
        command = [
            sys.executable, "-m", "src.harness.feature_registration",
            str(candidate_path), "--database", str(database_path),
        ]
        for group in result["features"]:
            failed_ids = [
                item["vendor_id"] for item in group["work_items"] if item["status"] == "failed"
            ]
            for vendor_id in failed_ids:
                command.extend(["--only", vendor_id])
            target = next(feature["target"] for feature in features if feature["key"] == group["key"])
            if failed_ids and target["mode"] == "create":
                parent_id = group.get("feature_id") or overrides.get(group["key"])
                if parent_id:
                    command.extend(["--feature-id", f"{group['key']}={parent_id}"])
        result["retry"] = {
            "message": "실패 원인을 확인한 뒤, 아래 명령으로 실패한 WI 후보만 재등록하세요. 이미 성공한 후보는 재등록하지 않습니다.",
            "command": shlex.join(command),
        }
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_json", help="reviewed schema_version 2 candidate JSON")
    parser.add_argument("--database", default=str(state_store.DEFAULT_DATABASE_PATH))
    parser.add_argument("--only", action="append", default=[], metavar="F_ID", help="register only this WI candidate; repeat as needed")
    parser.add_argument(
        "--feature-id", action="append", default=[], metavar="G_KEY=FEAT_ID",
        help="use an already-created Feature for a candidate group; repeat as needed",
    )
    args = parser.parse_args(argv)
    overrides: dict[str, str] = {}
    for mapping in args.feature_id:
        key, separator, feature_id = mapping.partition("=")
        if not separator or not key or not feature_id or key in overrides:
            parser.error(f"invalid or duplicate --feature-id: {mapping}")
        overrides[key] = feature_id
    try:
        result = register_candidates(
            args.candidate_json, database_path=args.database, only=args.only, feature_ids=overrides
        )
    except (CandidateError, OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
