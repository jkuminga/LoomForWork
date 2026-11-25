"""Shared Harness storage paths for worktrees of one Git repository."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


HARNESS_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = HARNESS_ROOT.parent


def git_common_directory(worktree: str | Path = PROJECT_ROOT) -> Path:
    result = subprocess.run(
        ["git", "-C", str(worktree), "rev-parse", "--path-format=absolute", "--git-common-dir"],
        text=True, capture_output=True, check=False,
    )
    if result.returncode or not result.stdout.strip():
        raise RuntimeError(f"Git common directory lookup failed for {worktree}: {result.stderr.strip()}")
    return Path(result.stdout.strip()).resolve()


def registered_worktrees(worktree: str | Path = PROJECT_ROOT) -> list[Path]:
    result = subprocess.run(
        ["git", "-C", str(worktree), "worktree", "list", "--porcelain"],
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Git worktree lookup failed: {result.stderr.strip()}")
    return [Path(line.removeprefix("worktree ")) for line in result.stdout.splitlines() if line.startswith("worktree ")]


def require_migrated_before_create(database: Path, legacy_name: str) -> None:
    if database.exists():
        return
    for worktree in registered_worktrees():
        if (worktree / ".harness" / legacy_name).exists():
            raise RuntimeError(f"shared {legacy_name} is missing; migrate the worktree database first")


DATA_DIRECTORY = git_common_directory() / "harness-data"
STATE_DATABASE = DATA_DIRECTORY / "state.db"
BINDINGS_DIRECTORY = DATA_DIRECTORY / "runtime" / "bindings"


def state_database_from_environment() -> Path:
    primary = os.environ.get("HARNESS_STATE_DB", "").strip()
    legacy = os.environ.get("HARNESS_STATE_DATABASE", "").strip()
    if primary and legacy and Path(primary).resolve() != Path(legacy).resolve():
        raise RuntimeError("HARNESS_STATE_DB and HARNESS_STATE_DATABASE specify different databases")
    return Path(primary or legacy) if primary or legacy else STATE_DATABASE
