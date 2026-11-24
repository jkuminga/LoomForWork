"""Black-box installer checks against disposable local projects."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


CLI = Path(__file__).resolve().parents[1] / "installer" / "cli.ts"


@unittest.skipUnless(shutil.which("bun") and shutil.which("uv") and shutil.which("fzf"), "installer prerequisites")
class InstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="codex-compass-installer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)

    def install(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["bun", str(CLI), "install"], cwd=self.project, capture_output=True, text=True)

    def test_existing_project_preserves_shared_content_and_second_install_is_noop(self) -> None:
        subprocess.run(["git", "init", "-q"], cwd=self.project, check=True)
        (self.project / "AGENTS.md").write_text("Existing guidance\n")
        (self.project / ".gitignore").write_text("build/\n")
        (self.project / "package.json").write_text(json.dumps({"name": "existing-project", "scripts": {"test": "echo existing"}}))
        codex = self.project / ".codex"
        codex.mkdir()
        (codex / "hooks.json").write_text(json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo existing"}]}]}, "other": True}))
        (codex / "config.toml").write_text('[mcp_servers.other]\ncommand = "echo"\n')

        first = self.install()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("Existing guidance", (self.project / "AGENTS.md").read_text())
        self.assertIn("build/", (self.project / ".gitignore").read_text())
        hooks = json.loads((codex / "hooks.json").read_text())
        self.assertTrue(hooks["other"])
        self.assertEqual(len(hooks["hooks"]["Stop"]), 2)
        self.assertIn("[mcp_servers.other]", (codex / "config.toml").read_text())
        package = json.loads((self.project / "package.json").read_text())
        self.assertEqual(package["name"], "existing-project")
        self.assertEqual(package["scripts"]["test"], "echo existing")
        self.assertEqual(package["scripts"]["console"], "codex-compass/bin/harness-control-center")
        self.assertEqual(package["scripts"]["verify:install"], "codex-compass/bin/harness-verify-install")
        self.assertEqual(package["scripts"]["worktree:setup"], "codex-compass/bin/harness-configure-worktree")
        self.assertTrue((self.project / "codex-compass/install.json").exists())
        self.assertTrue((self.project / ".agents/skills/extract-features/SKILL.md").is_file())
        record = json.loads((self.project / "codex-compass/install.json").read_text())
        self.assertIn("extract-features", record["installed_skills"])
        verify = subprocess.run(
            ["python3", "codex-compass/bin/harness-verify-install"],
            cwd=self.project, capture_output=True, text=True,
        )
        self.assertEqual(verify.returncode, 0, verify.stderr)

        before = (self.project / "AGENTS.md").read_bytes()
        second = self.install()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((self.project / "AGENTS.md").read_bytes(), before)

        (self.project / ".codex/hooks.json").unlink()
        verify_missing = subprocess.run(
            ["python3", "codex-compass/bin/harness-verify-install"],
            cwd=self.project, capture_output=True, text=True,
        )
        self.assertNotEqual(verify_missing.returncode, 0)
        self.assertIn(".codex/hooks.json", verify_missing.stderr)

    def test_script_name_collision_preserves_package(self) -> None:
        original = '{"scripts":{"console":"other-command"}}\n'
        (self.project / "package.json").write_text(original)

        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("이미 다른 console 스크립트", result.stderr)
        self.assertEqual((self.project / "package.json").read_text(), original)
        self.assertFalse((self.project / "codex-compass").exists())

    def test_new_project_gets_package_scripts(self) -> None:
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        package = json.loads((self.project / "package.json").read_text())
        self.assertEqual(package["scripts"]["console"], "codex-compass/bin/harness-control-center")
        self.assertEqual(package["scripts"]["verify:install"], "codex-compass/bin/harness-verify-install")
        self.assertEqual(package["scripts"]["worktree:setup"], "codex-compass/bin/harness-configure-worktree")
        self.assertTrue((self.project / "codex-compass/tests/test_configure_worktree.py").is_file())
        console_help = subprocess.run(["bun", "run", "console", "--help"], cwd=self.project, capture_output=True, text=True)
        self.assertEqual(console_help.returncode, 0, console_help.stderr)
        verify_command = subprocess.run(["bun", "run", "verify:install"], cwd=self.project, capture_output=True, text=True)
        self.assertEqual(verify_command.returncode, 0, verify_command.stderr)
        config = self.project / ".codex/config.toml"
        config.write_text(config.read_text().replace(str(self.project / "codex-compass"), "/old/worktree/codex-compass"))
        worktree_command = subprocess.run(["bun", "run", "worktree:setup"], cwd=self.project, capture_output=True, text=True)
        self.assertEqual(worktree_command.returncode, 0, worktree_command.stderr)
        expected_cwd = self.project.resolve() / "codex-compass"
        self.assertEqual(config.read_text().count(f'cwd = "{expected_cwd}"'), 2)
        self.assertTrue((self.project / ".git").is_dir())

    def test_mcp_name_collision_changes_nothing(self) -> None:
        codex = self.project / ".codex"
        codex.mkdir()
        original = '[mcp_servers.harness-state]\ncommand = "other"\n'
        (codex / "config.toml").write_text(original)

        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("이미 있습니다", result.stderr)
        self.assertEqual((codex / "config.toml").read_text(), original)
        self.assertFalse((self.project / "codex-compass").exists())
        self.assertFalse((self.project / ".git").exists())


if __name__ == "__main__":
    unittest.main()
