"""Read-only HTTP API for the Overview dashboard and graph compatibility route."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Request

from .. import state_store

VISIBLE_WORK_ITEM_STATUSES = {"ready", "in_progress"}


def _database_path(request: Request) -> Path:
    """Return the state database selected by the current FastAPI application."""

    return request.app.state.database_path


def create_router() -> APIRouter:
    """Create the read-only Overview route mounted under ``/api``."""

    router = APIRouter(prefix="/api/overview", tags=["overview"])

    @router.get("/dashboard")
    def get_dashboard(request: Request) -> dict[str, object]:
        """Return entity status totals, weekly completions and Feature progress.

        Weekly buckets start on Monday in UTC. Run completion counts include
        only successful Runs, and WI completion counts use their closed time.
        """

        database_path = _database_path(request)
        features = state_store.list_features(database_path=database_path)
        work_items = state_store.list_work_items(database_path=database_path)
        first_run_page = state_store.list_runs(limit=100, database_path=database_path)
        runs = list(first_run_page["runs"])
        for offset in range(100, first_run_page["total"], 100):
            runs.extend(state_store.list_runs(limit=100, offset=offset, database_path=database_path)["runs"])

        now = datetime.now(timezone.utc)
        week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

        def parse_timestamp(value: object) -> datetime | None:
            if not isinstance(value, str) or not value:
                return None
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)

        def week_counts(rows: list[dict[str, object]], timestamp_key: str) -> list[dict[str, object]]:
            weeks = []
            for weeks_ago in range(7, -1, -1):
                start = week_start - timedelta(weeks=weeks_ago)
                end = start + timedelta(weeks=1)
                count = sum(
                    start <= timestamp < end
                    for row in rows
                    if (timestamp := parse_timestamp(row.get(timestamp_key))) is not None
                )
                weeks.append({"week": start.date().isoformat(), "count": count})
            return weeks

        def day_counts(rows: list[dict[str, object]], timestamp_key: str) -> list[dict[str, object]]:
            today = now.date()
            days = []
            for days_ago in range(6, -1, -1):
                day = today - timedelta(days=days_ago)
                count = sum(
                    timestamp.date() == day
                    for row in rows
                    if (timestamp := parse_timestamp(row.get(timestamp_key))) is not None
                )
                days.append({"day": day.isoformat(), "count": count})
            return days

        feature_status = Counter(feature["status"] for feature in features)
        work_item_status = Counter(item["status"] for item in work_items)
        run_status = Counter(run["status"] for run in runs)
        priority_counts = Counter(
            item["priority"] for item in work_items if item["status"] not in {"done", "cancelled"}
        )
        completed_work_items = [item for item in work_items if item["status"] == "done"]
        succeeded_runs = [run for run in runs if run["status"] == "succeeded"]

        progress_features = []
        for feature in features:
            if feature["status"] not in {"planned", "active"}:
                continue
            progress = feature.get("progress") or {}
            total = int(progress.get("total_work_items") or 0)
            cancelled = int(progress.get("cancelled_count") or 0)
            eligible = max(0, total - cancelled)
            done = int(progress.get("done_count") or 0)
            progress_features.append({
                "id": feature["id"],
                "title": feature["title"],
                "status": feature["status"],
                "total_work_items": total,
                "done_count": done,
                "progress_percent": round(done * 100 / eligible) if eligible else 0,
            })

        return {
            "features": {"total": len(features), "status": dict(feature_status)},
            "work_items": {
                "total": len(work_items),
                "status": dict(work_item_status),
                "this_week_done": sum(
                    (timestamp := parse_timestamp(item.get("closed_at"))) is not None and week_start <= timestamp <= now
                    for item in completed_work_items
                ),
            },
            "runs": {
                "total": len(runs),
                "status": dict(run_status),
                "this_week_succeeded": sum(
                    (timestamp := parse_timestamp(run.get("ended_at"))) is not None and week_start <= timestamp <= now
                    for run in succeeded_runs
                ),
            },
            "work_item_priorities": dict(priority_counts),
            "work_items_completed_by_week": week_counts(completed_work_items, "closed_at"),
            "runs_succeeded_by_week": week_counts(succeeded_runs, "ended_at"),
            "work_items_completed_by_day": day_counts(completed_work_items, "closed_at"),
            "runs_succeeded_by_day": day_counts(succeeded_runs, "ended_at"),
            "feature_progress": sorted(
                progress_features,
                key=lambda feature: (feature["progress_percent"], feature["title"].casefold()),
            ),
        }

    @router.get("")
    def get_overview(request: Request) -> dict[str, object]:
        """Return relationship graph data for clients that still request it."""

        database_path = _database_path(request)
        features = state_store.list_features(database_path=database_path)
        work_items = [
            item
            for item in state_store.list_work_items(database_path=database_path)
            if item["status"] in VISIBLE_WORK_ITEM_STATUSES
        ]
        run_pages = [
            state_store.list_runs(
                work_item_id=item["id"], limit=100, database_path=database_path
            )
            for item in work_items
        ]
        runs = sorted(
            (run for page in run_pages for run in page["runs"]),
            key=lambda run: (run["started_at"], run["id"]),
            reverse=True,
        )
        run_count = sum(page["total"] for page in run_pages)

        feature_ids = {feature["id"] for feature in features}
        work_item_ids = {item["id"] for item in work_items}
        normalized_features = [
            {
                "id": feature["id"],
                "title": feature["title"],
                "status": feature["status"],
                "priority": feature["priority"],
                "progress": feature.get("progress") or {},
            }
            for feature in features
        ]
        normalized_work_items = [
            {
                "id": item["id"],
                "title": item["title"],
                "status": item["status"],
                "kind": item["kind"],
                "priority": item["priority"],
                "feature_id": item["feature_id"] if item["feature_id"] in feature_ids else None,
                "feature_title": item.get("feature_title"),
            }
            for item in work_items
        ]
        normalized_runs = [
            {
                "id": run["id"],
                "status": run["status"],
                "intent": run["intent"],
                "work_item_id": run["work_item_id"] if run["work_item_id"] in work_item_ids else None,
                "work_item_title": run["work_item_title"],
                "started_at": run["started_at"],
                "ended_at": run["ended_at"],
            }
            for run in runs
        ]

        links = [
            {"source": item["feature_id"], "target": item["id"], "kind": "feature_work_item"}
            for item in normalized_work_items
            if item["feature_id"]
        ]
        links.extend(
            {"source": run["work_item_id"], "target": run["id"], "kind": "work_item_run"}
            for run in normalized_runs
            if run["work_item_id"]
        )

        running_count = sum(run["status"] == "running" for run in normalized_runs)
        return {
            "features": normalized_features,
            "work_items": normalized_work_items,
            "runs": normalized_runs,
            "links": links,
            "summary": {
                "feature_count": len(normalized_features),
                "work_item_count": len(normalized_work_items),
                "run_count": run_count,
                "running_count": running_count,
                "truncated_runs": run_count > len(normalized_runs),
            },
        }

    return router
