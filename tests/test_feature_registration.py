import json
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.harness import state_store
from src.harness.feature_registration import CandidateError, register_candidates


def candidate(vendor_id: str) -> dict:
    return {
        "vendor_id": vendor_id,
        "title": f"작업 {vendor_id}",
        "goal": "기능을 구현한다.",
        "kind": "implementation",
        "priority": "normal",
        "acceptance_criteria": [f"{vendor_id} 결과를 확인한다."],
        "origin": {"moscow": "Must", "complexity": "Medium", "requirements": ["FR-1"]},
        "notes": "권한을 확인한다." if vendor_id == "F1" else "",
    }


class FeatureRegistrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        root = Path(self.temporary_directory.name)
        self.database_path = root / "state.db"
        self.candidate_path = root / "candidates.json"
        state_store.initialize_database(self.database_path)
        self.data = {
            "schema_version": 2,
            "source_prd": "docs/prd/example.prd.md",
            "features": [
                {
                    "key": "G-001",
                    "target": {
                        "mode": "create",
                        "title": "문서 연결",
                        "goal": "문서를 읽는다.",
                        "priority": "high",
                    },
                    "work_items": [candidate("F1"), candidate("F2")],
                }
            ],
        }
        self.save()

    def save(self) -> None:
        self.candidate_path.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")

    def test_registers_feature_work_items_criteria_and_description(self) -> None:
        result = register_candidates(self.candidate_path, database_path=self.database_path)

        self.assertEqual((result["succeeded"], result["failed"]), (2, 0))
        group = result["features"][0]
        self.assertEqual(group["action"], "created")
        feature = state_store.get_feature(group["feature_id"], database_path=self.database_path)
        self.assertEqual(feature["title"], "문서 연결")
        for registered in group["work_items"]:
            context = state_store.get_work_item_context(
                registered["work_item_id"], database_path=self.database_path
            )
            item = context["work_item"]
            self.assertEqual(item["feature_id"], feature["id"])
            self.assertEqual((item["status"], item["is_draft"]), ("backlog", 0))
            self.assertIn("PRD 요구사항: FR-1", item["description"])
            self.assertEqual(len(context["acceptance_criteria"]), 1)
        first = state_store.get_work_item_context(
            group["work_items"][0]["work_item_id"], database_path=self.database_path
        )["work_item"]
        self.assertIn("구현 메모: 권한을 확인한다.", first["description"])

    def test_failed_item_can_be_retried_with_returned_parent_id(self) -> None:
        original = state_store.create_work_item

        def fail_second(**kwargs):
            if kwargs["title"] == "작업 F2":
                raise state_store.ConflictError("simulated write failure")
            return original(**kwargs)

        with patch("src.harness.feature_registration.state_store.create_work_item", side_effect=fail_second):
            first = register_candidates(self.candidate_path, database_path=self.database_path)

        self.assertEqual((first["succeeded"], first["failed"]), (1, 1))
        parent_id = first["features"][0]["feature_id"]
        self.assertEqual(first["features"][0]["work_items"][1]["vendor_id"], "F2")
        retry = first["retry"]
        self.assertIn("실패한 WI 후보만", retry["message"])
        retry_args = shlex.split(retry["command"])
        self.assertEqual(retry_args.count("--only"), 1)
        self.assertEqual(retry_args[retry_args.index("--only") + 1], "F2")
        self.assertIn(f"G-001={parent_id}", retry_args)
        completed = subprocess.run(retry_args, check=False, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        second = json.loads(completed.stdout)
        self.assertEqual((second["succeeded"], second["failed"]), (1, 0))
        self.assertEqual(second["features"][0]["action"], "existing")
        self.assertEqual(second["features"][0]["feature_id"], parent_id)
        self.assertNotIn("retry", second)
        self.assertEqual(len(state_store.list_features(database_path=self.database_path)), 1)
        self.assertEqual(len(state_store.list_work_items(database_path=self.database_path)), 2)

    def test_reuses_existing_feature(self) -> None:
        existing = state_store.create_feature(
            title="문서 연결", goal="문서를 읽는다.", actor="test", database_path=self.database_path
        )
        self.data["features"][0]["target"] = {"mode": "reuse", "feature_id": existing["id"]}
        self.save()

        result = register_candidates(self.candidate_path, database_path=self.database_path)

        self.assertEqual(result["features"][0]["feature_id"], existing["id"])
        self.assertEqual(result["features"][0]["action"], "existing")
        self.assertEqual(len(state_store.list_features(database_path=self.database_path)), 1)

    def test_invalid_candidates_fail_before_any_write(self) -> None:
        self.data["features"][0]["work_items"][1]["origin"]["requirements"] = ["invalid"]
        self.save()

        with self.assertRaisesRegex(CandidateError, "invalid requirement ID"):
            register_candidates(self.candidate_path, database_path=self.database_path)

        self.assertEqual(state_store.list_features(database_path=self.database_path), [])

    def test_cli_prints_registration_result(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "src.harness.feature_registration",
                str(self.candidate_path),
                "--database",
                str(self.database_path),
                "--only",
                "F1",
            ],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual((result["succeeded"], result["failed"]), (1, 0))
        self.assertEqual(result["features"][0]["work_items"][0]["vendor_id"], "F1")

    def test_cli_prints_retry_guidance_on_failure(self) -> None:
        self.data["features"][0]["target"] = {
            "mode": "reuse", "feature_id": "FEAT-missing"
        }
        self.save()
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "src.harness.feature_registration",
                str(self.candidate_path),
                "--database",
                str(self.database_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 1)
        result = json.loads(completed.stdout)
        self.assertEqual(result["failed"], 2)
        self.assertIn("--only F1", result["retry"]["command"])
        self.assertIn("--only F2", result["retry"]["command"])


if __name__ == "__main__":
    unittest.main()
