"""Read-only regression checks for the closeout payload comparison."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin"))

from token_cost_compare_common import DEFAULT_DB, DEFAULT_RUN, measure


def test_legacy_and_current_use_same_fixture_without_writes() -> None:
    before = hashlib.sha256(DEFAULT_DB.read_bytes()).hexdigest()

    legacy = measure(DEFAULT_DB, DEFAULT_RUN, legacy=True)
    current = measure(DEFAULT_DB, DEFAULT_RUN, legacy=False)

    assert legacy["event_count"] == current["event_count"] == 20
    assert legacy["source_sha256"] == current["source_sha256"] == before
    assert hashlib.sha256(DEFAULT_DB.read_bytes()).hexdigest() == before
    assert current["total_chars"] < legacy["total_chars"]
    assert "review_status_recheck" in legacy["component_chars"]
    assert "review_status_recheck" not in current["component_chars"]
    assert current["component_chars"]["finalize_review_plan"] < legacy["component_chars"]["finalize_review_plan"]
