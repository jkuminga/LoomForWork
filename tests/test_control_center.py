import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from src.harness import state_store
from src.harness.control_center.app import create_app


class ControlCenterApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "state.db"
        self.client_context = TestClient(create_app(self.database_path))
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        self.temporary_directory.cleanup()

    def create_draft(self, **overrides: object) -> dict[str, object]:
        payload: dict[str, object] = {
            "title": "웹 콘솔 첫 화면 구현",
            "kind": "implementation",
            "goal": "브라우저에서 Draft를 만들고 확인한다.",
            "description": "목업을 기준으로 구현한다.",
        }
        payload.update(overrides)
        response = self.client.post("/api/draft-work-items", json=payload)
        self.assertEqual(response.status_code, 201)
        return response.json()["work_item"]

    def test_root_serves_the_control_center(self) -> None:
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("<title>Codex Compass</title>", response.text)
        self.assertIn("새 Draft WI 생성", response.text)
        self.assertIn(
            "pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css",
            response.text,
        )
        self.assertNotIn(">Evidence</a>", response.text)
        self.assertNotIn(">Memory Candidates</a>", response.text)
        self.assertIn('id="sidebar-toggle"', response.text)
        self.assertIn('aria-controls="primary-sidebar"', response.text)
        self.assertIn('id="font-scale-decrease"', response.text)
        self.assertIn('id="font-scale-value"', response.text)
        self.assertIn('id="font-scale-increase"', response.text)

    def test_sidebar_toggle_uses_a_persisted_desktop_icon_rail(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()

        self.assertIn('const SIDEBAR_STORAGE_KEY = "harness:sidebar-collapsed:v1"', app_js)
        self.assertIn("function setSidebarCollapsed(collapsed, persist = true)", app_js)
        self.assertIn('window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))', app_js)
        self.assertIn("body.sidebar-collapsed .side-nav", styles)
        self.assertIn("body.sidebar-collapsed .nav-list a", styles)
        self.assertIn(".sidebar-toggle {", styles)

    def test_font_scale_stepper_uses_five_persisted_levels(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()

        self.assertIn('const FONT_SCALE_STORAGE_KEY = "harness:font-scale:v1"', app_js)
        self.assertIn("const FONT_SCALE_LEVELS = [50, 75, 100, 125, 150]", app_js)
        self.assertIn("function setFontScale(percent, persist = true, direction = null)", app_js)
        self.assertIn('document.documentElement.style.setProperty("--font-scale"', app_js)
        self.assertIn("window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(next))", app_js)
        self.assertIn("--font-scale: 1", styles)
        self.assertIn(".font-scale-stepper", styles)
        self.assertIn("body.sidebar-collapsed .font-scale-control", styles)
        self.assertIn('html[data-font-scale="150"] .criterion-controls', styles)

    def test_overview_api_returns_features_work_items_runs_and_links(self) -> None:
        feature = state_store.create_feature(
            title="컨텍스트 주입과 상태 관리",
            goal="관련 작업을 하나의 기능으로 묶는다.",
            actor="test",
            feature_id="FEAT-overview",
            database_path=self.database_path,
        )
        work_item = state_store.create_ready_work_item(
            title="Overview 그래프 구현 작업",
            kind="implementation",
            goal="Feature, WorkItem, Run 관계를 표시한다.",
            next_action="그래프를 렌더링한다.",
            acceptance_criteria=["관계 그래프가 표시된다."],
            actor="test",
            feature_id=feature["id"],
            work_item_id="WI-overview",
            database_path=self.database_path,
        )
        run = state_store.start_run(
            work_item["id"],
            intent="Overview 네트워크 그래프를 구현한다.",
            recall_query="Overview 그래프",
            actor="test",
            run_id="RUN-overview",
            database_path=self.database_path,
        )
        completed_item = state_store.create_ready_work_item(
            title="완료된 Overview 작업",
            kind="implementation",
            goal="완료 WI가 Overview에서 제외되는지 검증한다.",
            next_action="완료 처리한다.",
            acceptance_criteria=["완료 상태가 확인된다."],
            actor="test",
            feature_id=feature["id"],
            work_item_id="WI-overview-done",
            database_path=self.database_path,
        )
        completed_run = state_store.start_run(
            completed_item["id"],
            intent="완료될 작업을 실행한다.",
            recall_query="완료 작업",
            actor="test",
            run_id="RUN-overview-done",
            database_path=self.database_path,
        )
        state_store.finish_run(
            completed_run["id"],
            run_status="succeeded",
            work_item_status="ready",
            summary="완료 준비가 끝났다.",
            next_action="사용자 확인을 기다린다.",
            actor="test",
            reason="테스트 준비",
            database_path=self.database_path,
        )
        completed_criterion = state_store.get_work_item_context(
            completed_item["id"], database_path=self.database_path
        )["acceptance_criteria"][0]
        state_store.waive_criterion(
            completed_criterion["id"],
            actor="user",
            reason="Overview 완료 제외 검증",
            database_path=self.database_path,
        )
        state_store.close_work_item(
            completed_item["id"],
            actor="user",
            reason="Overview 완료 제외 검증",
            database_path=self.database_path,
        )

        response = self.client.get("/api/overview")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["features"][0]["id"], feature["id"])
        self.assertEqual(payload["work_items"][0]["feature_id"], feature["id"])
        self.assertEqual(payload["runs"][0]["id"], run["id"])
        self.assertNotIn(completed_item["id"], {item["id"] for item in payload["work_items"]})
        self.assertNotIn(completed_run["id"], {item["id"] for item in payload["runs"]})
        self.assertIn(
            {"source": feature["id"], "target": work_item["id"], "kind": "feature_work_item"},
            payload["links"],
        )
        self.assertIn(
            {"source": work_item["id"], "target": run["id"], "kind": "work_item_run"},
            payload["links"],
        )
        self.assertEqual(payload["summary"]["running_count"], 1)
        self.assertEqual(payload["summary"]["work_item_count"], 1)
        self.assertEqual(payload["summary"]["run_count"], 1)

    def test_overview_ui_uses_compact_feature_and_work_item_titles(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()
        index = (root / "index.html").read_text()

        self.assertIn('id="overview-view"', index)
        self.assertIn('id="overview-graph"', index)
        self.assertIn('id="nav-overview"', index)
        self.assertIn("완료된 작업은 Work Items 상세 페이지", index)
        self.assertIn("function overviewShortTitle(value, maximum = 10)", app_js)
        self.assertIn("function overviewFeatureTitleLines(value)", app_js)
        self.assertIn("overviewShortTitle(node.title, 10)", app_js)
        self.assertIn("<title>${escapeHtml(node.title)}</title>", app_js)
        self.assertIn('<circle r="8"></circle>', app_js)
        self.assertNotIn('class="overview-run-id"', app_js)
        self.assertNotIn('class="overview-run-mark"', app_js)
        self.assertIn("overview-edge-status-", app_js)
        self.assertIn('<rect x="-66" y="-39" width="132" height="78" rx="13"></rect>', app_js)
        self.assertIn(".overview-node-feature .overview-node-title", styles)
        self.assertIn(".overview-node-work-item .overview-node-title", styles)

    def test_overview_layout_keeps_work_item_run_clusters_apart(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        script = """
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const layoutSource = source.slice(
  source.indexOf("function overviewRunRingRadius"),
  source.indexOf("function overviewFeatureNodeHtml"),
);
const context = { state: { overviewSpread: false } };
vm.createContext(context);
vm.runInContext(layoutSource, context);
const counts = [19, 1, 5, 1];
const workItems = counts.map((count, index) => ({
  id: `WI-${index}`, type: "work_item", feature_id: null, childCount: count,
}));
const runs = counts.flatMap((count, workItemIndex) => Array.from({ length: count }, (_, runIndex) => ({
  id: `RUN-${workItemIndex}-${runIndex}`, type: "run", work_item_id: `WI-${workItemIndex}`,
})));
const layout = context.overviewLayout([...workItems, ...runs]);
const overlaps = [];
for (let left = 0; left < workItems.length; left += 1) {
  for (let right = left + 1; right < workItems.length; right += 1) {
    const leftPosition = layout.positions.get(workItems[left].id);
    const rightPosition = layout.positions.get(workItems[right].id);
    const minimum = context.overviewWorkItemClusterRadius(counts[left], 1)
      + context.overviewWorkItemClusterRadius(counts[right], 1);
    if (Math.hypot(leftPosition.x - rightPosition.x, leftPosition.y - rightPosition.y) < minimum) {
      overlaps.push([workItems[left].id, workItems[right].id]);
    }
  }
}
const firstWorkItem = layout.positions.get(workItems[0].id);
const firstRunDistances = runs.filter((run) => run.work_item_id === workItems[0].id).map((run) => {
  const position = layout.positions.get(run.id);
  return Math.hypot(position.x - firstWorkItem.x, position.y - firstWorkItem.y);
});
process.stdout.write(JSON.stringify({
  overlaps,
  ringSpread: Math.max(...firstRunDistances) - Math.min(...firstRunDistances),
  width: layout.width,
  height: layout.height,
}));
"""
        result = subprocess.run(
            ["node", "-e", script, str(app_js)],
            check=True,
            capture_output=True,
            text=True,
        )

        layout_result = json.loads(result.stdout)
        self.assertEqual(layout_result["overlaps"], [])
        self.assertLess(layout_result["ringSpread"], 0.001)

    def test_memo_markdown_renderer_preserves_nested_list_depth(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        script = """
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const renderer = source.slice(
  source.indexOf("function escapeHtml"),
  source.indexOf("function updateMemoPreview"),
);
const context = {};
vm.createContext(context);
vm.runInContext(renderer, context);
process.stdout.write(context.renderMarkdown("- parent\\n  - child"));
"""
        result = subprocess.run(
            ["node", "-e", script, str(app_js)],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.stdout,
            "<ul><li>parent<ul><li>child</li></ul></li></ul>",
        )

    def test_memo_editor_guards_unsaved_changes_and_persists_browser_drafts(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        index = (root / "index.html").read_text()
        styles = (root / "styles.css").read_text()

        self.assertIn('id="memo-close-modal"', index)
        self.assertIn('id="continue-memo-editing"', index)
        self.assertIn('id="discard-memo-changes"', index)
        self.assertIn('id="keep-memo-draft"', index)
        self.assertNotIn('id="memo-close-description"', index)
        self.assertIn('class="memo-close-button memo-close-continue"', index)
        self.assertIn('class="memo-close-button memo-close-discard"', index)
        self.assertIn('class="memo-close-button memo-close-save"', index)
        self.assertIn("function memoHasUnsavedChanges()", app_js)
        self.assertIn("harness:memo-draft:v1:", app_js)
        self.assertIn("window.localStorage.setItem", app_js)
        self.assertIn("window.localStorage.getItem", app_js)
        self.assertIn(
            'document.querySelector("#close-memo-modal").addEventListener("click", requestCloseMemoModal)',
            app_js,
        )
        self.assertIn(
            'if (event.target === elements.memoModal) requestCloseMemoModal()',
            app_js,
        )
        self.assertIn(
            'else if (!elements.memoModal.classList.contains("hidden")) requestCloseMemoModal()',
            app_js,
        )
        self.assertIn(".confirmation-backdrop", styles)
        self.assertIn(".memo-draft-status", styles)
        self.assertIn(".memo-close-actions", styles)
        self.assertIn("grid-template-columns: repeat(3, minmax(0, 1fr))", styles)

    def test_memo_markdown_renderer_preserves_single_newlines(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        script = """
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const renderer = source.slice(
  source.indexOf("function escapeHtml"),
  source.indexOf("function updateMemoPreview"),
);
const context = {};
vm.createContext(context);
vm.runInContext(renderer, context);
process.stdout.write(context.renderMarkdown("first line\\n\\n\\nsecond line"));
"""
        result = subprocess.run(
            ["node", "-e", script, str(app_js)],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.stdout,
            "<p>first line<br><br><br>second line</p>",
        )

    def test_memo_markdown_renderer_preserves_plain_text_indentation(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        script = """
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const renderer = source.slice(
  source.indexOf("function escapeHtml"),
  source.indexOf("function updateMemoPreview"),
);
const context = {};
vm.createContext(context);
vm.runInContext(renderer, context);
process.stdout.write(context.renderMarkdown("plain\\n  two spaces\\n\\ttab indentation"));
"""
        result = subprocess.run(
            ["node", "-e", script, str(app_js)],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.stdout,
            "<p>plain<br>&nbsp;&nbsp;two spaces<br>&nbsp;&nbsp;tab indentation</p>",
        )

    def test_memo_markdown_renderer_supports_alpha_ordered_lists(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        script = """
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.argv[1], "utf8");
const renderer = source.slice(
  source.indexOf("function escapeHtml"),
  source.indexOf("function updateMemoPreview"),
);
const context = {};
vm.createContext(context);
vm.runInContext(renderer, context);
process.stdout.write(context.renderMarkdown("A. alpha\\nB. beta\\na) lower alpha\\nb) lower beta\\n1. number\\n   A. nested alpha"));
"""
        result = subprocess.run(
            ["node", "-e", script, str(app_js)],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.stdout,
            '<ol type="A"><li>alpha</li><li>beta</li></ol>'
            '<ol type="a"><li>lower alpha</li><li>lower beta</li></ol>'
            '<ol><li>number<ol type="A"><li>nested alpha</li></ol></li></ol>',
        )

    def test_create_draft_uses_server_owned_defaults(self) -> None:
        draft = self.create_draft()

        self.assertTrue(draft["is_draft"])
        self.assertEqual(draft["status"], "backlog")
        self.assertEqual(draft["priority"], "normal")
        self.assertIsNone(draft["feature_id"])
        self.assertIsNone(draft["next_action"])

        stored = state_store.get_work_item(
            str(draft["id"]), database_path=self.database_path
        )
        self.assertEqual(stored["description"], "목업을 기준으로 구현한다.")

    def test_create_draft_normalizes_blank_optional_description(self) -> None:
        draft = self.create_draft(description="   ")

        self.assertIsNone(draft["description"])

    def test_validation_error_uses_the_ui_error_envelope(self) -> None:
        response = self.client.post(
            "/api/draft-work-items",
            json={"title": "  ", "kind": "unknown", "goal": ""},
        )

        self.assertEqual(response.status_code, 422)
        error = response.json()["error"]
        self.assertEqual(error["code"], "validation_error")
        self.assertEqual(set(error["fields"]), {"title", "kind", "goal"})

    def test_list_supports_virtual_draft_and_regular_backlog_filters(self) -> None:
        draft = self.create_draft(title="Draft 작업")
        backlog = state_store.create_work_item(
            title="일반 Backlog 작업",
            kind="research",
            goal="필터 분리를 검증한다.",
            actor="test",
            database_path=self.database_path,
        )

        draft_response = self.client.get("/api/work-items?status=draft")
        backlog_response = self.client.get("/api/work-items?status=backlog")

        self.assertEqual(
            [item["id"] for item in draft_response.json()["work_items"]], [draft["id"]]
        )
        self.assertEqual(
            [item["id"] for item in backlog_response.json()["work_items"]],
            [backlog["id"]],
        )

    def test_list_combines_status_and_kind_filters(self) -> None:
        implementation = self.create_draft(title="구현 Draft")
        self.create_draft(title="조사 Draft", kind="research")

        response = self.client.get(
            "/api/work-items?status=draft&kind=implementation"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.json()["work_items"]],
            [implementation["id"]],
        )

    def test_detail_returns_empty_draft_execution_fields(self) -> None:
        draft = self.create_draft()

        response = self.client.get(f"/api/work-items/{draft['id']}")

        self.assertEqual(response.status_code, 200)
        context = response.json()
        self.assertTrue(context["work_item"]["is_draft"])
        self.assertEqual(context["acceptance_criteria"], [])
        self.assertIsNone(context["running_run"])
        self.assertEqual(context["recent_runs"], [])
        self.assertTrue(context["capabilities"]["can_edit"])
        self.assertTrue(context["capabilities"]["can_delete"])
        self.assertEqual(context["capabilities"]["allowed_statuses"], [])
        self.assertEqual(context["memos"], [])

    def test_memo_api_supports_create_update_filters_reorder_and_delete(self) -> None:
        draft = self.create_draft()
        base = f"/api/work-items/{draft['id']}/memos"
        created = self.client.post(
            base,
            json={
                "title": "결정 기록",
                "content": "## 선택\n\nSQLite를 사용한다.",
                "kind": "decision",
                "author": "   ",
            },
        )
        self.assertEqual(created.status_code, 201)
        memo = created.json()["memo"]
        self.assertEqual(memo["author"], "anon")
        self.assertEqual(memo["status"], "open")
        self.assertEqual(memo["is_model_visible"], 0)
        second = self.client.post(
            base,
            json={"title": "문제", "content": "잠금 확인", "kind": "problem"},
        ).json()["memo"]

        updated = self.client.patch(
            f"{base}/{memo['id']}",
            json={"status": "closed", "is_pinned": True},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["memo"]["status"], "closed")
        self.assertEqual(updated.json()["memo"]["is_pinned"], 1)
        shared = self.client.patch(
            f"{base}/{memo['id']}", json={"is_model_visible": True}
        )
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(shared.json()["memo"]["is_model_visible"], 1)
        self.assertEqual(
            [entry["id"] for entry in state_store.get_preflight_context(
                draft["id"], database_path=self.database_path
            )["memos"]],
            [memo["id"]],
        )
        filtered = self.client.get(f"{base}?status=closed&kind=decision")
        self.assertEqual([entry["id"] for entry in filtered.json()["memos"]], [memo["id"]])

        reordered = self.client.post(
            f"{base}/reorder", json={"memo_ids": [memo["id"], second["id"]]}
        )
        self.assertEqual(reordered.status_code, 200)
        self.assertEqual(
            [entry["id"] for entry in reordered.json()["memos"]], [memo["id"], second["id"]]
        )
        context = self.client.get(f"/api/work-items/{draft['id']}").json()
        self.assertEqual([entry["id"] for entry in context["memos"]], [memo["id"], second["id"]])
        deleted = self.client.delete(f"{base}/{second['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            [entry["id"] for entry in self.client.get(base).json()["memos"]], [memo["id"]]
        )

    def test_edit_updates_user_managed_fields(self) -> None:
        draft = self.create_draft()

        response = self.client.patch(
            f"/api/work-items/{draft['id']}",
            json={
                "title": "수정된 Draft",
                "goal": "웹에서 계획을 수정한다.",
                "description": None,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_item"]["title"], "수정된 Draft")
        self.assertIsNone(response.json()["work_item"]["description"])

    def test_web_api_rejects_backlog_to_ready_even_when_crafted(self) -> None:
        backlog = state_store.create_work_item(
            title="준비 전 작업",
            kind="implementation",
            goal="웹에서 Ready로 우회하지 못한다.",
            actor="test",
            database_path=self.database_path,
        )

        response = self.client.patch(
            f"/api/work-items/{backlog['id']}/status", json={"status": "ready"}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            state_store.get_work_item(backlog["id"], database_path=self.database_path)["status"],
            "backlog",
        )

    def test_blocked_work_item_can_return_to_ready_from_web(self) -> None:
        work_item = state_store.create_work_item(
            title="차단된 작업",
            kind="bug",
            goal="차단 해제 흐름을 검증한다.",
            next_action="원인을 확인한다.",
            actor="test",
            database_path=self.database_path,
        )
        state_store.change_work_item_status(
            work_item["id"], "ready", next_action="원인을 확인한다.",
            actor="test", reason="준비", database_path=self.database_path,
        )
        run = state_store.start_run(
            work_item["id"], intent="차단 상태를 만든다.", recall_query="차단 상태",
            actor="test", database_path=self.database_path,
        )
        state_store.finish_run(
            run["id"], run_status="interrupted", work_item_status="blocked",
            summary="권한 부족으로 중단", termination_reason="권한 없음",
            next_action="권한을 기다린다.", block_reason="권한 없음",
            actor="test", reason="차단",
            database_path=self.database_path,
        )

        response = self.client.patch(
            f"/api/work-items/{work_item['id']}/status", json={"status": "ready"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_item"]["status"], "ready")
        self.assertEqual(response.json()["work_item"]["next_action"], "권한을 기다린다.")
        self.assertIsNone(response.json()["work_item"]["block_reason"])

    def test_ready_work_item_can_be_closed_from_web_with_valid_proof(self) -> None:
        work_item = state_store.create_ready_work_item(
            title="웹 완료",
            kind="verification",
            goal="사용자가 웹 콘솔에서 WI를 닫는다.",
            next_action="사용자 확인을 기다린다.",
            acceptance_criteria=["사용자가 결과를 확인한다."],
            actor="test",
            database_path=self.database_path,
        )
        criterion = state_store.get_work_item_context(
            work_item["id"], database_path=self.database_path
        )["acceptance_criteria"][0]
        state_store.waive_criterion(
            criterion["id"], actor="user", reason="결과 확인",
            database_path=self.database_path,
        )

        response = self.client.patch(
            f"/api/work-items/{work_item['id']}/status", json={"status": "done"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_item"]["status"], "done")
        self.assertIsNone(response.json()["work_item"]["next_action"])
        self.assertIsNotNone(response.json()["work_item"]["closed_at"])

    def test_web_rejects_close_when_criteria_are_pending(self) -> None:
        work_item = state_store.create_ready_work_item(
            title="미검증 웹 완료",
            kind="verification",
            goal="완료 조건 없는 종료를 거부한다.",
            next_action="검증을 수행한다.",
            acceptance_criteria=["검증이 통과한다."],
            actor="test",
            database_path=self.database_path,
        )

        response = self.client.patch(
            f"/api/work-items/{work_item['id']}/status", json={"status": "done"}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            state_store.get_work_item(work_item["id"], database_path=self.database_path)["status"],
            "ready",
        )

    def test_delete_is_limited_to_unstarted_backlog_items(self) -> None:
        draft = self.create_draft()
        response = self.client.delete(f"/api/work-items/{draft['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_work_item_id"], draft["id"])

        ready = state_store.create_work_item(
            title="삭제하면 안 되는 작업", kind="research", goal="기록을 보존한다.",
            actor="test", database_path=self.database_path,
        )
        state_store.change_work_item_status(
            ready["id"], "ready", next_action="실행한다.", actor="test",
            reason="준비", database_path=self.database_path,
        )
        blocked = self.client.delete(f"/api/work-items/{ready['id']}")
        self.assertEqual(blocked.status_code, 409)

    def test_missing_work_item_returns_not_found_envelope(self) -> None:
        response = self.client.get("/api/work-items/WI-missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_detail_exposes_run_history_fields_for_recent_runs_cards(self) -> None:
        work_item = state_store.create_work_item(
            title="Run 카드 데이터",
            kind="verification",
            goal="Recent Runs 카드가 실행 목적과 결과를 표시한다.",
            next_action="검증을 실행한다.",
            actor="test",
            database_path=self.database_path,
        )
        state_store.change_work_item_status(
            work_item["id"], "ready", next_action="검증을 실행한다.",
            actor="test", reason="검증 준비", database_path=self.database_path,
        )
        failed_run = state_store.start_run(
            work_item["id"], intent="실패한 검증을 실행한다.", recall_query="Run 카드",
            actor="test", database_path=self.database_path,
        )
        state_store.finish_run(
            failed_run["id"], run_status="failed", work_item_status="ready",
            summary="검증 명령이 실패했다.", termination_reason="테스트 환경 오류",
            next_action="환경을 고친 뒤 다시 실행한다.", actor="test",
            reason="검증 실패", database_path=self.database_path,
        )
        current_run = state_store.start_run(
            work_item["id"], intent="현재 검증을 실행한다.", recall_query="현재 검증",
            actor="test", database_path=self.database_path,
        )

        response = self.client.get(f"/api/work-items/{work_item['id']}")

        self.assertEqual(response.status_code, 200)
        context = response.json()
        self.assertEqual(context["running_run"]["id"], current_run["id"])
        self.assertEqual(context["running_run"]["intent"], "현재 검증을 실행한다.")
        recent = context["recent_runs"][0]
        self.assertEqual(recent["id"], failed_run["id"])
        self.assertEqual(recent["status"], "failed")
        self.assertEqual(recent["summary"], "검증 명령이 실패했다.")
        self.assertEqual(recent["termination_reason"], "테스트 환경 오류")
        self.assertIsNotNone(recent["started_at"])
        self.assertIsNotNone(recent["ended_at"])

    def test_work_item_detail_exposes_evidence_counts_and_lazy_evidence_details(self) -> None:
        work_item = state_store.create_ready_work_item(
            title="AC Evidence 상세",
            kind="verification",
            goal="Acceptance Criterion별 Evidence를 확인한다.",
            next_action="Evidence를 확인한다.",
            acceptance_criteria=["테스트 결과가 통과한다.", "결과 요약이 기록된다."],
            actor="test",
            database_path=self.database_path,
        )
        criteria = state_store.get_work_item_context(
            work_item["id"], database_path=self.database_path
        )["acceptance_criteria"]
        run = state_store.start_run(
            work_item["id"], intent="Evidence 상세를 만든다.", recall_query="Evidence 상세",
            actor="test", database_path=self.database_path,
        )
        artifact = state_store.create_artifact(
            run["id"], kind="test_run", uri="command:test:20260923T093000Z",
            verification_status="passed", summary="전체 테스트 186개 통과",
            actor="test", database_path=self.database_path,
        )
        state_store.link_evidence(
            criteria[0]["id"], artifact["id"], actor="test",
            note="테스트 결과가 첫 번째 조건을 증명한다.",
            database_path=self.database_path,
        )
        state_store.finish_run(
            run["id"], run_status="succeeded", work_item_status="ready",
            summary="Evidence 등록 완료", next_action="결과를 확인한다.",
            actor="test", reason="검증 완료", database_path=self.database_path,
        )

        detail_response = self.client.get(f"/api/work-items/{work_item['id']}")
        evidence_response = self.client.get(
            f"/api/work-items/{work_item['id']}/acceptance-criteria/{criteria[0]['id']}/evidence"
        )

        self.assertEqual(detail_response.status_code, 200)
        detail_criteria = detail_response.json()["acceptance_criteria"]
        self.assertEqual(detail_criteria[0]["evidence_count"], 1)
        self.assertEqual(detail_criteria[1]["evidence_count"], 0)
        self.assertEqual(evidence_response.status_code, 200)
        evidence = evidence_response.json()["evidence"]
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["kind"], "test_run")
        self.assertEqual(evidence[0]["verification_status"], "passed")
        self.assertEqual(evidence[0]["run_status"], "succeeded")
        self.assertEqual(evidence[0]["summary"], "전체 테스트 186개 통과")
        self.assertEqual(evidence[0]["note"], "테스트 결과가 첫 번째 조건을 증명한다.")
        self.assertNotIn("uri", evidence[0])
        self.assertNotIn("artifact_id", evidence[0])

    def test_work_item_detail_evidence_rejects_a_criterion_from_another_work_item(self) -> None:
        first = state_store.create_ready_work_item(
            title="첫 번째 Evidence 대상", kind="verification", goal="첫 대상을 확인한다.",
            next_action="첫 대상을 실행한다.", acceptance_criteria=["첫 조건"], actor="test",
            database_path=self.database_path,
        )
        second = state_store.create_ready_work_item(
            title="두 번째 Evidence 대상", kind="verification", goal="두 번째 대상을 확인한다.",
            next_action="두 번째 대상을 실행한다.", acceptance_criteria=["두 번째 조건"], actor="test",
            database_path=self.database_path,
        )
        criterion = state_store.get_work_item_context(
            second["id"], database_path=self.database_path
        )["acceptance_criteria"][0]

        response = self.client.get(
            f"/api/work-items/{first['id']}/acceptance-criteria/{criterion['id']}/evidence"
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_work_item_detail_ui_renders_expandable_evidence_rows(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()

        self.assertIn("data-criterion-toggle", app_js)
        self.assertIn("evidence_count", app_js)
        self.assertIn("Evidence 없음", app_js)
        self.assertIn("/acceptance-criteria/${encodeURIComponent(criterionId)}/evidence", app_js)
        self.assertIn("criterion-evidence-panel", styles)
        self.assertIn("criterion-evidence-count", styles)
        self.assertIn("evidence-card", styles)

    def test_work_item_layout_gives_detail_panel_sixty_percent_of_content_width(self) -> None:
        styles = (Path(__file__).parents[1] / "src/harness/control_center/static/styles.css").read_text()

        self.assertIn(
            "grid-template-columns: 220px minmax(0, 2fr) minmax(0, 3fr);",
            styles,
        )
        self.assertIn(
            "grid-template-columns: 190px minmax(0, 2fr) minmax(0, 3fr);",
            styles,
        )

    def test_memo_header_is_the_expand_toggle(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()

        self.assertIn('data-memo-toggle="${escapeHtml(memo.id)}"', app_js)
        self.assertIn("handleMemoHeaderToggle", app_js)
        self.assertIn("handleMemoHeaderKeydown", app_js)
        self.assertIn('list?.addEventListener("click", handleMemoHeaderToggle);', app_js)
        self.assertIn('list?.addEventListener("keydown", handleMemoHeaderKeydown);', app_js)
        self.assertIn("memo-expand-indicator", app_js)
        self.assertIn('<svg viewBox="0 0 16 16"', app_js)
        self.assertNotIn('class="memo-expand-button"', app_js)
        self.assertIn(".memo-card-header:focus-visible", styles)
        self.assertIn(".memo-expand-indicator svg", styles)
        self.assertIn(".memo-card.is-expanded .memo-expand-indicator svg", styles)

    def test_runs_list_filters_searches_and_paginates_joined_work_items(self) -> None:
        first = state_store.create_work_item(
            title="첫 번째 실행 대상", kind="verification", goal="Run 목록을 검증한다.",
            next_action="첫 실행", actor="test", database_path=self.database_path,
        )
        second = state_store.create_work_item(
            title="검색 가능한 대상", kind="verification", goal="검색을 검증한다.",
            next_action="둘째 실행", actor="test", database_path=self.database_path,
        )
        for item in (first, second):
            state_store.change_work_item_status(
                item["id"], "ready", next_action=item["next_action"], actor="test",
                reason="실행 준비", database_path=self.database_path,
            )
        first_run = state_store.start_run(
            first["id"], intent="완료된 목록 검증", recall_query="목록 검증",
            actor="test", database_path=self.database_path,
        )
        state_store.finish_run(
            first_run["id"], run_status="succeeded", work_item_status="ready",
            summary="목록 검증 완료", next_action="다음 검증", actor="test",
            reason="완료", database_path=self.database_path,
        )
        second_run = state_store.start_run(
            second["id"], intent="검색어 needle 실행", recall_query="검색 검증",
            actor="test", database_path=self.database_path,
        )

        filtered = self.client.get("/api/runs?status=running&query=needle&limit=1&offset=0")

        self.assertEqual(filtered.status_code, 200)
        payload = filtered.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["limit"], 1)
        self.assertEqual(payload["offset"], 0)
        self.assertEqual(payload["runs"][0]["id"], second_run["id"])
        self.assertEqual(payload["runs"][0]["work_item_title"], "검색 가능한 대상")
        self.assertNotIn("summary", payload["runs"][0])

    def test_run_detail_returns_minimal_run_work_item_and_artifacts(self) -> None:
        work_item = state_store.create_work_item(
            title="상세 실행 대상", kind="verification", goal="Run 상세를 검증한다.",
            next_action="상세 실행", actor="test", database_path=self.database_path,
        )
        state_store.change_work_item_status(
            work_item["id"], "ready", next_action="상세 실행", actor="test",
            reason="실행 준비", database_path=self.database_path,
        )
        run = state_store.start_run(
            work_item["id"], intent="상세 정보를 만든다.", recall_query="상세 정보",
            actor="test", database_path=self.database_path,
        )
        artifact = state_store.create_artifact(
            run["id"], kind="file", uri="src/example.py", verification_status="passed",
            summary="예제 파일 생성", actor="test", database_path=self.database_path,
        )
        state_store.finish_run(
            run["id"], run_status="failed", work_item_status="ready",
            summary="일부 검증 실패", termination_reason="환경 오류",
            next_action="환경 수정", actor="test", reason="실패",
            database_path=self.database_path,
        )

        response = self.client.get(f"/api/runs/{run['id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["run"]["summary"], "일부 검증 실패")
        self.assertEqual(payload["run"]["termination_reason"], "환경 오류")
        self.assertNotIn("recall_query", payload["run"])
        self.assertNotIn("trace_ref", payload["run"])
        self.assertEqual(payload["work_item"], {"id": work_item["id"], "title": "상세 실행 대상"})
        self.assertEqual(payload["artifacts"][0]["id"], artifact["id"])

    def test_run_detail_missing_uses_generic_not_found_message(self) -> None:
        response = self.client.get("/api/runs/RUN-missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["message"], "요청한 대상을 찾을 수 없습니다.")

    def test_runs_ui_uses_hourglass_without_live_duration_timer(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()
        index = (root / "index.html").read_text()

        self.assertNotIn("setInterval(updateRunningDurations", app_js)
        self.assertNotIn("function updateRunningDurations", app_js)
        self.assertIn("runProgressHtml()", app_js)
        self.assertIn("hourglass-flip", styles)
        self.assertIn('id="runs-view"', index)
        self.assertIn('id="runs-table-body"', index)
        self.assertIn('name="runs-period"', index)
        self.assertNotIn('id="runs-period"', index)
        self.assertIn('name="runs-status"', app_js)
        self.assertIn("width: clamp(240px, 24vw, 360px)", styles)
        self.assertIn("flex-wrap: wrap", styles)
        self.assertIn("gap: 15px", styles)
        self.assertIn("min-height: 34px", styles)
        self.assertIn("padding: 0 14px", styles)

    def test_work_item_run_cards_link_to_the_runs_view_and_focus_the_run(self) -> None:
        app_js = Path(__file__).parents[1] / "src/harness/control_center/static/app.js"
        styles = Path(__file__).parents[1] / "src/harness/control_center/static/styles.css"
        source = app_js.read_text()
        style_source = styles.read_text()

        self.assertIn('data-open-run="${escapeHtml(run.id)}"', source)
        self.assertIn('switchView("runs", state.selectedContext?.work_item?.id, card.dataset.openRun)', source)
        self.assertIn("await focusRun(pendingRunId)", source)
        self.assertIn("scrollIntoView", source)
        self.assertIn(".run-card-link", style_source)

    def test_runs_rows_use_a_chevron_instead_of_an_action_column(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        app_js = (root / "app.js").read_text()
        styles = (root / "styles.css").read_text()
        index = (root / "index.html").read_text()

        self.assertIn("run-chevron", app_js)
        self.assertIn('colspan="7"', app_js)
        self.assertIn("run-chevron.is-open", styles)
        self.assertIn('class="run-chevron-heading"', index)
        self.assertNotIn(">Actions<", index)

    def test_run_status_colors_separate_running_and_interrupted_from_success_and_failure(self) -> None:
        styles = (Path(__file__).parents[1] / "src/harness/control_center/static/styles.css").read_text()

        self.assertIn(".run-status-running { border-color: #b8c5f1; background: #e5e9ff; color: #4358c7; }", styles)
        self.assertIn(".run-status-interrupted { border-color: #e6cfaa; background: var(--amber-pale); color: var(--amber); }", styles)
        self.assertIn(".run-status-failed { border-color: #e6beba; background: var(--red-pale); color: var(--red); }", styles)
        self.assertNotIn(".run-status-failed, .run-status-interrupted", styles)

    def test_activity_timeline_menu_opens_a_coming_soon_page(self) -> None:
        root = Path(__file__).parents[1] / "src/harness/control_center/static"
        index = (root / "index.html").read_text()
        app_js = (root / "app.js").read_text()

        self.assertIn('id="nav-activity-timeline" href="#activity-timeline"', index)
        self.assertIn('id="activity-timeline-view"', index)
        self.assertIn("추후 추가될 기능입니다.", index)
        self.assertIn('switchView("activity-timeline")', app_js)
        self.assertIn('const isTimeline = view === "activity-timeline"', app_js)


if __name__ == "__main__":
    unittest.main()
