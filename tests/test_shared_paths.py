"""Cross-worktree storage location and version-gate regressions."""

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.harness import review_plans, shared_paths, state_store
from src.harness.hooks.user_prompt_submit import _selection_directory


class SharedPathsTests(unittest.TestCase):
    def test_registered_worktrees_resolve_one_data_directory(self):
        expected = shared_paths.git_common_directory()
        for worktree in shared_paths.registered_worktrees():
            self.assertEqual(shared_paths.git_common_directory(worktree), expected)
        self.assertEqual(state_store.DEFAULT_DATABASE_PATH, expected / "harness-data" / "state.db")

    def test_review_plan_follows_database_but_picker_stays_in_worktree(self):
        database = shared_paths.STATE_DATABASE
        self.assertEqual(
            review_plans._path("RUN-example", database),
            database.parent / "review-plans" / "RUN-example.json",
        )
        self.assertEqual(
            _selection_directory(database),
            state_store.HARNESS_ROOT / "runtime" / "selections",
        )

    def test_conflicting_state_environment_values_are_rejected(self):
        with patch.dict(os.environ, {"HARNESS_STATE_DB": "/tmp/a", "HARNESS_STATE_DATABASE": "/tmp/b"}):
            with self.assertRaisesRegex(RuntimeError, "different databases"):
                shared_paths.state_database_from_environment()

    def test_mismatched_schema_version_rejects_before_schema_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "state.db"
            state_store.initialize_database(database)
            with sqlite3.connect(database) as raw:
                raw.execute("PRAGMA user_version = 2")
            before = database.read_bytes()
            with self.assertRaisesRegex(state_store.ConflictError, "schema version"):
                state_store.initialize_database(database)
            self.assertEqual(database.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
