"""Feature gallery API backed by the project state database."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, ConfigDict, Field

from .. import state_store


class CreateFeatureRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    goal: str = Field(min_length=1, max_length=2000)
    priority: Literal["urgent", "high", "normal", "low"] = "normal"


class ChangeFeatureStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["planned", "active", "paused", "completed", "cancelled"]


def _database_path(request: Request) -> Path:
    return request.app.state.database_path


def create_router() -> APIRouter:
    router = APIRouter(prefix="/api/features", tags=["features"])

    @router.get("")
    def list_features(request: Request) -> dict[str, object]:
        return {"features": state_store.list_features(database_path=_database_path(request))}

    @router.get("/{feature_id}")
    def get_feature(feature_id: str, request: Request) -> dict[str, object]:
        database_path = _database_path(request)
        feature = state_store.get_feature(feature_id, database_path=database_path)
        work_items = [
            {key: item[key] for key in ("id", "title", "status", "priority", "is_draft")}
            for item in state_store.list_work_items(database_path=database_path)
            if item["feature_id"] == feature_id
        ]
        return {"feature": feature, "work_items": work_items}

    @router.post("", status_code=status.HTTP_201_CREATED)
    def create_feature(payload: CreateFeatureRequest, request: Request) -> dict[str, object]:
        feature = state_store.create_feature(
            title=payload.title,
            goal=payload.goal,
            priority=payload.priority,
            actor="web_console",
            database_path=_database_path(request),
        )
        return {"feature": feature}

    @router.patch("/{feature_id}/status")
    def change_feature_status(
        feature_id: str, payload: ChangeFeatureStatusRequest, request: Request
    ) -> dict[str, object]:
        feature = state_store.change_feature_status(
            feature_id,
            payload.status,
            actor="web_console",
            reason="Feature status changed in web console",
            database_path=_database_path(request),
        )
        return {"feature": feature}

    return router
