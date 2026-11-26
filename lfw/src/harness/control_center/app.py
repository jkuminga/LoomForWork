"""FastAPI entry point for the local Harness control center."""

from __future__ import annotations

import sqlite3
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import shared_paths, state_store
from .features_api import create_router as create_features_router
from .overview_api import create_router as create_overview_router
from .memory_graph_api import create_router as create_memory_graph_router
from .runs_api import create_router as create_runs_router
from .work_items_api import create_router


STATIC_DIR = Path(__file__).with_name("static")


def _error_response(
    *, http_status: int, code: str, message: str, fields: dict[str, str] | None = None
) -> JSONResponse:
    """Build the stable error envelope consumed by the browser UI."""

    error: dict[str, object] = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return JSONResponse(status_code=http_status, content={"error": error})


def create_app(
    database_path: str | Path | None = None,
    memory_database_path: str | Path | None = None,
    project_root: str | Path | None = None,
) -> FastAPI:
    """Create a control-center app with an optional project directory identity."""

    selected_database = Path(database_path) if database_path is not None else shared_paths.state_database_from_environment()
    project_name = _project_directory_name(project_root)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        state_store.initialize_database(selected_database)
        application.state.database_path = selected_database
        yield

    application = FastAPI(
        title="Harness Control Center",
        description="Local WorkItem visibility and Draft capture for Harness v2.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.database_path = selected_database
    application.state.project_name = project_name
    application.state.memory_database_path = Path(memory_database_path or os.environ.get("HARNESS_MEMORY_DB_PATH") or selected_database.with_name("memorygraph.db"))
    application.include_router(create_memory_graph_router())
    application.include_router(create_features_router())
    application.include_router(create_router())
    application.include_router(create_overview_router())
    application.include_router(create_runs_router())
    application.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        fields: dict[str, str] = {}
        for issue in error.errors():
            location = issue.get("loc", ())
            if len(location) >= 2 and location[0] in {"body", "query"}:
                fields[str(location[-1])] = str(issue.get("msg", "입력값을 확인해 주세요."))
        return _error_response(
            http_status=422,
            code="validation_error",
            message="입력값을 확인해 주세요.",
            fields=fields,
        )

    @application.exception_handler(state_store.NotFoundError)
    async def not_found_handler(_request: Request, _error: Exception) -> JSONResponse:
        return _error_response(
            http_status=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message="요청한 대상을 찾을 수 없습니다.",
        )

    @application.exception_handler(state_store.ConflictError)
    async def conflict_handler(_request: Request, error: Exception) -> JSONResponse:
        return _error_response(
            http_status=status.HTTP_409_CONFLICT,
            code="state_conflict",
            message=str(error),
        )

    async def database_error_handler(_request: Request, _error: Exception) -> JSONResponse:
        return _error_response(
            http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="state_store_unavailable",
            message="상태 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        )

    application.add_exception_handler(state_store.StateStoreError, database_error_handler)
    application.add_exception_handler(sqlite3.Error, database_error_handler)

    @application.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, _error: Exception) -> JSONResponse:
        return _error_response(
            http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="internal_error",
            message="예상하지 못한 오류가 발생했습니다.",
        )

    @application.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @application.get("/api/project-context")
    def project_context() -> dict[str, str | None]:
        """Return only the project directory name; the local path stays private."""

        return {"project_name": application.state.project_name}

    return application


def _project_directory_name(project_root: str | Path | None) -> str | None:
    """Return a valid root directory's basename, or None when it is unknown."""

    if project_root is None:
        return None
    try:
        root = Path(project_root).expanduser()
        if not root.is_absolute() or not root.is_dir():
            return None
        return root.name or None
    except (OSError, RuntimeError, TypeError, ValueError):
        return None


app = create_app()
