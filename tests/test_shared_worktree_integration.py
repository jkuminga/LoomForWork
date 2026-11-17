"""Real linked-worktree regression for the two shared Harness databases.

The fixture is a fresh temporary Git repository. It never opens this checkout's
state.db or memorygraph.db. Run with ``.venv/bin/python -m unittest tests.test_shared_worktree_integration``.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]

STATE_PROGRAM = r"""
import json
import sys
from src.harness import shared_paths, state_store

action = sys.argv[1]
if action == "init":
    state_store.initialize_database(state_store.DEFAULT_DATABASE_PATH)
    print(json.dumps({"database": str(shared_paths.STATE_DATABASE)}))
elif action == "write":
    item = state_store.create_ready_work_item(
        title="Shared worktree test", kind="verification", goal="Check shared storage",
        next_action="Read from the other worktree", acceptance_criteria=["Records are visible"],
        actor="test",
    )
    run = state_store.start_run(
        item["id"], intent="Check cross-worktree access", recall_query="shared worktree test",
        actor="test",
    )
    print(json.dumps({"work_item_id": item["id"], "run_id": run["id"],
                      "database": str(shared_paths.STATE_DATABASE)}))
elif action == "read":
    item_id, run_id = sys.argv[2:4]
    item = state_store.get_preflight_context(item_id)["work_item"]
    run = state_store.get_run(run_id)
    print(json.dumps({"work_item_id": item["id"], "run_id": run["id"],
                      "database": str(shared_paths.STATE_DATABASE)}))
else:
    raise ValueError(action)
"""

MEMORY_PROGRAM = r"""
import { openMemoryFinalizeClient, resolveMemoryDatabasePath } from "./src/harness/memory/client.ts";

const [action, projectRoot, memoryId] = process.argv.slice(2);
const database = resolveMemoryDatabasePath(projectRoot);
const connection = await openMemoryFinalizeClient(database);
try {
  if (action === "write") {
    await connection.client.createMemory({
      id: memoryId, type: "project", title: "Shared worktree test",
      content: "Visible from the other worktree",
    });
  }
  const memory = await connection.client.getMemory(memoryId);
  if (!memory || memory.id !== memoryId) throw new Error(`Memory not found: ${memoryId}`);
  console.log(JSON.stringify({ id: memory.id, database }));
} finally {
  await connection.close();
}
"""


class SharedWorktreeIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("git") is None or shutil.which("bun") is None:
            self.skipTest("git and bun are required for the cross-worktree integration test")
        self.temporary = tempfile.TemporaryDirectory(prefix="harness-worktree-test-")
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.primary = root / "primary"
        self.secondary = root / "secondary"
        self.primary.mkdir()
        (self.primary / "src").mkdir()
        shutil.copy2(PROJECT_ROOT / "src" / "__init__.py", self.primary / "src" / "__init__.py")
        shutil.copytree(
            PROJECT_ROOT / "src" / "harness", self.primary / "src" / "harness",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        shutil.copytree(
            PROJECT_ROOT / "codex-compass" / "vendor" / "memory-graph" / "ts" / "src",
            self.primary / "codex-compass" / "vendor" / "memory-graph" / "ts" / "src",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        (self.primary / ".harness").mkdir()
        shutil.copy2(PROJECT_ROOT / ".harness" / "schema.sql", self.primary / ".harness" / "schema.sql")
        self._git("init", "-q", str(self.primary))
        self._git("-C", str(self.primary), "add", "src", "codex-compass/vendor/memory-graph/ts/src", ".harness/schema.sql")
        self._git("-C", str(self.primary), "-c", "user.name=Harness Test",
                  "-c", "user.email=harness-test@example.invalid", "commit", "-qm", "fixture")
        self._git("-C", str(self.primary), "worktree", "add", "-q", "-b", "secondary",
                  str(self.secondary))

        # The copied driver and client resolve relative to each fixture worktree.
        for worktree in (self.primary, self.secondary):
            driver = worktree / "memory-driver.ts"
            driver.write_text(MEMORY_PROGRAM)
        self._state(self.primary, "init")

    @staticmethod
    def _git(*arguments: str) -> None:
        subprocess.run(["git", *arguments], check=True, capture_output=True, text=True)

    def _state(self, worktree: Path, action: str, *arguments: str) -> dict[str, str]:
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(worktree)
        environment.pop("HARNESS_STATE_DB", None)
        environment.pop("HARNESS_STATE_DATABASE", None)
        result = subprocess.run(
            [sys.executable, "-c", STATE_PROGRAM, action, *arguments],
            cwd=worktree, env=environment, capture_output=True, text=True,
        )
        if result.returncode:
            self.fail(f"State subprocess failed ({result.returncode}): {result.stderr.strip()}")
        return json.loads(result.stdout)

    def _memory(self, worktree: Path, action: str, memory_id: str) -> dict[str, str]:
        environment = os.environ.copy()
        environment.pop("HARNESS_MEMORY_DB_PATH", None)
        result = subprocess.run(
            ["bun", "run", "memory-driver.ts", action, str(worktree), memory_id],
            cwd=worktree, env=environment, capture_output=True, text=True,
        )
        if result.returncode:
            self.fail(f"MemoryGraph subprocess failed ({result.returncode}): {result.stderr.strip()}")
        return json.loads(result.stdout)

    def test_state_and_memorygraph_are_accessible_from_both_worktrees(self) -> None:
        common = self.primary / ".git" / "harness-data"
        for writer, reader in ((self.primary, self.secondary), (self.secondary, self.primary)):
            with self.subTest(writer=writer.name):
                written = self._state(writer, "write")
                read = self._state(reader, "read", written["work_item_id"], written["run_id"])
                self.assertEqual(read, written)
                self.assertEqual(Path(read["database"]).resolve(), (common / "state.db").resolve())

                memory_id = f"shared-{writer.name}"
                created = self._memory(writer, "write", memory_id)
                observed = self._memory(reader, "read", memory_id)
                self.assertEqual(observed, created)
                self.assertEqual(Path(observed["database"]).resolve(), (common / "memorygraph.db").resolve())


if __name__ == "__main__":
    unittest.main()
