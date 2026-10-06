"""Read-only HTTP API for the Overview relationship graph."""

from __future__ import annotations

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

    @router.get("")
    def get_overview(request: Request) -> dict[str, object]:
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
