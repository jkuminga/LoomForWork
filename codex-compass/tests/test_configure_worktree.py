"""Tests for the worktree MCP path setup command shipped with the Harness."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "bin/harness-configure-worktree"


class ConfigureWorktreeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="codex-compass-worktree-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / "codex-compass/bin").mkdir(parents=True)
        (self.root / ".codex").mkdir()
        shutil.copy2(SCRIPT, self.root / "codex-compass/bin/harness-configure-worktree")
        self.config = self.root / ".codex/config.toml"

    def run_script(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(self.root / "codex-compass/bin/harness-configure-worktree")],
            cwd=self.root, capture_output=True, text=True,
        )

    def test_changes_only_harness_paths_and_is_repeatable(self) -> None:
        self.config.write_text(
            '[mcp_servers.other]\ncwd = "/keep/me"\n\n'
            '[mcp_servers.harness-state]\ncwd = "/old/one"\n\n'
            '[mcp_servers.harness-memory]\ncwd = "/old/two"\n'
        )
        first = self.run_script()
        self.assertEqual(first.returncode, 0, first.stderr)
        updated = self.config.read_text()
        self.assertEqual(updated.count(f'cwd = "{self.root}/codex-compass"'), 2)
        self.assertIn('cwd = "/keep/me"', updated)
        second = self.run_script()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.config.read_text(), updated)

    def test_missing_harness_setting_does_not_change_file(self) -> None:
        original = '[mcp_servers.harness-state]\ncwd = "/old/one"\n'
        self.config.write_text(original)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.config.read_text(), original)


if __name__ == "__main__":
    unittest.main()
