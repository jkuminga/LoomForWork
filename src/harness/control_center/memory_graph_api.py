"""Read-only projection of finalized memories; never reads candidate/state tables."""

import json
import sqlite3
from contextlib import contextmanager

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

GROUPS = {
    "reference": ("배경·참고", ("project", "technology", "file_context", "general", "conversation")),
    "problem": ("문제·오류", ("problem", "error")),
    "solution": ("해결·수정", ("solution", "fix")),
    "pattern": ("절차·재사용", ("task", "command", "workflow", "code_pattern")),
}


def group_for(memory_type):
    """Visual group, distinct from the stored memory type."""
    return next((key for key, (_, types) in GROUPS.items() if memory_type in types), "reference")


def node(row):
    result = dict(row)
    try:
        tags = json.loads(result.get("tags") or "[]")
    except (ValueError, TypeError):
        tags = []
    result["tags"] = [tag for tag in tags if isinstance(tag, str)] if isinstance(tags, list) else []
    result["group"] = group_for(result["type"])
    return result


@contextmanager
def connect(path):
    # mode=ro prevents accidental database creation or mutation; WAL remains visible.
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN")
        yield db
    finally:
        db.close()


def unavailable():
    return JSONResponse(status_code=503, content={"error": {"code": "memory_graph_unavailable", "message": "기억 저장소를 읽을 수 없습니다. 새로고침 후 다시 확인해 주세요."}})


def create_router():
    router = APIRouter(prefix="/api/memory-graph", tags=["memory-graph"])

    @router.get("")
    def graph(request: Request, query: str = Query("", max_length=200), group: str = Query("", pattern="^(|reference|problem|solution|pattern)$"), limit: int = Query(500, ge=1, le=500)):
        path = request.app.state.memory_database_path
        groups = [{"id": key, "label": label, "types": list(types)} for key, (label, types) in GROUPS.items()]
        empty = {"nodes": [], "edges": [], "total": 0, "truncated": False, "groups": groups}
        if not path.exists():
            return empty
        clauses, params = [], []
        if query.strip():
            clauses.append("(instr(lower(title), lower(?)) > 0 OR instr(lower(coalesce(summary, '')), lower(?)) > 0 OR instr(lower(tags), lower(?)) > 0)")
            params.extend([query.strip()] * 3)
        if group:
            types = GROUPS[group][1]
            clauses.append("type IN (" + ",".join("?" for _ in types) + ")")
            params.extend(types)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        try:
            with connect(path) as db:
                total = db.execute("SELECT count(*) FROM memories" + where, params).fetchone()[0]
                nodes = [node(row) for row in db.execute("SELECT id, type, title, tags, importance FROM memories" + where + " ORDER BY updated_at DESC, id LIMIT ?", [*params, limit])]
                ids = [n["id"] for n in nodes]
                edges = []
                if ids:
                    placeholders = ",".join("?" for _ in ids)
                    edges = [dict(row) for row in db.execute(f"SELECT id, from_id, to_id, rel_type, strength, context FROM relationships WHERE from_id IN ({placeholders}) AND to_id IN ({placeholders}) ORDER BY id", ids * 2)]
                return {**empty, "nodes": nodes, "edges": edges, "total": total, "truncated": total > len(nodes)}
        except (sqlite3.Error, OSError):
            return unavailable()

    @router.get("/{memory_id}")
    def detail(memory_id: str, request: Request):
        path = request.app.state.memory_database_path
        missing = JSONResponse(status_code=404, content={"error": {"code": "not_found", "message": "기억을 찾을 수 없습니다."}})
        if not path.exists():
            return missing
        try:
            with connect(path) as db:
                row = db.execute("SELECT id, type, title, summary, content, tags, importance, confidence, created_at, updated_at FROM memories WHERE id = ?", (memory_id,)).fetchone()
                if row is None:
                    return missing
                links = [dict(r) for r in db.execute("SELECT r.id, r.from_id, r.to_id, r.rel_type, r.strength, r.context, m.id AS neighbor_id, m.title AS neighbor_title FROM relationships r JOIN memories m ON m.id = CASE WHEN r.from_id = ? THEN r.to_id ELSE r.from_id END WHERE r.from_id = ? OR r.to_id = ? ORDER BY r.id", (memory_id,) * 3)]
                return {"memory": node(row), "relationships": links}
        except (sqlite3.Error, OSError):
            return unavailable()

    return router
