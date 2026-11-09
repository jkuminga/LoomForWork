import copy
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.harness import hook_policy, review_plans as plans, runtime_binding, state_store as store, work_item_picker
from src.harness.hooks import post_tool_use, user_prompt_submit


class ReviewPlanTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.db = Path(self.temporary.name) / "state.db"
        store.initialize_database(self.db)
        self.item = store.create_ready_work_item(
            title="Review Plan", kind="verification", goal="Review and recover events",
            next_action="Implement review", acceptance_criteria=["Proof is stored"],
            actor="test", database_path=self.db,
        )
        self.ac = store.get_preflight_context(self.item["id"], database_path=self.db)["acceptance_criteria"][0]["id"]
        self.run = store.start_run(self.item["id"], intent="Review", recall_query="review plans", actor="test", database_path=self.db)["id"]
        self.event = self.add_event("tool-1")

    def add_event(self, tool_id):
        return store.record_run_tool_event(
            self.run, tool_use_id=tool_id, tool_name="exec_command", tool_family="bash",
            status="succeeded", exit_code=0, input_summary="pytest", result_summary="42 passed", database_path=self.db,
        )

    def decision(self, event=None, choice="artifact_evidence"):
        return {
            "event_id": (event or self.event)["id"], "decision": choice, "reason": "test result",
            "artifact": None if choice == "exclude" else {"kind": "test_run", "verification_status": "passed", "summary": "42 tests passed", "uri": None},
            "evidence": [{"criterion_id": self.ac, "result": "passed", "note": "tests", "reason": "tests passed"}] if choice == "artifact_evidence" else [],
        }

    def plan(self, decisions=None):
        snapshot = store.get_run_tool_event_snapshot(self.run, database_path=self.db)
        return {"schema_version": 1, "run_id": self.run, "work_item_id": self.item["id"],
                "snapshot_max_seq": snapshot["snapshot_max_seq"], "events": decisions if decisions is not None else [self.decision()]}

    def plan_v2(self, decisions=None):
        original = self.plan(decisions)
        return {
            "schema_version": 2, "run_id": original["run_id"],
            "work_item_id": original["work_item_id"],
            "snapshot_max_seq": original["snapshot_max_seq"],
            "decisions": [row for row in original["events"] if row["decision"] != "exclude"],
            "excluded_event_ids": [row["event_id"] for row in original["events"] if row["decision"] == "exclude"],
        }

    def finish(self):
        return store.finish_run(self.run, run_status="succeeded", work_item_status="ready", summary="done",
                                next_action="continue", actor="test", reason="test", database_path=self.db)

    def save(self, plan=None):
        return plans.save_review_plan(self.run, plan or self.plan(), database_path=self.db)

    def test_snapshot_is_ordered_and_duplicate_hook_delivery_is_idempotent(self):
        duplicate = self.add_event("tool-1")
        second = self.add_event("tool-2")
        self.assertEqual(duplicate["id"], self.event["id"])
        snapshot = store.get_run_tool_event_snapshot(self.run, database_path=self.db)
        self.assertEqual(snapshot["snapshot_max_seq"], 2)
        self.assertEqual([row["id"] for row in snapshot["events"]], [self.event["id"], second["id"]])

    def test_validation_rejects_missing_duplicate_foreign_and_invalid_targets(self):
        plan = self.plan()
        variants = []
        missing = copy.deepcopy(plan); missing["events"] = []; variants.append(missing)
        duplicate = copy.deepcopy(plan); duplicate["events"] *= 2; variants.append(duplicate)
        foreign = copy.deepcopy(plan); foreign["events"][0]["evidence"][0]["criterion_id"] = "AC-other"; variants.append(foreign)
        failed = copy.deepcopy(plan); failed["events"][0]["artifact"]["verification_status"] = "failed"; variants.append(failed)
        wrong_owner = copy.deepcopy(plan); wrong_owner["work_item_id"] = "WI-other"; variants.append(wrong_owner)
        boolean = copy.deepcopy(plan); boolean["snapshot_max_seq"] = True; variants.append(boolean)
        for value in variants:
            with self.subTest(value=value):
                with self.assertRaises(store.ConflictError):
                    self.save(value)
        self.assertEqual(store.get_run_artifacts(self.run, database_path=self.db), [])

    def test_v2_exclusions_are_compact_and_require_exact_coverage(self):
        second = self.add_event("second")
        plan = self.plan_v2([self.decision(), self.decision(second, "exclude")])
        saved = self.save(plan)
        self.assertEqual(saved["event_count"], 2)
        self.assertEqual(plans.load_review_plan(self.run, database_path=self.db), plan)
        self.assertEqual(plan["excluded_event_ids"], [second["id"]])
        self.assertNotIn("reason", json.dumps(plan["excluded_event_ids"]))
        artifact = store.create_artifact(self.run, source_event_id=self.event["id"], **self.decision()["artifact"], actor="test", database_path=self.db)
        store.verify_criterion_with_evidence(self.ac, artifact["id"], "passed", database_path=self.db)
        finalized = plans.finalize_review_plan(self.run, database_path=self.db)
        self.assertTrue(finalized["ae_complete"])
        self.assertEqual(finalized["reviewed_count"], 2)
        self.assertNotIn("reviewed_event_ids", finalized)
        self.assertEqual(finalized["unreviewed_event_ids"], [])
        self.finish()
        self.assertTrue(plans.delete_review_plan(self.run, database_path=self.db)["deleted"])

    def test_apply_event_reads_saved_values_and_reuses_partial_result(self):
        planned = self.decision()
        planned["artifact"]["summary"] = "summary from immutable plan"
        self.save(self.plan_v2([planned]))
        with patch.object(store, "verify_criterion_with_evidence", side_effect=store.ConflictError("temporary error")):
            with self.assertRaisesRegex(store.ConflictError, "temporary error"):
                plans.apply_review_plan_event(self.run, self.event["id"], database_path=self.db)

        first = store.get_run_artifacts(self.run, database_path=self.db)[0]
        self.assertEqual(first["summary"], "summary from immutable plan")
        result = plans.apply_review_plan_event(self.run, self.event["id"], database_path=self.db)
        replay = plans.apply_review_plan_event(self.run, self.event["id"], database_path=self.db)
        self.assertEqual(result["artifact"]["id"], first["id"])
        self.assertEqual(replay["artifact"]["id"], first["id"])
        self.assertEqual(len(store.get_run_artifacts(self.run, database_path=self.db)), 1)
        self.assertTrue(plans.finalize_review_plan(self.run, database_path=self.db)["ae_complete"])

    def test_apply_event_requires_saved_artifact_decision(self):
        with self.assertRaises(store.ConflictError):
            plans.apply_review_plan_event(self.run, self.event["id"], database_path=self.db)
        self.save(self.plan_v2([self.decision(choice="exclude")]))
        with self.assertRaisesRegex(store.ConflictError, "no Artifact decision"):
            plans.apply_review_plan_event(self.run, self.event["id"], database_path=self.db)

    def test_v2_rejects_missing_duplicate_foreign_and_out_of_boundary_exclusions(self):
        second = self.add_event("second")
        base = self.plan_v2([self.decision(), self.decision(second, "exclude")])
        variants = []
        for ids in ([], [second["id"], second["id"]], ["EVT-foreign"], [self.event["id"]]):
            value = copy.deepcopy(base); value["excluded_event_ids"] = ids; variants.append(value)
        wrong_choice = copy.deepcopy(base); wrong_choice["decisions"][0]["decision"] = "exclude"; variants.append(wrong_choice)
        wrong_version = copy.deepcopy(base); wrong_version["schema_version"] = True; variants.append(wrong_version)
        bad_boundary = copy.deepcopy(base); bad_boundary["snapshot_max_seq"] = 1; variants.append(bad_boundary)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(store.ConflictError):
                plans.validate_review_plan(value, run_id=self.run, database_path=self.db)

    def test_v2_recovery_applies_only_missing_artifacts_and_acknowledges_exclusions(self):
        second = self.add_event("second")
        plan = self.plan_v2([self.decision(), self.decision(second, "exclude")])
        self.save(plan)
        self.finish()
        recovered = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertTrue(recovered["ae_complete"])
        self.assertEqual(recovered["reviewed_count"], 2)
        self.assertNotIn("reviewed_event_ids", recovered)
        self.assertTrue(recovered["deleted"])
        self.assertEqual(recovered["unreviewed_event_ids"], [])
        self.assertEqual(len(store.get_run_artifacts(self.run, database_path=self.db)), 1)
        self.assertEqual(len(store.get_criterion_evidence(self.ac, database_path=self.db)), 1)

    def test_plan_is_immutable_private_and_coverage_survives_later_events(self):
        self.save()
        late = self.add_event("late")
        saved = plans.load_review_plan(self.run, database_path=self.db)
        self.assertEqual(saved["snapshot_max_seq"], 1)
        self.assertNotIn(late["id"], [row["event_id"] for row in saved["events"]])
        self.save(saved)
        saved["events"][0]["reason"] = "changed"
        with self.assertRaises(store.ConflictError):
            self.save(saved)
        directory = self.db.parent / "review-plans"
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((directory / f"{self.run}.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(directory.glob(".review-*")), [])

    def test_symlinks_and_path_traversal_are_rejected(self):
        with self.assertRaises(store.ConflictError):
            plans.load_review_plan("../../outside", database_path=self.db)
        outside = self.db.parent / "outside.json"
        outside.write_text(json.dumps(self.plan()))
        directory = self.db.parent / "review-plans"; directory.mkdir()
        (directory / f"{self.run}.json").symlink_to(outside)
        with self.assertRaises(store.ConflictError):
            plans.load_review_plan(self.run, database_path=self.db)
        self.assertEqual(json.loads(outside.read_text())["run_id"], self.run)

    def test_finalization_retains_missing_ae_and_acknowledges_only_late_events(self):
        self.save()
        late = self.add_event("late")
        result = plans.finalize_review_plan(self.run, database_path=self.db)
        self.assertFalse(result["ae_complete"])
        self.assertEqual(result["reviewed_count"], 1)
        self.assertEqual(result["unreviewed_event_ids"], [self.event["id"]])
        rows = store.list_run_tool_events(self.run, database_path=self.db)
        self.assertEqual(rows[1]["id"], late["id"])
        self.assertIsNotNone(rows[1]["reviewed_at"])
        self.assertEqual(rows[1]["input_summary"], "")
        self.assertEqual(rows[0]["input_summary"], "pytest")

    def test_acknowledgement_batch_is_atomic(self):
        with self.assertRaises(store.NotFoundError):
            store.mark_tool_events_reviewed(self.run, [self.event["id"], "EVT-missing"], database_path=self.db)
        row = store.list_run_tool_events(self.run, database_path=self.db)[0]
        self.assertIsNone(row["reviewed_at"])
        self.assertEqual(row["result_summary"], "42 passed")
        database = store.open_database(self.db)
        database.execute("""CREATE TRIGGER force_ack_failure BEFORE UPDATE ON run_tool_events
                            BEGIN SELECT RAISE(ABORT, 'test acknowledgement failure'); END""")
        database.commit(); database.close()
        with self.assertRaises(store.ConflictError):
            store.mark_tool_events_reviewed(self.run, [self.event["id"]], database_path=self.db)
        row = store.list_run_tool_events(self.run, database_path=self.db)[0]
        self.assertIsNone(row["reviewed_at"])
        self.assertEqual(row["input_summary"], "pytest")

    def test_evidence_and_criterion_failure_roll_back_together(self):
        artifact = store.create_artifact(self.run, **self.decision()["artifact"], actor="test", database_path=self.db)
        database = store.open_database(self.db)
        database.execute("""CREATE TRIGGER force_ac_failure BEFORE UPDATE ON acceptance_criteria
                            BEGIN SELECT RAISE(ABORT, 'test AC failure'); END""")
        database.commit(); database.close()
        with self.assertRaises(store.ConflictError):
            store.verify_criterion_with_evidence(self.ac, artifact["id"], "passed", database_path=self.db)
        self.assertEqual(store.get_criterion_evidence(self.ac, database_path=self.db), [])

    def test_passing_criterion_can_receive_more_evidence_without_rewriting_judgment(self):
        first = store.create_artifact(self.run, **self.decision()["artifact"], actor="test", database_path=self.db)
        store.verify_criterion_with_evidence(self.ac, first["id"], "passed", database_path=self.db)
        before = store.get_run_review_context(self.run, database_path=self.db)["acceptance_criteria"][0]["resolved_at"]
        second = store.create_artifact(self.run, kind="file", uri="src/a.py", verification_status="not_applicable", summary="file", actor="test", database_path=self.db)
        for _ in range(2):
            store.verify_criterion_with_evidence(self.ac, second["id"], "passed", database_path=self.db)
        self.assertEqual(len(store.get_criterion_evidence(self.ac, database_path=self.db)), 2)
        self.assertEqual(store.get_run_review_context(self.run, database_path=self.db)["acceptance_criteria"][0]["resolved_at"], before)
        failed = store.create_artifact(self.run, kind="test_run", verification_status="failed", summary="older failed check", actor="test", database_path=self.db)
        retained = store.verify_criterion_with_evidence(self.ac, failed["id"], "failed", database_path=self.db)
        self.assertEqual(retained["criterion"]["status"], "passed")
        self.assertEqual(retained["criterion"]["resolved_at"], before)

    def test_recovery_reuses_partial_result_and_cleans_original_run_plan(self):
        self.save()
        existing = store.create_artifact(self.run, source_event_id=self.event["id"], **self.decision()["artifact"], actor="test", database_path=self.db)
        self.finish()
        result = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertTrue(result["ae_complete"])
        self.assertTrue(result["deleted"])
        self.assertEqual(result["unreviewed_event_ids"], [])
        self.assertEqual(store.get_run_artifacts(self.run, database_path=self.db)[0]["id"], existing["id"])
        replay = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertTrue(replay["ae_complete"])
        self.assertEqual(len(store.get_criterion_evidence(self.ac, database_path=self.db)), 1)

    def test_recovery_reports_missing_plan_without_acknowledging_events(self):
        self.finish()
        result = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertEqual(result, {
            "run_id": self.run,
            "recovery_status": "plan_missing",
            "unreviewed_event_ids": [self.event["id"]],
            "inconsistent_event_ids": [],
        })
        event = store.list_run_tool_events(self.run, database_path=self.db)[0]
        self.assertIsNone(event["reviewed_at"])
        self.assertEqual(event["result_summary"], "42 passed")

    def test_recovery_keeps_corrupt_plan_as_an_error(self):
        self.save(); self.finish()
        path = self.db.parent / "review-plans" / f"{self.run}.json"
        path.write_text("broken")
        with self.assertRaisesRegex(store.ConflictError, "Review Plan unavailable"):
            plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertEqual(path.read_text(), "broken")

    def test_recovery_partial_failure_preserves_plan_and_successful_events(self):
        second = self.add_event("second")
        decisions = [self.decision(), self.decision(second, "exclude")]
        self.save(self.plan(decisions))
        self.finish()
        with patch.object(store, "verify_criterion_with_evidence", side_effect=store.ConflictError("simulated failure")):
            result = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertFalse(result["ae_complete"])
        self.assertEqual(result["unreviewed_event_ids"], [self.event["id"]])
        self.assertTrue((self.db.parent / "review-plans" / f"{self.run}.json").exists())
        result = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertTrue(result["deleted"])

    def test_recovery_does_not_acknowledge_after_ack_transaction_failure(self):
        self.save(); self.finish()
        with patch.object(store, "mark_tool_events_reviewed", side_effect=store.ConflictError("simulated ack failure")):
            result = plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.assertIn("acknowledgement_error", result)
        self.assertEqual(result["unreviewed_event_ids"], [self.event["id"]])
        self.assertEqual(len(store.get_criterion_evidence(self.ac, database_path=self.db)), 1)
        self.assertTrue(plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)["deleted"])

    def test_recovery_and_generic_writers_have_different_authorization(self):
        self.save()
        with self.assertRaises(store.ConflictError):
            plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)
        self.finish()
        with self.assertRaises(store.ConflictError):
            store.create_artifact(self.run, **self.decision()["artifact"], actor="test", database_path=self.db)
        with self.assertRaises(store.StateStoreError):
            plans.recover_review_plan("WI-other", self.run, database_path=self.db)
        store.start_run(self.item["id"], intent="Another", recall_query="another", actor="test", database_path=self.db)
        with self.assertRaises(store.ConflictError):
            plans.recover_review_plan(self.item["id"], self.run, database_path=self.db)

    def test_planless_recovery_only_acknowledges_supplied_decisions(self):
        second = self.add_event("second"); self.finish()
        result = plans.apply_unplanned_review_recovery(self.item["id"], self.run, [self.decision(choice="exclude")], database_path=self.db)
        self.assertEqual(result["unreviewed_event_ids"], [second["id"]])
        self.assertFalse((self.db.parent / "review-plans").exists())

    def test_corrupt_plan_is_preserved_during_fallback_and_cleanup(self):
        self.save(); self.finish()
        path = self.db.parent / "review-plans" / f"{self.run}.json"
        path.write_text("broken")
        result = plans.apply_unplanned_review_recovery(self.item["id"], self.run, [self.decision(choice="exclude")], database_path=self.db)
        self.assertEqual(result["unreviewed_event_ids"], [])
        self.assertTrue(plans.cleanup_orphan_review_plans(database_path=self.db)["warnings"])
        self.assertEqual(path.read_text(), "broken")

    def test_cleanup_preserves_running_and_unreviewed_then_deletes_terminal_orphan(self):
        self.save(self.plan([self.decision(choice="exclude")]))
        self.assertEqual(plans.cleanup_orphan_review_plans(database_path=self.db)["deleted_run_ids"], [])
        plans.finalize_review_plan(self.run, database_path=self.db)
        self.assertEqual(plans.cleanup_orphan_review_plans(database_path=self.db)["deleted_run_ids"], [])
        self.finish()
        self.assertEqual(plans.cleanup_orphan_review_plans(database_path=self.db)["deleted_run_ids"], [self.run])

    def test_failed_finish_preserves_json_until_stale_recovery(self):
        self.save(self.plan([self.decision(choice="exclude")]))
        plans.finalize_review_plan(self.run, database_path=self.db)
        with self.assertRaises(store.ConflictError):
            store.finish_run(self.run, run_status="succeeded", work_item_status="ready", summary="done", actor="test", reason="test", database_path=self.db)
        with self.assertRaises(store.ConflictError):
            plans.delete_review_plan(self.run, database_path=self.db)
        store.recover_stale_run(self.item["id"], expected_run_id=self.run, actor="test", database_path=self.db)
        self.assertTrue(plans.delete_review_plan(self.run, database_path=self.db)["deleted"])

    def test_duplicate_artifact_kinds_cannot_bypass_one_evt_rule(self):
        store.create_artifact(self.run, source_event_id=self.event["id"], **self.decision()["artifact"], actor="test", database_path=self.db)
        with self.assertRaises(store.ConflictError):
            store.create_artifact(self.run, source_event_id=self.event["id"], kind="file", verification_status="passed", summary="same source", actor="test", database_path=self.db)

    def test_hook_write_failure_is_context_feedback_and_does_not_block(self):
        bindings = self.db.parent / "bindings"
        runtime_binding.save_binding(session_id="session", turn_id="turn", work_item_id=self.item["id"], run_id=self.run, bindings_directory=bindings)
        event = {"session_id": "session", "turn_id": "turn", "tool_name": "exec_command", "tool_use_id": "failure",
                 "tool_input": {"cmd": "pytest"}, "tool_response": {"exit_code": 0, "output": "42 passed"}}
        with patch.object(store, "record_run_tool_event", side_effect=store.ConflictError("failed")):
            feedback = post_tool_use.dispatch_post_tool_use(event, database_path=self.db, bindings_directory=bindings)
        self.assertTrue(feedback["continue"])
        payload = json.loads(feedback["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(payload["type"], "tool_event_recording_failed")
        self.assertEqual(payload["run_id"], self.run)
        self.assertIn("42 passed", payload["result_summary"])

    def test_new_policy_exposes_only_narrow_recovery_bootstrap_tools(self):
        for tool in ("recover_review_plan", "apply_unplanned_review_recovery", "delete_review_plan"):
            self.assertTrue(hook_policy.classify_tool_call("mcp__harness_state__" + tool, {}).allowed)
        for tool in ("record_artifact", "verify_criterion", "save_review_plan", "finalize_review_plan"):
            self.assertFalse(hook_policy.classify_tool_call("mcp__harness_state__" + tool, {}).allowed)

    def test_legacy_review_status_migration_preserves_links_and_summaries(self):
        artifact = store.create_artifact(self.run, source_event_id=self.event["id"], **self.decision()["artifact"], actor="test", database_path=self.db)
        store.verify_criterion_with_evidence(self.ac, artifact["id"], "passed", database_path=self.db)
        database = store.open_database(self.db)
        database.execute("PRAGMA foreign_keys = OFF")
        database.executescript("""
            DROP TABLE run_tool_events;
            CREATE TABLE run_tool_events (
                id TEXT PRIMARY KEY, tool_use_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id),
                tool_name TEXT NOT NULL, tool_family TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
                input_summary TEXT NOT NULL, result_summary TEXT NOT NULL,
                review_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
                UNIQUE(run_id, tool_use_id));
        """)
        database.execute("INSERT INTO run_tool_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (self.event["id"], "tool-1", self.run, "exec_command", "bash", "succeeded", 0,
                          "pytest", "42 passed", "promoted", self.event["created_at"]))
        database.commit(); database.close()
        self.assertTrue(store.initialize_database(self.db)["ok"])
        self.assertTrue(store.initialize_database(self.db)["ok"])
        row = store.list_run_tool_events(self.run, database_path=self.db)[0]
        self.assertEqual(row["run_seq"], 1)
        self.assertNotIn("review_status", row)
        self.assertIsNone(row["reviewed_at"])
        self.assertEqual(row["input_summary"], "pytest")
        self.assertEqual(store.get_run_artifacts(self.run, database_path=self.db)[0]["source_event_id"], row["id"])
        self.assertEqual(len(store.get_criterion_evidence(self.ac, database_path=self.db)), 1)

    def test_ups_sweeps_after_stale_recovery_and_before_picker(self):
        self.save(self.plan([self.decision(choice="exclude")]))
        plans.finalize_review_plan(self.run, database_path=self.db)
        bindings = self.db.parent / "bindings"
        runtime_binding.save_binding(session_id="session", turn_id="old", work_item_id=self.item["id"], run_id=self.run, bindings_directory=bindings)
        path = self.db.parent / "review-plans" / f"{self.run}.json"

        def picker(request_path):
            self.assertFalse(path.exists())
            self.assertEqual(store.get_run(self.run, database_path=self.db)["status"], "interrupted")
            request = work_item_picker.read_json_object(request_path)
            work_item_picker.atomic_write_json(work_item_picker.result_path_for(request_path), {
                "schema_version": 1, "request_id": request["request_id"], "session_id": "session", "turn_id": "new",
                "created_at": work_item_picker.format_timestamp(work_item_picker.utc_now()),
                "status": "selected", "work_item_id": self.item["id"],
            })

        with patch.dict(os.environ, {"HARNESS_BINDINGS_DIRECTORY": str(bindings)}), \
             patch.object(user_prompt_submit, "launch_terminal_picker", side_effect=picker), \
             patch.object(user_prompt_submit, "close_terminal_picker"):
            result = user_prompt_submit.dispatch_user_prompt_submit({"prompt": "w/ continue", "session_id": "session", "turn_id": "new"}, database_path=self.db)
        self.assertIn('"selection_status":"selected"', result["hookSpecificOutput"]["additionalContext"])

    def test_full_long_snapshot_is_validated_without_silent_truncation(self):
        for index in range(80):
            self.add_event(f"long-{index}")
        snapshot = store.get_run_tool_event_snapshot(self.run, database_path=self.db)
        self.assertEqual(snapshot["total_count"], 81)
        plan = self.plan([self.decision(row, "exclude") for row in snapshot["events"]])
        self.save(plan)
        self.assertTrue(plans.finalize_review_plan(self.run, database_path=self.db)["ae_complete"])

    def test_failed_atomic_publication_leaves_no_plan_and_no_temporary_file(self):
        with patch.object(plans.os, "link", side_effect=OSError("publication failed")):
            with self.assertRaises(OSError):
                self.save()
        self.assertEqual(list((self.db.parent / "review-plans").iterdir()), [])

    def test_binding_validation_failure_has_unknown_run_and_active_warning(self):
        bindings = self.db.parent / "bindings"
        runtime_binding.save_binding(session_id="session", turn_id="old", work_item_id=self.item["id"], run_id=self.run, bindings_directory=bindings)
        event = {"session_id": "session", "turn_id": "new", "tool_name": "apply_patch", "tool_use_id": "patch",
                 "tool_input": {"command": "*** Update File: src/a.py\n@@\n-old\n+new"}, "tool_response": {"exit_code": 0}}
        feedback = post_tool_use.dispatch_post_tool_use(event, database_path=self.db, bindings_directory=bindings)
        payload = json.loads(feedback["hookSpecificOutput"]["additionalContext"])
        self.assertIsNone(payload["run_id"])
        self.assertIn("src/a.py", payload["input_summary"])

    def test_valid_plan_disallows_unplanned_overrides(self):
        self.save(); self.finish()
        with self.assertRaises(store.ConflictError):
            plans.apply_unplanned_review_recovery(self.item["id"], self.run, [self.decision(choice="exclude")], database_path=self.db)

    def test_duplicate_json_object_fields_and_symlink_directory_are_rejected(self):
        self.save()
        path = self.db.parent / "review-plans" / f"{self.run}.json"
        path.write_text(json.dumps(self.plan()).replace('"schema_version": 1', '"schema_version": 1, "schema_version": 1'))
        with self.assertRaises(store.ConflictError):
            plans.load_review_plan(self.run, database_path=self.db)
        directory = path.parent
        moved = self.db.parent / "moved-plans"
        directory.rename(moved); directory.symlink_to(moved)
        with self.assertRaises(store.ConflictError):
            plans.load_review_plan(self.run, database_path=self.db)

    def test_done_is_not_blocked_by_unreviewed_events(self):
        artifact = store.create_artifact(self.run, **self.decision()["artifact"], actor="test", database_path=self.db)
        store.verify_criterion_with_evidence(self.ac, artifact["id"], "passed", database_path=self.db)
        self.finish()
        closed = store.close_work_item(self.item["id"], actor="user", reason="explicit completion", database_path=self.db)
        self.assertEqual(closed["status"], "done")
        self.assertEqual(store.get_run_review_status(self.run, database_path=self.db)["unreviewed_event_ids"], [self.event["id"]])


if __name__ == "__main__":
    unittest.main()
