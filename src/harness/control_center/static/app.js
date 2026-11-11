const STATUS_OPTIONS = [
  ["draft", "Draft"],
  ["backlog", "Backlog"],
  ["ready", "Ready"],
  ["in_progress", "In Progress"],
  ["blocked", "Blocked"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
];

const KIND_OPTIONS = [
  ["implementation", "Implementation"],
  ["bug", "Bug"],
  ["research", "Research"],
  ["decision", "Decision"],
  ["refactor", "Refactor"],
  ["migration", "Migration"],
  ["verification", "Verification"],
  ["maintenance", "Maintenance"],
];

const MEMO_KIND_OPTIONS = [
  ["general", "일반"], ["decision", "결정"], ["problem", "문제"],
  ["idea", "아이디어"], ["question", "질문"], ["reference", "참고"],
];
const MEMO_STATUS_OPTIONS = [["", "전체 상태"], ["open", "확인 필요"], ["closed", "정리됨"]];
const RUN_STATUS_OPTIONS = [
  ["running", "Running"], ["succeeded", "Succeeded"], ["failed", "Failed"],
  ["interrupted", "Interrupted"], ["cancelled", "Cancelled"],
];
const SIDEBAR_STORAGE_KEY = "harness:sidebar-collapsed:v1";
const FONT_SCALE_STORAGE_KEY = "harness:font-scale:v1";
const FONT_SCALE_LEVELS = [50, 75, 100, 125, 150];
let draftFeatureLoadVersion = 0;
let draftFeatures = [];
let draftFeatureLoadError = "";

const state = {
  items: [],
  selectedId: null,
  selectedContext: null,
  statusFilters: new Set(),
  kindFilters: new Set(),
  memoStatusFilter: "",
  memoKindFilter: "",
  expandedMemoIds: new Set(),
  expandedCriterionIds: new Set(),
  criterionEvidence: new Map(),
  criterionEvidenceLoading: new Set(),
  criterionEvidenceErrors: new Map(),
  editingMemoId: null,
  memoBaseline: null,
  memoBaselineUpdatedAt: null,
  memoDraftKey: null,
  memoDraftTimer: null,
  memoLastFocus: null,
  detailTab: "overview",
  currentView: "overview",
  runs: [],
  runsTotal: 0,
  runsLimit: 50,
  runsOffset: 0,
  runsQuery: "",
  runsPeriod: "",
  runsStatusFilter: "",
  runsWorkItemId: null,
  pendingRunId: null,
  expandedRunId: null,
  runDetails: new Map(),
  overview: null,
  sidebarCollapsed: false,
  fontScale: 100,
  nextActionsOpen: false,
};

const elements = {
  itemsList: document.querySelector("#items-list"),
  loading: document.querySelector("#loading-state"),
  detail: document.querySelector("#detail-content"),
  emptyDetail: document.querySelector("#empty-detail"),
  visibleCount: document.querySelector("#visible-count"),
  dockSummary: document.querySelector("#dock-summary"),
  healthDot: document.querySelector("#health-dot"),
  healthLabel: document.querySelector("#health-label"),
  modal: document.querySelector("#draft-modal"),
  form: document.querySelector("#draft-form"),
  formError: document.querySelector("#form-error"),
  submitButton: document.querySelector("#submit-draft"),
  editModal: document.querySelector("#edit-modal"),
  editForm: document.querySelector("#edit-form"),
  editFormError: document.querySelector("#edit-form-error"),
  deleteModal: document.querySelector("#delete-modal"),
  deleteConfirmation: document.querySelector("#delete-confirmation"),
  confirmDelete: document.querySelector("#confirm-delete"),
  memoModal: document.querySelector("#memo-modal"),
  memoForm: document.querySelector("#memo-form"),
  memoFormError: document.querySelector("#memo-form-error"),
  submitMemo: document.querySelector("#submit-memo"),
  memoDraftStatus: document.querySelector("#memo-draft-status"),
  memoCloseModal: document.querySelector("#memo-close-modal"),
  workItemsView: document.querySelector("#work-items-view"),
  featuresView: document.querySelector("#features-view"),
  runsView: document.querySelector("#runs-view"),
  overviewView: document.querySelector("#overview-view"),
  overviewLoading: document.querySelector("#overview-loading"),
  overviewDashboard: document.querySelector("#overview-dashboard"),
  overviewError: document.querySelector("#overview-error"),
  runsBody: document.querySelector("#runs-table-body"),
  runsLoading: document.querySelector("#runs-loading"),
  runsEmpty: document.querySelector("#runs-empty"),
  runsRange: document.querySelector("#runs-range"),
  sideNav: document.querySelector("#primary-sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  fontScaleDecrease: document.querySelector("#font-scale-decrease"),
  fontScaleIncrease: document.querySelector("#font-scale-increase"),
  fontScaleValue: document.querySelector("#font-scale-value"),
  toast: document.querySelector("#app-toast"),
  nextActionsPanel: document.querySelector("#next-actions-panel"),
  nextActionsTrigger: document.querySelector("#next-actions-trigger"),
  nextActionsList: document.querySelector("#next-actions-list"),
};

function readSidebarPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch (_) {
    return false;
  }
}

function setSidebarCollapsed(collapsed, persist = true) {
  state.sidebarCollapsed = collapsed;
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  elements.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "사이드바 펼치기" : "사이드바 접기";
  elements.sidebarToggle.setAttribute("aria-label", label);
  elements.sidebarToggle.title = label;
  elements.sidebarToggle.querySelector("span").textContent = collapsed ? "›" : "‹";
  if (!persist) return;
  try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)); } catch (_) { /* unavailable storage */ }
}

function readFontScalePreference() {
  try {
    const value = Number.parseInt(window.localStorage.getItem(FONT_SCALE_STORAGE_KEY), 10);
    return FONT_SCALE_LEVELS.includes(value) ? value : 100;
  } catch (_) {
    return 100;
  }
}

function setFontScale(percent, persist = true, direction = null) {
  const next = FONT_SCALE_LEVELS.includes(percent) ? percent : 100;
  state.fontScale = next;
  document.documentElement.dataset.fontScale = String(next);
  document.documentElement.style.setProperty("--font-scale", String(next / 100));
  elements.fontScaleValue.value = `${next}%`;
  elements.fontScaleValue.textContent = `${next}%`;

  const index = FONT_SCALE_LEVELS.indexOf(next);
  elements.fontScaleDecrease.disabled = index === 0;
  elements.fontScaleIncrease.disabled = index === FONT_SCALE_LEVELS.length - 1;

  if (direction) {
    elements.fontScaleValue.classList.remove("is-increasing", "is-decreasing");
    void elements.fontScaleValue.offsetWidth;
    elements.fontScaleValue.classList.add(direction > 0 ? "is-increasing" : "is-decreasing");
  }

  if (!persist) return;
  try { window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(next)); } catch (_) { /* unavailable storage */ }
}

function changeFontScale(direction) {
  const index = FONT_SCALE_LEVELS.indexOf(state.fontScale);
  const nextIndex = Math.max(0, Math.min(FONT_SCALE_LEVELS.length - 1, index + direction));
  if (nextIndex === index) return;
  setFontScale(FONT_SCALE_LEVELS[nextIndex], true, direction);
}

function statusOf(item) {
  return item.is_draft && item.status === "backlog" ? "draft" : item.status;
}

function labelFor(options, value) {
  return options.find(([key]) => key === value)?.[1] || value;
}

function priorityLabel(value) {
  return { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" }[value] || value;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatRunDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}시간 ${minutes}분 ${remainder}초`;
  if (minutes) return `${minutes}분 ${remainder}초`;
  return `${remainder}초`;
}

function elapsedSeconds(startedAt, endedAt = null, now = Date.now()) {
  const started = new Date(startedAt).getTime();
  const ended = endedAt ? new Date(endedAt).getTime() : now;
  if (Number.isNaN(started) || Number.isNaN(ended)) return null;
  return Math.max(0, Math.floor((ended - started) / 1000));
}

function durationLabel(run) {
  if (!run.started_at) return "시간 미상";
  if (run.status === "running" || !run.ended_at) return "In progress";
  const totalSeconds = elapsedSeconds(run.started_at, run.ended_at);
  if (totalSeconds === null) return "시간 미상";
  return `${formatElapsed(totalSeconds)} 소요`;
}

function runProgressHtml() {
  return '<span class="run-progress" role="status" aria-label="실행 중"><span class="run-hourglass" aria-hidden="true">⌛</span><span>In progress</span></span>';
}

function runStatusLabel(value) {
  return {
    running: "Running", succeeded: "Succeeded", failed: "Failed",
    interrupted: "Interrupted", cancelled: "Cancelled",
  }[value] || value;
}

function runStatusClass(value) {
  return ["running", "succeeded", "failed", "interrupted", "cancelled"].includes(value)
    ? value : "unknown";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(value) {
  // Detect block syntax from the raw text, then escape every user-authored fragment.
  const source = String(value ?? "");
  const lines = source.split("\n");
  const output = [];
  let inCode = false;
  const listStack = [];
  let paragraphLines = [];
  const inline = (line) => {
    const normalized = String(line).replaceAll("\t", "  ");
    const leadingWhitespace = normalized.match(/^ */)?.[0] || "";
    const content = escapeHtml(normalized.slice(leadingWhitespace.length))
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    return `${"&nbsp;".repeat(leadingWhitespace.length)}${content}`;
  };
  const closeList = () => {
    while (listStack.length) {
      const list = listStack.pop();
      output.push(`</li></${list.type}>`);
    }
  };
  const closeParagraph = () => {
    if (!paragraphLines.length) return;
    const content = paragraphLines.every((line) => line === "")
      ? "<br>".repeat(paragraphLines.length)
      : paragraphLines.map(inline).join("<br>");
    output.push(`<p>${content}</p>`);
    paragraphLines = [];
  };
  const openList = (type, style, indent, content) => {
    const attribute = style === "upper-alpha" ? ' type="A"' : style === "lower-alpha" ? ' type="a"' : "";
    output.push(`<${type}${attribute}><li>${inline(content)}`);
    listStack.push({ type, style, indent });
  };
  const addListItem = (type, style, indent, content) => {
    while (listStack.length && indent < listStack.at(-1).indent) {
      const list = listStack.pop();
      output.push(`</li></${list.type}>`);
    }
    const current = listStack.at(-1);
    if (!current || indent > current.indent) {
      openList(type, style, indent, content);
      return;
    }
    if (current.type !== type || current.style !== style) {
      listStack.pop();
      output.push(`</li></${current.type}>`);
      openList(type, style, indent, content);
      return;
    }
    output.push(`</li><li>${inline(content)}`);
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      closeParagraph();
      if (inCode) { output.push("</code></pre>"); inCode = false; }
      else { closeList(); output.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { output.push(`${escapeHtml(line)}\n`); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const listItem = line.match(/^(\s*)([-*]|(?:\d+|[A-Za-z])[.)])\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading) { closeParagraph(); closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (listItem) {
      closeParagraph();
      const marker = listItem[2];
      const style = /^\d/.test(marker) ? "decimal"
        : /^[A-Z]/.test(marker) ? "upper-alpha"
        : /^[a-z]/.test(marker) ? "lower-alpha"
        : null;
      const type = style ? "ol" : "ul";
      const indent = listItem[1].replaceAll("\t", "  ").length;
      addListItem(type, style, indent, listItem[3]);
    }
    else if (quote) { closeParagraph(); closeList(); output.push(`<blockquote>${inline(quote[1])}</blockquote>`); }
    else if (!line.trim()) { closeList(); paragraphLines.push(""); }
    else { closeList(); paragraphLines.push(line); }
  }
  closeParagraph();
  closeList();
  if (inCode) output.push("</code></pre>");
  return output.join("");
}

function updateMemoPreview() {
  const content = elements.memoForm.elements.namedItem("content")?.value || "";
  const preview = document.querySelector("#memo-preview");
  if (!preview) return;
  preview.classList.toggle("is-empty", !content.trim());
  preview.innerHTML = content.trim()
    ? renderMarkdown(content)
    : '<p class="memo-preview-empty">Markdown을 입력하면 여기에 미리보기가 표시됩니다.</p>';
}

function toggleMemoCodeFormatting(textarea) {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const multiline = selected.includes("\n");
  const opening = multiline ? "```\n" : "`";
  const closing = multiline ? "\n```" : "`";
  const wrapped = value.slice(start - opening.length, start) === opening
    && value.slice(end, end + closing.length) === closing;

  if (wrapped) {
    textarea.setRangeText(selected, start - opening.length, end + closing.length, "select");
  } else {
    textarea.setRangeText(`${opening}${selected}${closing}`, start, end, "end");
    const contentStart = start + opening.length;
    textarea.setSelectionRange(contentStart, contentStart + selected.length);
  }
  textarea.focus();
  updateMemoPreview();
  scheduleMemoDraftSave();
}

function toggleMemoInlineFormatting(textarea, marker) {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const wrapped = value.slice(start - marker.length, start) === marker
    && value.slice(end, end + marker.length) === marker;

  if (wrapped) {
    textarea.setRangeText(selected, start - marker.length, end + marker.length, "select");
  } else {
    textarea.setRangeText(`${marker}${selected}${marker}`, start, end, "end");
    const contentStart = start + marker.length;
    textarea.setSelectionRange(contentStart, contentStart + selected.length);
  }
  textarea.focus();
  updateMemoPreview();
  scheduleMemoDraftSave();
}

function indentMemoSelection(textarea, outdent = false) {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const trailingNewline = end > start && value[end - 1] === "\n";
  const lineEndSearch = trailingNewline ? end - 1 : end;
  const nextNewline = value.indexOf("\n", lineEndSearch);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const transformed = lines.map((line) => outdent ? line.replace(/^ {1,2}/, "") : `  ${line}`).join("\n");
  const firstDelta = transformed.split("\n", 1)[0].length - lines[0].length;
  const totalDelta = transformed.length - block.length;

  textarea.setRangeText(transformed, lineStart, lineEnd, "start");
  if (start === end) {
    const caret = Math.max(lineStart, start + firstDelta);
    textarea.setSelectionRange(caret, caret);
  } else {
    textarea.setSelectionRange(Math.max(lineStart, start + firstDelta), end + totalDelta);
  }
  textarea.focus();
  updateMemoPreview();
  scheduleMemoDraftSave();
}

function memoKindLabel(value) {
  return labelFor(MEMO_KIND_OPTIONS, value);
}

function memoSectionHtml() {
  const statusOptions = [["", "전체 상태"], ...MEMO_STATUS_OPTIONS].map(([value, label]) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  const kindOptions = [["", "전체 종류"], ...MEMO_KIND_OPTIONS].map(([value, label]) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  return `
    <section class="detail-section memo-section">
      <div class="memo-heading"><div class="section-heading-inline"><h3>작업 메모 <small>(WORK MEMOS)</small></h3><span class="memo-count" id="memo-count">총 0건</span></div><button class="primary-button memo-add-button" id="add-memo" type="button">＋ 새 메모 추가</button></div>
      <div class="memo-toolbar" role="group" aria-label="메모 필터">
        <label class="memo-filter-control"><span>상태:</span><select id="memo-status-filter">${statusOptions}</select></label>
        <label class="memo-filter-control"><span>종류:</span><select id="memo-kind-filter">${kindOptions}</select></label>
      </div>
      <div class="memo-filter-summary"><span id="memo-filter-summary">전체 0건 표시 중</span><span class="memo-filter-divider" aria-hidden="true">•</span><span>작성자: ALL</span><button type="button" id="reset-memo-filters"><span aria-hidden="true">↻</span> 필터 초기화</button></div>
      <p class="memo-filter-hint hidden" id="memo-filter-hint">필터 적용 중 · 순서 변경은 전체 보기에서만 가능합니다.</p>
      <div class="memo-list" id="memo-list"></div>
    </section>`;
}

function detailTabsHtml(activeTab) {
  const memoCount = (state.selectedContext?.memos || []).length;
  return `
    <nav class="detail-tabs" id="detail-tabs" aria-label="WorkItem 상세 메뉴">
      <button type="button" class="detail-tab ${activeTab === "overview" ? "active" : ""}" data-detail-tab="overview" aria-selected="${activeTab === "overview" ? "true" : "false"}">Overview</button>
      <button type="button" class="detail-tab ${activeTab === "memos" ? "active" : ""}" data-detail-tab="memos" aria-selected="${activeTab === "memos" ? "true" : "false"}">Memo <span>${memoCount}</span></button>
      <span class="detail-tab-id">${escapeHtml(state.selectedContext?.work_item?.id || "")}</span>
    </nav>`;
}

function setDetailTab(tab) {
  state.detailTab = tab === "memos" ? "memos" : "overview";
  document.querySelectorAll("[data-detail-tab]").forEach((button) => {
    const active = button.dataset.detailTab === state.detailTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#overview-panel")?.classList.toggle("hidden", state.detailTab !== "overview");
  document.querySelector("#memos-panel")?.classList.toggle("hidden", state.detailTab !== "memos");
}

function visibleMemos() {
  const memos = state.selectedContext?.memos || [];
  return memos.filter((memo) =>
    (!state.memoStatusFilter || memo.status === state.memoStatusFilter) &&
    (!state.memoKindFilter || memo.kind === state.memoKindFilter));
}

function renderMemoCards() {
  const list = document.querySelector("#memo-list");
  const count = document.querySelector("#memo-count");
  if (!list || !count) return;
  const statusFilter = document.querySelector("#memo-status-filter");
  const kindFilter = document.querySelector("#memo-kind-filter");
  if (statusFilter) statusFilter.value = state.memoStatusFilter;
  if (kindFilter) kindFilter.value = state.memoKindFilter;
  const memos = visibleMemos();
  const allMemos = state.selectedContext?.memos || [];
  const total = allMemos.length;
  const currentMemoIds = new Set(allMemos.map((memo) => memo.id));
  for (const memoId of state.expandedMemoIds) {
    if (!currentMemoIds.has(memoId)) state.expandedMemoIds.delete(memoId);
  }
  count.textContent = `총 ${total}건`;
  const filtered = Boolean(state.memoStatusFilter || state.memoKindFilter);
  const summary = document.querySelector("#memo-filter-summary");
  if (summary) summary.textContent = `${filtered ? "필터 결과 " : "전체 "}${memos.length}건 표시 중`;
  const hint = document.querySelector("#memo-filter-hint");
  hint?.classList.toggle("hidden", !filtered);
  if (!memos.length) {
    list.innerHTML = `<div class="subtle-empty">표시할 메모가 없습니다.</div>`;
    return;
  }
  list.innerHTML = memos.map((memo) => {
    const author = (memo.author || "anon").trim() || "anon";
    const authorInitial = [...author][0]?.toUpperCase() || "A";
    const statusLabel = memo.status === "open" ? "활성" : "종료";
    const statusActionLabel = memo.status === "open" ? "종료 상태로 변경" : "활성 상태로 변경";
    const expanded = state.expandedMemoIds.has(memo.id);
    return `
    <article class="memo-card ${memo.is_pinned ? "is-pinned" : ""} ${memo.status === "closed" ? "is-closed" : ""} ${expanded ? "is-expanded" : ""}" data-memo-id="${escapeHtml(memo.id)}" data-pinned="${memo.is_pinned ? "true" : "false"}" draggable="${filtered ? "false" : "true"}">
      <header class="memo-card-header" data-memo-toggle="${escapeHtml(memo.id)}" role="button" tabindex="0" aria-expanded="${expanded}" aria-controls="memo-content-${escapeHtml(memo.id)}" aria-label="메모 ${expanded ? "접기" : "열기"}">
        <div class="memo-card-header-main">
          <span class="memo-drag-handle" aria-hidden="true" title="드래그하여 순서 변경">⋮⋮</span>
          <div class="memo-card-title">
            <h4>${escapeHtml(memo.title)}</h4>
            <button type="button" class="memo-id" data-memo-action="copy-id" aria-label="Memo ID ${escapeHtml(memo.id)} 복사" title="Memo ID 복사">${escapeHtml(memo.id)}</button>
            <span class="memo-kind memo-kind-${escapeHtml(memo.kind)}">${escapeHtml(memoKindLabel(memo.kind))}</span>
            <span class="memo-status">${escapeHtml(statusLabel)}</span>
            ${memo.is_model_visible ? '<span class="memo-model-visible" title="작업 시작 시 Codex 컨텍스트에 포함">모델 공유</span>' : ""}
          </div>
        </div>
        <div class="memo-card-actions" aria-label="메모 작업">
          <span class="memo-expand-indicator" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
          <button type="button" data-memo-action="pin" aria-label="${memo.is_pinned ? "고정 해제" : "상단 고정"}" title="${memo.is_pinned ? "고정 해제" : "상단 고정"}">${memo.is_pinned ? "★" : "☆"}</button>
          <button type="button" data-memo-action="edit" aria-label="메모 수정" title="메모 수정">✎</button>
          <button type="button" data-memo-action="delete" aria-label="메모 삭제" title="메모 삭제">×</button>
        </div>
      </header>
      <section class="memo-content ${expanded ? "" : "hidden"}" id="memo-content-${escapeHtml(memo.id)}" aria-label="메모 본문">${renderMarkdown(memo.content)}</section>
      <footer class="memo-card-footer ${expanded ? "" : "hidden"}">
        <div class="memo-card-author">
          <span class="memo-author-avatar" aria-hidden="true">${escapeHtml(authorInitial)}</span>
          <span class="memo-author-name">${escapeHtml(author)}</span>
          <span class="memo-footer-divider" aria-hidden="true">•</span>
          <time>${escapeHtml(formatDate(memo.updated_at || memo.created_at))}</time>
        </div>
        <div class="memo-card-footer-actions">
          <button type="button" class="memo-copy-button" data-memo-action="copy" aria-label="마크다운 원본 복사" title="마크다운 원본 복사"><span aria-hidden="true">⧉</span><span class="memo-copy-label">Markdown 원본 복사</span></button>
          <button type="button" class="memo-status-button" data-memo-action="status"><span aria-hidden="true">✓</span><span>${escapeHtml(statusActionLabel)}</span></button>
        </div>
      </footer>
    </article>`;
  }).join("");
}

async function refreshSelectedDetail() {
  const item = state.selectedContext?.work_item;
  if (item) await selectItem(item.id);
}

function toggleMemoCard(card, memoId) {
  const expanded = !state.expandedMemoIds.has(memoId);
  if (expanded) state.expandedMemoIds.add(memoId);
  else state.expandedMemoIds.delete(memoId);
  card.classList.toggle("is-expanded", expanded);
  card.querySelector("[data-memo-toggle]")?.setAttribute("aria-expanded", String(expanded));
  card.querySelector("[data-memo-toggle]")?.setAttribute("aria-label", `메모 ${expanded ? "접기" : "열기"}`);
  card.querySelector(".memo-content")?.classList.toggle("hidden", !expanded);
  card.querySelector(".memo-card-footer")?.classList.toggle("hidden", !expanded);
}

function handleMemoHeaderToggle(event) {
  const header = event.target.closest("[data-memo-toggle]");
  if (!header || event.target.closest("[data-memo-action], .memo-drag-handle")) return;
  const card = header.closest("[data-memo-id]");
  if (card) toggleMemoCard(card, card.dataset.memoId);
}

function handleMemoHeaderKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const header = event.target.closest("[data-memo-toggle]");
  if (!header || event.target.closest("[data-memo-action], .memo-drag-handle")) return;
  event.preventDefault();
  const card = header.closest("[data-memo-id]");
  if (card) toggleMemoCard(card, card.dataset.memoId);
}

async function handleMemoAction(event) {
  const button = event.target.closest("[data-memo-action]");
  const card = event.target.closest("[data-memo-id]");
  if (!button || !card) return;
  const item = state.selectedContext?.work_item;
  const memoId = card.dataset.memoId;
  const memo = (state.selectedContext?.memos || []).find((entry) => entry.id === memoId);
  if (!item || !memo) return;
  const action = button.dataset.memoAction;
  try {
    if (action === "edit") return openMemoModal(memoId);
    if (action === "copy") return copyMemoMarkdown(button, memo.content);
    if (action === "copy-id") return copyMemoId(button, memo.id);
    if (action === "delete") {
      if (!window.confirm(`“${memo.title}” 메모를 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
      await api(`/api/work-items/${encodeURIComponent(item.id)}/memos/${encodeURIComponent(memoId)}`, { method: "DELETE" });
    } else if (action === "status" || action === "pin") {
      const payload = action === "status" ? { status: memo.status === "open" ? "closed" : "open" } : { is_pinned: !memo.is_pinned };
      await api(`/api/work-items/${encodeURIComponent(item.id)}/memos/${encodeURIComponent(memoId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    }
    await refreshSelectedDetail();
  } catch (error) { window.alert(error.message); }
}

async function copyMemoMarkdown(button, content) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      const helper = document.createElement("textarea");
      helper.value = content;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    const label = button.querySelector(".memo-copy-label");
    if (!label) return;
    const original = label.textContent;
    label.textContent = "복사됨";
    button.classList.add("is-copied");
    window.setTimeout(() => {
      label.textContent = original;
      button.classList.remove("is-copied");
    }, 1600);
  } catch (_) {
    window.alert("Markdown 원본을 복사하지 못했습니다.");
  }
}

async function copyMemoId(button, memoId) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(memoId);
    } else {
      const helper = document.createElement("textarea");
      helper.value = memoId;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    const originalTitle = button.title;
    button.title = "복사됨";
    button.classList.add("is-copied");
    showToast("Memo ID가 복사되었습니다.");
    window.setTimeout(() => {
      button.title = originalTitle;
      button.classList.remove("is-copied");
    }, 1600);
  } catch (_) {
    window.alert("Memo ID를 복사하지 못했습니다.");
  }
}

let toastTimer = null;

function showToast(message) {
  const toast = elements.toast;
  if (!toast) return;
  if (toastTimer) window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!toast.classList.contains("is-visible")) toast.classList.add("hidden");
    }, 180);
  }, 1600);
}

async function saveMemoOrder() {
  const item = state.selectedContext?.work_item;
  const list = document.querySelector("#memo-list");
  if (!item || !list || state.memoStatusFilter || state.memoKindFilter) return;
  const memoIds = [...list.querySelectorAll("[data-memo-id]")].map((node) => node.dataset.memoId);
  try {
    const payload = await api(`/api/work-items/${encodeURIComponent(item.id)}/memos/reorder`, { method: "POST", body: JSON.stringify({ memo_ids: memoIds }) });
    state.selectedContext.memos = payload.memos;
    renderMemoCards();
  } catch (error) { window.alert(error.message); await refreshSelectedDetail(); }
}

function bindMemoInteractions() {
  const list = document.querySelector("#memo-list");
  document.querySelector("#memo-status-filter")?.addEventListener("change", (event) => { state.memoStatusFilter = event.target.value; renderMemoCards(); });
  document.querySelector("#memo-kind-filter")?.addEventListener("change", (event) => { state.memoKindFilter = event.target.value; renderMemoCards(); });
  document.querySelector("#reset-memo-filters")?.addEventListener("click", () => {
    state.memoStatusFilter = ""; state.memoKindFilter = "";
    document.querySelector("#memo-status-filter").value = ""; document.querySelector("#memo-kind-filter").value = ""; renderMemoCards();
  });
  document.querySelector("#add-memo")?.addEventListener("click", () => openMemoModal());
  list?.addEventListener("click", handleMemoAction);
  list?.addEventListener("click", handleMemoHeaderToggle);
  list?.addEventListener("keydown", handleMemoHeaderKeydown);
  list?.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-memo-id]");
    if (!card || state.memoStatusFilter || state.memoKindFilter) { event.preventDefault(); return; }
    card.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.dataset.memoId);
  });
  list?.addEventListener("dragend", (event) => event.target.closest("[data-memo-id]")?.classList.remove("dragging"));
  list?.addEventListener("dragover", (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-memo-id]");
    const source = list.querySelector(".dragging");
    if (!target || !source || target === source || target.dataset.pinned !== source.dataset.pinned) return;
    const rect = target.getBoundingClientRect();
    target.parentNode.insertBefore(source, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
  });
  list?.addEventListener("drop", (event) => { event.preventDefault(); saveMemoOrder(); });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) { /* empty or non-JSON response */ }
  if (!response.ok) {
    const error = new Error(payload.error?.message || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setNextActionsOpen(open) {
  state.nextActionsOpen = open;
  elements.nextActionsPanel.classList.toggle("is-open", open);
  elements.nextActionsPanel.setAttribute("aria-hidden", String(!open));
  elements.nextActionsPanel.inert = !open;
  elements.nextActionsTrigger.setAttribute("aria-expanded", String(open));
  elements.nextActionsTrigger.setAttribute("aria-label", open ? "다음 할일 닫기" : "다음 할일 열기");
  elements.nextActionsTrigger.classList.toggle("is-open", open);
  if (open) {
    loadNextActions();
    document.querySelector("#next-actions-close").focus();
  } else {
    elements.nextActionsTrigger.focus();
  }
}

async function loadNextActions() {
  elements.nextActionsList.innerHTML = '<p class="next-actions-message">다음 할일을 불러오는 중입니다.</p>';
  try {
    const { work_items: items } = await api("/api/work-items/next-actions");
    if (!state.nextActionsOpen) return;
    document.querySelector("#next-actions-count").textContent = `${items.length}개 WI · 최근 작업과 다음 행동`;
    elements.nextActionsList.innerHTML = items.length ? items.map((item) => {
      const recent = item.last_run_status === "running"
        ? `진행 중: ${item.last_run_intent || "작업 실행"}`
        : item.last_run_summary || (item.last_run_at ? item.last_run_intent : "아직 실행 기록이 없습니다.");
      return `<article class="next-actions-card">
        <div class="next-actions-card-meta"><code>${escapeHtml(item.id)}</code><time>${escapeHtml(formatRunDate(item.last_run_at || item.updated_at))}</time><button type="button" data-next-action-id="${escapeHtml(item.id)}">WI 상세 보기 <span aria-hidden="true">→</span></button></div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="next-actions-card-copy next-actions-card-plan"><span><span aria-hidden="true">◉</span> 다음 할일</span><p>${escapeHtml(item.next_action || "아직 정해진 다음 행동이 없습니다.")}</p></div>
        <div class="next-actions-card-copy next-actions-card-recent"><span><span aria-hidden="true">◷</span> 지난 동작</span><p>${escapeHtml(recent || "실행 결과가 기록되지 않았습니다.")}</p></div>
      </article>`;
    }).join("") : '<p class="next-actions-message">진행할 WI가 없습니다.</p>';
  } catch (error) {
    if (!state.nextActionsOpen) return;
    elements.nextActionsList.innerHTML = `<p class="next-actions-message">다음 할일을 불러오지 못했습니다.<br>${escapeHtml(error.message)}</p>`;
  }
}

function countFor(type, value) {
  return state.items.filter((item) => type === "status" ? statusOf(item) === value : item.kind === value).length;
}

function buildFilters(containerId, type, options) {
  const container = document.querySelector(containerId);
  container.innerHTML = "";
  for (const [value, label] of options) {
    const row = document.createElement("label");
    row.className = "filter-row";
    row.innerHTML = `
      <input type="checkbox" value="${escapeHtml(value)}" />
      <span>${escapeHtml(label)}</span>
      <span class="filter-count">${countFor(type, value)}</span>
    `;
    const input = row.querySelector("input");
    input.checked = (type === "status" ? state.statusFilters : state.kindFilters).has(value);
    input.addEventListener("change", () => {
      const selected = type === "status" ? state.statusFilters : state.kindFilters;
      input.checked ? selected.add(value) : selected.delete(value);
      renderItems();
    });
    container.append(row);
  }
}

function filteredItems() {
  return state.items.filter((item) => {
    const matchesStatus = state.statusFilters.size === 0 || state.statusFilters.has(statusOf(item));
    const matchesKind = state.kindFilters.size === 0 || state.kindFilters.has(item.kind);
    return matchesStatus && matchesKind;
  });
}

function renderItems() {
  const items = filteredItems();
  if (state.currentView === "work-items") {
    elements.visibleCount.textContent = `${items.length} visible`;
    elements.dockSummary.textContent = `전체 ${state.items.length}개 · 화면 ${items.length}개`;
  }
  elements.itemsList.innerHTML = "";

  if (items.length === 0) {
    elements.itemsList.innerHTML = `<div class="empty-list"><strong>표시할 WorkItem이 없습니다.</strong><p>필터를 초기화하거나 새 Draft를 만들어보세요.</p></div>`;
    return;
  }

  for (const item of items) {
    const virtualStatus = statusOf(item);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `item-card ${item.id === state.selectedId ? "selected" : ""} ${item.is_draft ? "muted" : ""}`;
    card.dataset.workItemId = item.id;
    card.innerHTML = `
      <div class="card-top">
        <div class="card-meta">
          <span class="wi-id">${escapeHtml(item.id)}</span>
          <span class="badge kind-badge">${escapeHtml(labelFor(KIND_OPTIONS, item.kind))}</span>
        </div>
        <span class="badge status-${escapeHtml(virtualStatus)}">${escapeHtml(labelFor(STATUS_OPTIONS, virtualStatus))}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="item-goal">${escapeHtml(item.goal)}</p>
      <div class="card-footer">
        <span class="priority-${escapeHtml(item.priority)}">◆ ${escapeHtml(priorityLabel(item.priority))}</span>
        <span class="feature-name">◇ ${escapeHtml(item.feature_title || "Feature 미지정")}</span>
        <span>${escapeHtml(formatDate(item.created_at))}</span>
      </div>
    `;
    card.addEventListener("click", () => selectItem(item.id));
    elements.itemsList.append(card);
  }
}

function emptySection(message) {
  return `<div class="subtle-empty">${escapeHtml(message)}</div>`;
}

function criterionStatusLabel(status) {
  return {
    passed: "Passed",
    failed: "Failed",
    pending: "Pending",
    waived: "Waived",
  }[status] || status;
}

function criterionMark(status) {
  return {
    passed: "✓",
    failed: "×",
    pending: "•",
    waived: "—",
  }[status] || "•";
}

function evidenceKindLabel(kind) {
  return {
    file: "File",
    commit: "Commit",
    test_run: "Test Run",
    lint_run: "Lint Run",
    build_run: "Build Run",
    pull_request: "Pull Request",
    deployment: "Deployment",
    screenshot: "Screenshot",
    report: "Report",
    other: "Other",
  }[kind] || kind;
}

function evidenceStatusLabel(status) {
  return {
    passed: "Passed",
    failed: "Failed",
    pending: "Pending",
    not_applicable: "N/A",
  }[status] || status;
}

function evidenceStatusClass(status) {
  return ["passed", "failed", "pending", "not_applicable"].includes(status)
    ? status : "unknown";
}

function evidenceDetailsHtml(criterion) {
  const criterionId = criterion.id;
  if (state.criterionEvidenceLoading.has(criterionId)) {
    return '<div class="criterion-evidence-panel"><div class="criterion-evidence-loading"><span class="spinner"></span><span>Evidence를 불러오는 중입니다.</span></div></div>';
  }
  const error = state.criterionEvidenceErrors.get(criterionId);
  if (error) {
    return `<div class="criterion-evidence-panel"><div class="criterion-evidence-error"><span>${escapeHtml(error)}</span><button type="button" data-criterion-retry="${escapeHtml(criterionId)}">다시 시도</button></div></div>`;
  }
  const evidence = state.criterionEvidence.get(criterionId) || [];
  if (!evidence.length) {
    return `<div class="criterion-evidence-panel" id="criterion-evidence-${escapeHtml(criterionId)}"><div class="criterion-evidence-heading"><span>Evidence · 없음</span></div><div class="criterion-evidence-empty">연결된 Evidence가 없습니다.</div></div>`;
  }
  return `<div class="criterion-evidence-panel" id="criterion-evidence-${escapeHtml(criterionId)}">
    <div class="criterion-evidence-heading"><span>Evidence · ${evidence.length}개</span></div>
    <div class="criterion-evidence-list">${evidence.map((entry) => {
      const status = evidenceStatusClass(entry.verification_status);
      const runStatus = entry.run_status ? runStatusClass(entry.run_status) : "unknown";
      const runMeta = [
        entry.run_id,
        entry.run_status ? runStatusLabel(entry.run_status) : null,
        entry.run_started_at ? formatRunDate(entry.run_started_at) : null,
      ].filter(Boolean).join(" · ");
      return `<article class="evidence-card">
        <div class="evidence-card-meta">
          <span class="evidence-status evidence-status-${status}">${escapeHtml(evidenceStatusLabel(entry.verification_status))}</span>
          <span class="evidence-kind">Artifact: ${escapeHtml(evidenceKindLabel(entry.kind))}</span>
          ${runMeta ? `<span class="evidence-run evidence-run-${runStatus}">${escapeHtml(runMeta)}</span>` : ""}
        </div>
        <strong class="evidence-summary">${escapeHtml(entry.summary)}</strong>
        ${entry.note ? `<p class="evidence-note">${escapeHtml(entry.note)}</p>` : ""}
      </article>`;
    }).join("")}</div>
  </div>`;
}

function criteriaHtml(criteria) {
  return criteria.length
    ? `<ul class="criteria-list">${criteria.map((criterion) => {
        const status = criterion.status || "pending";
        const expanded = state.expandedCriterionIds.has(criterion.id);
        const evidenceCount = Number(criterion.evidence_count || 0);
        return `<li class="criterion criterion-${escapeHtml(status)} ${expanded ? "is-expanded" : ""}" data-criterion-id="${escapeHtml(criterion.id)}">
          <div class="criterion-header">
            <div class="criterion-main">
              <span class="criterion-mark" aria-label="${escapeHtml(criterionStatusLabel(status))}">${escapeHtml(criterionMark(status))}</span>
              <span class="criterion-description">${escapeHtml(criterion.description)}</span>
            </div>
            <div class="criterion-controls">
              <span class="criterion-evidence-count">${evidenceCount ? `Evidence ${evidenceCount}개` : "Evidence 없음"}</span>
              <button type="button" class="criterion-toggle" data-criterion-toggle="${escapeHtml(criterion.id)}" aria-expanded="${expanded}" aria-controls="criterion-evidence-${escapeHtml(criterion.id)}" aria-label="Evidence ${expanded ? "접기" : "펼치기"}" title="Evidence ${expanded ? "접기" : "펼치기"}">
                <span aria-hidden="true">⌃</span>
              </button>
            </div>
          </div>
          ${expanded ? evidenceDetailsHtml(criterion) : ""}
        </li>`;
      }).join("")}</ul>`
    : emptySection(state.selectedContext?.work_item?.is_draft ? "구체화 전이라 완료 조건이 아직 없습니다." : "등록된 완료 조건이 없습니다.");
}

async function loadCriterionEvidence(criterionId) {
  const item = state.selectedContext?.work_item;
  if (!item) return;
  state.criterionEvidenceLoading.add(criterionId);
  state.criterionEvidenceErrors.delete(criterionId);
  renderDetail(state.selectedContext);
  try {
    const payload = await api(`/api/work-items/${encodeURIComponent(item.id)}/acceptance-criteria/${encodeURIComponent(criterionId)}/evidence`);
    if (state.selectedId !== item.id) return;
    state.criterionEvidence.set(criterionId, payload.evidence || []);
  } catch (error) {
    if (state.selectedId === item.id) state.criterionEvidenceErrors.set(criterionId, error.message);
  } finally {
    state.criterionEvidenceLoading.delete(criterionId);
    if (state.selectedId === item.id && state.expandedCriterionIds.has(criterionId)) renderDetail(state.selectedContext);
  }
}

async function toggleCriterionEvidence(criterionId) {
  if (state.expandedCriterionIds.has(criterionId)) {
    state.expandedCriterionIds.delete(criterionId);
    renderDetail(state.selectedContext);
    return;
  }
  state.expandedCriterionIds.add(criterionId);
  await loadCriterionEvidence(criterionId);
}

function bindCriterionInteractions() {
  document.querySelectorAll("[data-criterion-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleCriterionEvidence(button.dataset.criterionToggle));
  });
  document.querySelectorAll("[data-criterion-retry]").forEach((button) => {
    button.addEventListener("click", () => loadCriterionEvidence(button.dataset.criterionRetry));
  });
}

function renderDetail(context) {
  state.selectedContext = context;
  const item = context.work_item;
  const capabilities = context.capabilities || {};
  const virtualStatus = statusOf(item);
  const criteria = context.acceptance_criteria || [];
  const runs = [context.running_run, ...(context.recent_runs || [])].filter(Boolean);
  const runsHtml = runs.length
    ? `<ul class="runs-list">${runs.map((run) => {
        const status = runStatusClass(run.status);
        const result = run.summary || (run.status === "running" ? "현재 실행 중입니다." : "실행 결과가 기록되지 않았습니다.");
        return `
        <li class="run-card run-card-${status} run-card-link" data-open-run="${escapeHtml(run.id)}" role="button" tabindex="0" aria-label="${escapeHtml(run.id)} 상세 Run 화면에서 보기">
          <div class="run-card-header">
            <div class="run-card-identity">
              <span class="run-status-pill run-status-${status}"><span class="run-status-dot"></span>${escapeHtml(runStatusLabel(run.status))}</span>
              <code>${escapeHtml(run.id)}</code>
            </div>
            <div class="run-card-time">
              <time>${escapeHtml(formatRunDate(run.started_at))}</time>
              <span class="run-elapsed ${run.status === "running" ? "is-running" : ""}">${run.status === "running" ? runProgressHtml() : escapeHtml(durationLabel(run))}</span>
            </div>
          </div>
          <div class="run-card-body">
            <div class="run-field"><span>실행 목적</span><p>${escapeHtml(run.intent || "실행 목적이 기록되지 않았습니다.")}</p></div>
            <div class="run-field"><span>실행 결과</span>${run.status === "running"
              ? `<div class="run-result is-running">${runProgressHtml()}</div>`
              : `<p class="run-result">${escapeHtml(result)}</p>`}</div>
            ${run.termination_reason ? `<div class="run-termination"><span class="run-warning-icon">△</span><span>경고: ${escapeHtml(run.termination_reason)}</span></div>` : ""}
          </div>
        </li>`;
      }).join("")}</ul>`
    : emptySection(item.is_draft ? "Draft에는 아직 Run이 없습니다." : "실행 기록이 없습니다.");
  const statusOptions = (capabilities.allowed_statuses || []).map((target) => `
    <button type="button" role="menuitem" data-status-target="${escapeHtml(target)}">
      ${escapeHtml(labelFor(STATUS_OPTIONS, target))}로 변경
    </button>`).join("");
  const deleteDisabled = capabilities.can_delete ? "" : "disabled";
  const editDisabled = capabilities.can_edit ? "" : "disabled";

  elements.detail.innerHTML = `
    <header class="detail-header">
      <div class="detail-header-top">
        <div class="card-meta">
          <span class="wi-id">${escapeHtml(item.id)}</span>
          <span class="badge kind-badge">${escapeHtml(labelFor(KIND_OPTIONS, item.kind))}</span>
        </div>
        <div class="detail-actions">
          <div class="status-control">
            <button class="status-button badge status-${escapeHtml(virtualStatus)}" id="status-menu-button" type="button" aria-haspopup="menu" aria-expanded="false" ${statusOptions ? "" : "disabled"}>
              ${escapeHtml(labelFor(STATUS_OPTIONS, virtualStatus))}${statusOptions ? " ▾" : ""}
            </button>
            ${statusOptions ? `<div class="status-menu" id="status-menu" role="menu">${statusOptions}</div>` : ""}
          </div>
          <button class="detail-action-button" id="edit-work-item" type="button" ${editDisabled}>수정</button>
          <button class="detail-action-button danger" id="delete-work-item" type="button" ${deleteDisabled} title="${escapeHtml(capabilities.delete_reason || "WorkItem 삭제")}">삭제</button>
        </div>
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      <div class="detail-metadata">
        <div class="metadata-pair"><span>Status</span><strong>${escapeHtml(labelFor(STATUS_OPTIONS, virtualStatus))}</strong></div>
        <div class="metadata-pair"><span>Priority</span><strong>${escapeHtml(priorityLabel(item.priority))}</strong></div>
        <div class="metadata-pair"><span>Feature</span><strong>${escapeHtml(context.feature?.title || "미지정")}</strong></div>
        <div class="metadata-pair"><span>Created</span><strong>${escapeHtml(formatDate(item.created_at))}</strong></div>
      </div>
    </header>
    ${detailTabsHtml(state.detailTab)}
    <div class="detail-body">
      <div id="overview-panel" class="detail-panel ${state.detailTab === "overview" ? "" : "hidden"}">
        ${item.is_draft ? `<div class="draft-notice"><strong>Draft WorkItem</strong><br />아직 실행 계획과 완료 조건을 다듬기 전입니다. <code>w/</code>로 선택하면 Codex가 먼저 구체화합니다.</div>` : ""}
        <section class="detail-section"><h3>Goal</h3><p class="detail-block">${escapeHtml(item.goal)}</p></section>
        ${item.description ? `<section class="detail-section"><h3>Description</h3><p class="detail-block">${escapeHtml(item.description)}</p></section>` : ""}
        <section class="detail-section"><h3>Next Action</h3>${item.next_action ? `<p class="detail-block next-action">${escapeHtml(item.next_action)}</p>` : emptySection("다음 행동은 구체화 과정에서 정해집니다.")}</section>
        <section class="detail-section acceptance-criteria-section"><div class="acceptance-criteria-heading"><h3>Acceptance Criteria</h3><span class="acceptance-criteria-count">${criteria.length}개</span><span class="acceptance-criteria-hint">클릭하여 검증 Evidence 확인</span></div>${criteriaHtml(criteria)}</section>
        <section class="detail-section runs-section"><div class="runs-section-heading"><h3>Recent Runs</h3>${runs.length ? `<span class="runs-count">총 ${runs.length}건</span>` : ""}</div>${runsHtml}</section>
      </div>
      <div id="memos-panel" class="detail-panel ${state.detailTab === "memos" ? "" : "hidden"}">
        ${memoSectionHtml()}
      </div>
    </div>
  `;
  elements.emptyDetail.classList.add("hidden");
  elements.detail.classList.remove("hidden");
  bindDetailActions();
  bindCriterionInteractions();
  renderMemoCards();
  bindMemoInteractions();
}

function bindDetailActions() {
  document.querySelectorAll("[data-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => setDetailTab(button.dataset.detailTab));
  });
  const statusButton = document.querySelector("#status-menu-button");
  const statusControl = statusButton?.closest(".status-control");
  statusButton?.addEventListener("click", () => {
    const opened = statusControl.classList.toggle("open");
    statusButton.setAttribute("aria-expanded", String(opened));
  });
  document.querySelectorAll("[data-status-target]").forEach((button) => {
    button.addEventListener("click", () => changeSelectedStatus(button.dataset.statusTarget));
  });
  document.querySelector("#edit-work-item")?.addEventListener("click", openEditModal);
  document.querySelector("#delete-work-item")?.addEventListener("click", openDeleteModal);
  document.querySelectorAll("[data-open-run]").forEach((card) => {
    const openRun = () => switchView("runs", state.selectedContext?.work_item?.id, card.dataset.openRun);
    card.addEventListener("click", openRun);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRun(); }
    });
  });
}

async function changeSelectedStatus(target) {
  const item = state.selectedContext?.work_item;
  const confirmation = target === "done"
    ? "이 WorkItem의 결과를 확인했으며 완료 처리할까요?"
    : `${labelFor(STATUS_OPTIONS, target)} 상태로 변경할까요?`;
  if (!item || !window.confirm(confirmation)) return;
  try {
    const context = await api(`/api/work-items/${encodeURIComponent(item.id)}/status`, {
      method: "PATCH", body: JSON.stringify({ status: target }),
    });
    await loadItems({ selectId: context.work_item.id });
  } catch (error) {
    window.alert(error.status === 409 ? `${error.message}\n최신 상태를 다시 불러옵니다.` : error.message);
    await loadItems({ selectId: item.id });
  }
}

async function selectItem(workItemId) {
  if (state.selectedId !== workItemId) {
    state.expandedMemoIds.clear();
    state.expandedCriterionIds.clear();
    state.criterionEvidence.clear();
    state.criterionEvidenceLoading.clear();
    state.criterionEvidenceErrors.clear();
  }
  state.selectedId = workItemId;
  renderItems();
  elements.detail.innerHTML = `<div class="loading-state"><span class="spinner"></span><p>상세 정보를 불러오는 중입니다.</p></div>`;
  elements.emptyDetail.classList.add("hidden");
  elements.detail.classList.remove("hidden");
  try {
    renderDetail(await api(`/api/work-items/${encodeURIComponent(workItemId)}`));
  } catch (error) {
    elements.detail.innerHTML = `<div class="empty-detail"><h2>상세 정보를 불러오지 못했습니다.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function loadItems({ selectId = null } = {}) {
  elements.loading.classList.remove("hidden");
  try {
    const payload = await api("/api/work-items");
    state.items = payload.work_items;
    elements.healthDot.className = "health-dot healthy";
    elements.healthLabel.textContent = "State DB 연결됨";
    buildFilters("#status-filters", "status", STATUS_OPTIONS);
    buildFilters("#kind-filters", "kind", KIND_OPTIONS);
    renderItems();
    const target = selectId || (state.selectedId && state.items.some((item) => item.id === state.selectedId) ? state.selectedId : state.items[0]?.id);
    if (target) await selectItem(target);
  } catch (error) {
    elements.healthDot.className = "health-dot failed";
    elements.healthLabel.textContent = "State DB 연결 실패";
    elements.itemsList.innerHTML = `<div class="empty-list"><strong>WorkItem을 불러오지 못했습니다.</strong><p>${escapeHtml(error.message)}</p></div>`;
    elements.dockSummary.textContent = "상태 저장소를 확인해 주세요";
  } finally {
    elements.loading.classList.add("hidden");
  }
}

function dashboardCount(statuses, key) {
  return Number(statuses?.[key] || 0).toLocaleString("ko-KR");
}

function dashboardMetric(label, value, tone = "") {
  return `<div class="dashboard-metric"><b class="${tone}">${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

function dashboardSummaryCard({ title, description, total, metrics, footer = "" }) {
  return `<article class="dashboard-summary-card">
    <div class="dashboard-card-heading"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(description)}</span></div>
    <div class="dashboard-total">${Number(total || 0).toLocaleString("ko-KR")}<small>전체</small></div>
    <div class="dashboard-metrics">${metrics.join("")}</div>
    ${footer ? `<p class="dashboard-card-footnote">${footer}</p>` : ""}
  </article>`;
}

function dashboardWeekLabel(weekStart) {
  const thursday = new Date(`${weekStart}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  return `${thursday.getUTCMonth() + 1}월 ${Math.ceil(thursday.getUTCDate() / 7)}주`;
}

function dashboardCompletionChart(workItems, runs, daily = false) {
  const items = workItems || [];
  const runValues = runs || [];
  const values = items.length ? items : runValues;
  const key = daily ? "day" : "week";
  const title = daily ? "지난 7일간 WI·Run 완료" : "주차별 WI·Run 완료";
  const max = Math.max(1, ...items.map((row) => Number(row.count || 0)), ...runValues.map((row) => Number(row.count || 0)));
  const width = 520;
  const top = 18;
  const bottom = 158;
  const left = 44;
  const right = 505;
  const xAt = (index) => values.length < 2 ? (left + right) / 2 : left + (right - left) * index / (values.length - 1);
  const yAt = (value) => bottom - (bottom - top) * Number(value || 0) / max;
  const points = (rows) => rows.map((row, index) => `${xAt(index)},${yAt(row.count)}`).join(" ");
  const grid = [0, .5, 1].map((fraction) => {
    const y = bottom - (bottom - top) * fraction;
    const label = Math.round(max * fraction);
    return `<line class="dashboard-gridline" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="dashboard-axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${label}</text>`;
  }).join("");
  const dots = (rows, otherRows, color, label) => rows.map((row, index) => {
    const date = new Date(`${row[key]}T00:00:00Z`);
    const dateLabel = date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "UTC" });
    const caption = `${daily ? dateLabel : dashboardWeekLabel(row.week)} : ${Number(row.count || 0).toLocaleString("ko-KR")}개`;
    const overlap = otherRows[index] && Number(otherRows[index].count || 0) === Number(row.count || 0);
    const x = xAt(index) + (overlap ? color === "is-runs" ? 5 : -5 : 0);
    const y = yAt(row.count);
    const cardX = Math.max(left, Math.min(right - 124, x - 62));
    const cardY = y < top + 38 ? y + 11 : y - 37;
    return `<g class="dashboard-chart-node"><circle cx="${x}" cy="${y}" r="10" fill="transparent" aria-hidden="true"/><circle class="dashboard-chart-point ${color}" cx="${x}" cy="${y}" r="5" tabindex="0" role="img" aria-label="${label} ${escapeHtml(caption)}"/><g class="dashboard-node-card" aria-hidden="true"><rect x="${cardX}" y="${cardY}" width="124" height="28" rx="6"/><circle class="dashboard-node-card-dot ${color}" cx="${cardX + 12}" cy="${cardY + 14}" r="3"/><text x="${cardX + 22}" y="${cardY + 18}">${escapeHtml(caption)}</text></g></g>`;
  }).join("");
  const dateLabel = (row) => row?.[key] ? new Date(`${row[key]}T00:00:00Z`).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "UTC" }) : "";
  const axisLabels = values.map((row, index) => `<text class="dashboard-axis-label" x="${xAt(index)}" y="183" text-anchor="${index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"}">${escapeHtml(daily ? dateLabel(row) : dashboardWeekLabel(row.week))}</text>`).join("");
  const itemTotal = daily ? items.reduce((total, row) => total + Number(row.count || 0), 0) : Number(items.at(-1)?.count || 0);
  const runTotal = daily ? runValues.reduce((total, row) => total + Number(row.count || 0), 0) : Number(runValues.at(-1)?.count || 0);
  return `<article class="dashboard-chart-card">
    <div class="dashboard-chart-heading"><div><h3>${title}</h3><p>완료된 WI와 성공한 Run · UTC 기준</p></div><span>${daily ? "최근 7일" : "최근 8주"}</span></div>
    <div class="dashboard-chart-legend"><span><i class="is-work-items"></i>WI</span><span><i class="is-runs"></i>Run</span></div>
    ${values.length ? `<svg class="dashboard-line-chart" viewBox="0 0 ${width} 190" role="img" aria-label="${title}">${grid}<polyline class="dashboard-chart-line is-work-items" points="${points(items)}"/><polyline class="dashboard-chart-line is-runs" points="${points(runValues)}"/>${dots(items, runValues, "is-work-items", "WI")}${dots(runValues, items, "is-runs", "Run")}${axisLabels}</svg>` : `<div class="dashboard-chart-empty">표시할 기록이 없습니다.</div>`}
    <div class="dashboard-chart-footnote"><span>${daily ? "오늘 포함 7일" : "주 시작은 월요일"} · 종료 시각 기준</span><strong>${daily ? "7일 합계" : "이번 주"} WI ${itemTotal.toLocaleString("ko-KR")} · Run ${runTotal.toLocaleString("ko-KR")}</strong></div>
  </article>`;
}

function dashboardPriorityChart(priorities) {
  const definitions = [
    ["urgent", "긴급", "urgent"], ["high", "높음", "high"],
    ["normal", "보통", "normal"], ["low", "낮음", "low"],
  ];
  const total = definitions.reduce((sum, [key]) => sum + Number(priorities?.[key] || 0), 0);
  let cursor = 0;
  const stops = definitions.map(([key, label, tone]) => {
    const count = Number(priorities?.[key] || 0);
    const start = total ? cursor / total * 100 : 0;
    cursor += count;
    const end = total ? cursor / total * 100 : 0;
    return { key, label, tone, count, start, end };
  });
  const background = total
    ? `conic-gradient(${stops.map((stop) => `var(--dashboard-${stop.tone}) ${stop.start}% ${stop.end}%`).join(",")})`
    : "conic-gradient(var(--line) 0 100%)";
  const legend = stops.map((stop) => `<div class="dashboard-priority-row"><span><i class="dashboard-priority-swatch ${stop.tone}"></i>${stop.label}</span><strong>${stop.count.toLocaleString("ko-KR")}</strong></div>`).join("");
  return `<article class="dashboard-chart-card">
    <div class="dashboard-chart-heading"><div><h3>WI 우선순위 분포</h3><p>완료·취소되지 않은 Work Item</p></div><span>현재</span></div>
    <div class="dashboard-priority-content"><div class="dashboard-donut" style="--dashboard-donut:${background}" role="img" aria-label="미완료 WI ${total}개"><div><b>${total.toLocaleString("ko-KR")}</b><span>미완료 WI</span></div></div><div class="dashboard-priority-legend">${legend}</div></div>
  </article>`;
}

function dashboardFeatureProgress(features) {
  const shown = (features || []).slice(0, 8);
  const rows = shown.map((feature) => {
    const percent = Math.max(0, Math.min(100, Number(feature.progress_percent || 0)));
    const title = `${feature.title} · ${percent}%`;
    return `<div class="dashboard-feature-row" title="${escapeHtml(title)}"><div class="dashboard-feature-name"><strong>${escapeHtml(feature.title)}</strong><span>${feature.status === "planned" ? "계획됨" : "진행 중"}</span></div><div class="dashboard-progress-track" role="progressbar" aria-label="${escapeHtml(feature.title)} 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div><b>${percent}%</b></div>`;
  }).join("");
  return `<article class="dashboard-chart-card dashboard-feature-card">
    <div class="dashboard-chart-heading"><div><h3>Feature 진행률</h3><p>연결된 취소 제외 WI 중 완료 비율</p></div><span>계획·진행 중</span></div>
    ${rows ? `<div class="dashboard-feature-list">${rows}</div>` : `<div class="dashboard-chart-empty">계획되었거나 진행 중인 Feature가 없습니다.</div>`}
    ${(features || []).length > 8 ? `<p class="dashboard-chart-footnote">전체 ${(features || []).length}개 중 진행률이 낮은 8개 표시</p>` : ""}
  </article>`;
}

function renderOverview() {
  const data = state.overview;
  if (!data || !elements.overviewDashboard) return;
  const featureStates = data.features?.status || {};
  const itemStates = data.work_items?.status || {};
  const runStates = data.runs?.status || {};
  const itemWait = Number(itemStates.backlog || 0) + Number(itemStates.ready || 0);
  const cancelledFeatures = Number(featureStates.cancelled || 0);
  const cancelledItems = Number(itemStates.cancelled || 0);
  const cancelledRuns = Number(runStates.cancelled || 0);
  const cards = [
    dashboardSummaryCard({
      title: "Feature", description: "기능 단위", total: data.features?.total,
      metrics: [dashboardMetric("진행 중", dashboardCount(featureStates, "active"), "is-active"), dashboardMetric("계획됨", dashboardCount(featureStates, "planned")), dashboardMetric("일시 중지", dashboardCount(featureStates, "paused"), "is-paused"), dashboardMetric("완료", dashboardCount(featureStates, "completed"), "is-done")],
      footer: cancelledFeatures ? `취소 ${cancelledFeatures.toLocaleString("ko-KR")}개 포함` : "취소된 Feature 없음",
    }),
    dashboardSummaryCard({
      title: "Work Item", description: "작업 항목", total: data.work_items?.total,
      metrics: [dashboardMetric("대기", itemWait.toLocaleString("ko-KR")), dashboardMetric("실행 중", dashboardCount(itemStates, "in_progress"), "is-active"), dashboardMetric("막힘", dashboardCount(itemStates, "blocked"), "is-blocked"), dashboardMetric("완료", dashboardCount(itemStates, "done"), "is-done")],
      footer: `이번 주 완료 ${Number(data.work_items?.this_week_done || 0).toLocaleString("ko-KR")}개 · 대기 = backlog + ready${cancelledItems ? ` · 취소 ${cancelledItems}개` : ""}`,
    }),
    dashboardSummaryCard({
      title: "Run", description: "실행 기록", total: data.runs?.total,
      metrics: [dashboardMetric("실행 중", dashboardCount(runStates, "running"), "is-active"), dashboardMetric("성공", dashboardCount(runStates, "succeeded"), "is-done"), dashboardMetric("실패", dashboardCount(runStates, "failed"), "is-blocked"), dashboardMetric("중단", dashboardCount(runStates, "interrupted"), "is-paused")],
      footer: `이번 주 성공 완료 ${Number(data.runs?.this_week_succeeded || 0).toLocaleString("ko-KR")}개${cancelledRuns ? ` · 취소 ${cancelledRuns}개` : ""}`,
    }),
  ];
  elements.overviewDashboard.innerHTML = `<section class="dashboard-summary-grid" aria-label="Feature, Work Item, Run 요약">${cards.join("")}</section>
    <section class="dashboard-chart-grid" aria-label="우선순위와 완료 추세">${dashboardCompletionChart(data.work_items_completed_by_week, data.runs_succeeded_by_week)}${dashboardCompletionChart(data.work_items_completed_by_day, data.runs_succeeded_by_day, true)}${dashboardPriorityChart(data.work_item_priorities)}${dashboardFeatureProgress(data.feature_progress)}</section>`;
  elements.visibleCount.textContent = `${Number(data.features?.total || 0)} Features · ${Number(data.work_items?.total || 0)} WI · ${Number(data.runs?.total || 0)} Runs`;
  elements.dockSummary.textContent = `Feature ${Number(data.features?.total || 0)} · WI ${Number(data.work_items?.total || 0)} · Run ${Number(data.runs?.total || 0)}`;
}

async function loadOverview() {
  elements.overviewLoading.classList.remove("hidden");
  elements.overviewError.classList.add("hidden");
  try {
    state.overview = await api("/api/overview/dashboard");
    elements.healthDot.className = "health-dot healthy";
    elements.healthLabel.textContent = "State DB 연결됨";
    renderOverview();
  } catch (error) {
    elements.healthDot.className = "health-dot failed";
    elements.healthLabel.textContent = "State DB 연결 실패";
    elements.overviewError.textContent = `Overview를 불러오지 못했습니다. ${error.message}`;
    elements.overviewError.classList.remove("hidden");
  } finally {
    elements.overviewLoading.classList.add("hidden");
  }
}

function periodStart(value) {
  if (!value) return null;
  const now = new Date();
  if (value === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const days = Number(value);
  return Number.isFinite(days) ? new Date(now.getTime() - days * 86400000).toISOString() : null;
}

function buildRunsStatusFilters() {
  const container = document.querySelector("#runs-status-options");
  container.innerHTML = [["", "All"], ...RUN_STATUS_OPTIONS].map(([value, label]) => `
    <label><input type="radio" name="runs-status" value="${escapeHtml(value)}" ${state.runsStatusFilter === value ? "checked" : ""} /><span>${value ? `<i class="filter-status-dot filter-status-${escapeHtml(value)}"></i>` : ""}${escapeHtml(label)}</span></label>
  `).join("");
  container.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    if (!input.checked) return;
    state.runsStatusFilter = input.value;
    state.runsOffset = 0;
    loadRuns();
  }));
}

function artifactHtml(artifact) {
  const uri = artifact.uri || "";
  const kindLabel = {
    file: "File", commit: "Commit", test_run: "Test", lint_run: "Lint",
    build_run: "Build", screenshot: "Screenshot", report: "Report", other: "Other",
  }[artifact.kind] || artifact.kind;
  const statusLabel = {
    passed: "Passed", failed: "Failed", pending: "Pending", not_applicable: "N/A",
  }[artifact.verification_status] || artifact.verification_status;
  const reference = /^https?:\/\//i.test(uri)
    ? `<a href="${escapeHtml(uri)}" target="_blank" rel="noreferrer noopener">열기</a>`
    : uri ? `<button type="button" data-copy-artifact="${escapeHtml(uri)}">참조 복사</button>` : "";
  return `<li>
    <span class="artifact-status artifact-${escapeHtml(artifact.verification_status)}">${artifact.verification_status === "passed" ? "✓" : artifact.verification_status === "failed" ? "✕" : "•"}</span>
    <div><strong>${escapeHtml(kindLabel)}</strong><span class="artifact-verification artifact-${escapeHtml(artifact.verification_status)}">${escapeHtml(statusLabel)}</span><p>${escapeHtml(artifact.summary)}</p></div>${reference}
  </li>`;
}

function runDetailHtml(detail) {
  const run = detail.run;
  const artifacts = detail.artifacts || [];
  return `<div class="run-expanded-grid">
    <section><span>Intent</span><p>${escapeHtml(run.intent || "실행 목적이 기록되지 않았습니다.")}</p></section>
    <section><span>Result</span><p>${run.status === "running" ? "아직 실행 중입니다." : escapeHtml(run.summary || "실행 결과가 기록되지 않았습니다.")}</p>
      ${run.termination_reason ? `<div class="run-termination"><span class="run-warning-icon">△</span><span><strong>Reason</strong>${escapeHtml(run.termination_reason)}</span></div>` : ""}
    </section>
    <dl class="run-expanded-meta">
      <div><dt>Started</dt><dd>${escapeHtml(formatRunDate(run.started_at))}</dd></div>
      <div><dt>Ended</dt><dd>${escapeHtml(formatRunDate(run.ended_at))}</dd></div>
      <div><dt>Duration</dt><dd>${run.status === "running" ? runProgressHtml() : escapeHtml(durationLabel(run))}</dd></div>
      <div><dt>WI</dt><dd><button type="button" data-open-work-item="${escapeHtml(detail.work_item.id)}"><code>${escapeHtml(detail.work_item.id)}</code> · ${escapeHtml(detail.work_item.title)}</button></dd></div>
    </dl>
    <section class="run-artifacts"><span>Artifacts · ${artifacts.length}</span>
      ${artifacts.length ? `<ul>${artifacts.map(artifactHtml).join("")}</ul>` : '<p class="run-detail-empty">이 Run에 기록된 Artifact가 없습니다.</p>'}
    </section>
  </div>`;
}

function bindRunRows() {
  document.querySelectorAll("[data-run-row]").forEach((row) => {
    const open = () => toggleRun(row.dataset.runRow);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
    });
  });
  document.querySelectorAll("[data-open-work-item]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    switchView("work-items", button.dataset.openWorkItem);
  }));
  document.querySelectorAll("[data-copy-artifact]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(button.dataset.copyArtifact);
    button.textContent = "복사됨";
  }));
}

function renderRuns() {
  elements.runsBody.innerHTML = state.runs.map((run) => {
    const status = runStatusClass(run.status);
    const expanded = state.expandedRunId === run.id;
    const detail = state.runDetails.get(run.id);
    return `<tr class="run-table-row ${expanded ? "is-expanded" : ""}" data-run-row="${escapeHtml(run.id)}" tabindex="0" aria-expanded="${expanded}">
      <td><span class="run-status-pill run-status-${status}"><span class="run-status-dot"></span>${escapeHtml(runStatusLabel(run.status))}</span></td>
      <td><code>${escapeHtml(run.id)}</code></td>
      <td><code>${escapeHtml(run.work_item_id)}</code><strong>${escapeHtml(run.work_item_title)}</strong></td>
      <td><span class="run-intent-cell">${escapeHtml(run.intent)}</span></td>
      <td><time>${escapeHtml(formatRunDate(run.started_at))}</time></td>
      <td>${run.status === "running" ? runProgressHtml() : escapeHtml(durationLabel(run))}</td>
      <td class="run-chevron-cell"><span class="run-chevron ${expanded ? "is-open" : ""}" aria-hidden="true"></span></td>
    </tr>${expanded ? `<tr class="run-expanded-row"><td colspan="7">${detail ? runDetailHtml(detail) : '<div class="run-detail-loading"><span class="spinner"></span> 상세 정보를 불러오는 중입니다.</div>'}</td></tr>` : ""}`;
  }).join("");
  elements.runsEmpty.classList.toggle("hidden", state.runs.length > 0);
  document.querySelector(".runs-table").classList.toggle("hidden", state.runs.length === 0);
  const start = state.runsTotal ? state.runsOffset + 1 : 0;
  const end = Math.min(state.runsOffset + state.runs.length, state.runsTotal);
  elements.runsRange.textContent = `전체 ${state.runsTotal}개 · ${start}-${end}`;
  elements.visibleCount.textContent = `${state.runsTotal} runs`;
  elements.dockSummary.textContent = `전체 Run ${state.runsTotal}개 · 화면 ${state.runs.length}개`;
  document.querySelector("#runs-prev").disabled = state.runsOffset === 0;
  document.querySelector("#runs-next").disabled = state.runsOffset + state.runs.length >= state.runsTotal;
  bindRunRows();
}

async function toggleRun(runId) {
  state.expandedRunId = state.expandedRunId === runId ? null : runId;
  renderRuns();
  if (!state.expandedRunId || state.runDetails.has(runId)) return;
  try {
    state.runDetails.set(runId, await api(`/api/runs/${encodeURIComponent(runId)}`));
  } catch (error) {
    state.runDetails.set(runId, { run: { intent: "", status: "failed", summary: error.message }, work_item: { id: "—", title: "조회 실패" }, artifacts: [] });
  }
  if (state.expandedRunId === runId) renderRuns();
}

async function focusRun(runId) {
  if (!runId || !state.runs.some((run) => run.id === runId)) return;
  state.expandedRunId = runId;
  renderRuns();
  if (!state.runDetails.has(runId)) {
    try {
      state.runDetails.set(runId, await api(`/api/runs/${encodeURIComponent(runId)}`));
    } catch (error) {
      state.runDetails.set(runId, { run: { intent: "", status: "failed", summary: error.message }, work_item: { id: "—", title: "조회 실패" }, artifacts: [] });
    }
  }
  renderRuns();
  requestAnimationFrame(() => document.querySelector(`[data-run-row="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

async function loadRuns() {
  elements.runsLoading.classList.remove("hidden");
  const parameters = new URLSearchParams({ limit: String(state.runsLimit), offset: String(state.runsOffset) });
  if (state.runsStatusFilter) parameters.set("status", state.runsStatusFilter);
  if (state.runsQuery) parameters.set("query", state.runsQuery);
  if (state.runsWorkItemId) parameters.set("work_item_id", state.runsWorkItemId);
  const startedFrom = periodStart(state.runsPeriod);
  if (startedFrom) parameters.set("started_from", startedFrom);
  try {
    const payload = await api(`/api/runs?${parameters}`);
    state.runs = payload.runs;
    state.runsTotal = payload.total;
    state.expandedRunId = null;
    state.runDetails.clear();
    renderRuns();
    const pendingRunId = state.pendingRunId;
    state.pendingRunId = null;
    if (pendingRunId) await focusRun(pendingRunId);
  } catch (error) {
    state.runs = [];
    state.runsTotal = 0;
    renderRuns();
    elements.runsEmpty.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  } finally {
    elements.runsLoading.classList.add("hidden");
  }
}

async function switchView(view, selectedWorkItemId = null, selectedRunId = null) {
  if (state.currentView === "features" && view !== "features") window.featuresPage.closeDetail();
  state.currentView = view;
  document.body.dataset.currentView = view;
  const isFeatures = view === "features";
  const isOverview = view === "overview";
  const isRuns = view === "runs";
  const isMemory = view === "memory-graph";
  const isTimeline = view === "activity-timeline";
  document.querySelector("#activity-timeline-view").classList.toggle("hidden", !isTimeline);
  document.querySelector("#nav-activity-timeline").classList.toggle("active", isTimeline);
  document.querySelector("#nav-activity-timeline").toggleAttribute("aria-current", isTimeline);
  document.querySelector("#memory-graph-view").classList.toggle("hidden", !isMemory);
  document.querySelector("#nav-memory-graph").classList.toggle("active", isMemory);
  document.querySelector("#nav-memory-graph").toggleAttribute("aria-current", isMemory);
  elements.overviewView.classList.toggle("hidden", !isOverview);
  elements.featuresView.classList.toggle("hidden", !isFeatures);
  elements.workItemsView.classList.toggle("hidden", isOverview || isFeatures || isRuns || isMemory || isTimeline);
  elements.runsView.classList.toggle("hidden", !isRuns);
  document.querySelector("#nav-overview").classList.toggle("active", isOverview);
  document.querySelector("#nav-features").classList.toggle("active", isFeatures);
  document.querySelector("#nav-work-items").classList.toggle("active", !isOverview && !isFeatures && !isRuns && !isMemory && !isTimeline);
  document.querySelector("#nav-runs").classList.toggle("active", isRuns);
  document.querySelector("#nav-overview").toggleAttribute("aria-current", isOverview);
  document.querySelector("#nav-features").toggleAttribute("aria-current", isFeatures);
  document.querySelector("#nav-work-items").toggleAttribute("aria-current", !isOverview && !isFeatures && !isRuns && !isMemory && !isTimeline);
  document.querySelector("#nav-runs").toggleAttribute("aria-current", isRuns);
  const title = isTimeline ? "Activity Timeline" : isMemory ? "MemoryGraph" : isOverview ? "Overview" : isFeatures ? "Features" : isRuns ? "Runs" : "Work Items";
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#page-crumb").textContent = title;
  elements.visibleCount.classList.toggle("hidden", isTimeline || isOverview);
  document.querySelector("#refresh-features").classList.toggle("hidden", !isFeatures);
  const createButton = document.querySelector("#open-draft-modal");
  createButton.classList.toggle("hidden", isOverview || isRuns || isMemory || isTimeline);
  createButton.innerHTML = isFeatures ? '<span aria-hidden="true">＋</span> 새 Feature' : '<span aria-hidden="true">＋</span> 새 Draft WI 생성';
  if (isTimeline) elements.dockSummary.textContent = "Activity Timeline · 추후 추가될 기능";
  if (isMemory) await window.memoryGraph.load();
  else if (isOverview) await loadOverview();
  else if (isFeatures) await window.featuresPage.load();
  else if (isRuns) {
    state.runsWorkItemId = selectedWorkItemId;
    state.pendingRunId = selectedRunId;
    if (selectedRunId) {
      state.runsQuery = "";
      state.runsPeriod = "";
      state.runsStatusFilter = "";
      document.querySelector("#runs-query").value = "";
      document.querySelector("#runs-period-options input[value='']").checked = true;
      buildRunsStatusFilters();
    }
    await loadRuns();
  }
  else if (selectedWorkItemId) await loadItems({ selectId: selectedWorkItemId });
  else renderItems();
}

function clearFormErrors() {
  elements.formError.classList.add("hidden");
  elements.formError.textContent = "";
  for (const element of elements.form.elements) element.removeAttribute?.("aria-invalid");
  document.querySelectorAll(".field-error").forEach((node) => { node.textContent = ""; });
}

function openModal() {
  clearFormErrors();
  loadDraftFeatures();
  elements.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.querySelector("#draft-title").focus();
}

function closeModal() {
  closeFeaturePicker(false);
  draftFeatureLoadVersion += 1;
  elements.modal.classList.add("hidden");
  document.body.style.overflow = "";
  document.querySelector("#open-draft-modal").focus();
}

async function loadDraftFeatures() {
  const version = ++draftFeatureLoadVersion;
  draftFeatures = [];
  draftFeatureLoadError = "";
  const hint = document.querySelector("#draft-feature-hint");
  hint.textContent = "Feature 목록을 불러오는 중입니다.";
  renderDraftFeaturePicker();
  try {
    const { features } = await api("/api/features");
    if (version !== draftFeatureLoadVersion) return;
    draftFeatures = features.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    hint.textContent = features.length ? "소속 Feature가 있으면 선택하세요." : "현재 등록된 Feature가 없습니다.";
    const selectedId = document.querySelector("#draft-feature").value;
    if (selectedId && !draftFeatures.some((feature) => feature.id === selectedId)) chooseDraftFeature(null, false);
  } catch (error) {
    if (version !== draftFeatureLoadVersion) return;
    draftFeatureLoadError = error.message;
    hint.textContent = "Feature 목록을 불러오지 못했습니다. 연결 없이 Draft를 만들 수 있습니다.";
  }
  renderDraftFeaturePicker();
}

function renderDraftFeaturePicker() {
  const list = document.querySelector("#feature-picker-list");
  if (draftFeatureLoadError) {
    list.innerHTML = `<p class="feature-picker-message" role="alert">${escapeHtml(draftFeatureLoadError)}</p>`;
    return;
  }
  if (!draftFeatures.length) {
    const message = document.querySelector("#draft-feature-hint").textContent.includes("불러오는 중")
      ? "Feature를 불러오는 중입니다." : "등록된 Feature가 없습니다.";
    list.innerHTML = `<p class="feature-picker-message">${message}</p>`;
    return;
  }
  const selectedId = document.querySelector("#draft-feature").value;
  list.innerHTML = draftFeatures.map((feature) => {
    const progress = feature.progress || {};
    const eligible = Math.max(0, Number(progress.total_work_items || 0) - Number(progress.cancelled_count || 0));
    const done = Number(progress.done_count || 0);
    const percent = eligible ? Math.round(done / eligible * 100) : 0;
    const segments = ["done", "in_progress", "ready", "backlog", "blocked"].map((status) => {
      const count = Number(progress[`${status}_count`] || 0);
      return count && eligible ? `<span class="feature-segment is-${status}" style="width:${count / eligible * 100}%"></span>` : "";
    }).join("");
    return `<button class="feature-card feature-picker-card${feature.id === selectedId ? " is-selected" : ""}" type="button" data-picker-feature-id="${escapeHtml(feature.id)}" aria-pressed="${feature.id === selectedId}">
      <span class="feature-card-top"><span><strong>${escapeHtml(feature.title)}</strong><small>${escapeHtml(feature.id)}</small></span></span>
      <span class="feature-picker-goal">${escapeHtml(feature.goal)}</span>
      <span class="feature-card-summary"><span>${eligible ? `<b>${done} / ${eligible}</b> WI 완료` : "WI 없음"}</span><span>${eligible ? `${percent}%` : "진행률 계산 전"}</span></span>
      <span class="feature-progress-bar${eligible ? "" : " is-empty"}">${segments}</span>
      <span class="feature-card-bottom"><span class="feature-state is-${escapeHtml(feature.status)}">${escapeHtml(feature.status)}</span><span>${escapeHtml(feature.priority)} Priority</span></span>
    </button>`;
  }).join("");
}

function openFeaturePicker() {
  const picker = document.querySelector("#feature-picker-modal");
  renderDraftFeaturePicker();
  elements.modal.inert = true;
  elements.modal.setAttribute("aria-hidden", "true");
  picker.classList.remove("hidden");
  picker.querySelector("[data-picker-feature-id], #clear-feature-picker, #close-feature-picker").focus();
}

function closeFeaturePicker(restoreFocus = true) {
  document.querySelector("#feature-picker-modal").classList.add("hidden");
  elements.modal.inert = false;
  elements.modal.removeAttribute("aria-hidden");
  if (restoreFocus && !elements.modal.classList.contains("hidden")) {
    document.querySelector("#open-feature-picker").focus();
  }
}

function chooseDraftFeature(feature, restoreFocus = true) {
  document.querySelector("#draft-feature").value = feature?.id || "";
  document.querySelector("#draft-feature-name").value = feature?.title || "연결하지 않음";
  renderDraftFeaturePicker();
  if (restoreFocus) closeFeaturePicker();
}

function openEditModal() {
  const context = state.selectedContext;
  if (!context?.capabilities?.can_edit) return;
  const item = context.work_item;
  const editable = new Set(context.capabilities.editable_fields || []);
  for (const field of elements.editForm.querySelectorAll("[data-edit-field]")) {
    field.classList.toggle("hidden", !editable.has(field.dataset.editField));
  }
  for (const name of ["title", "kind", "goal", "description", "priority", "next_action"]) {
    const input = elements.editForm.elements.namedItem(name);
    if (input) input.value = item[name] ?? "";
  }
  elements.editFormError.classList.add("hidden");
  elements.editModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  elements.editForm.elements.namedItem("title")?.focus();
}

function closeEditModal() {
  elements.editModal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function submitEdit(event) {
  event.preventDefault();
  const context = state.selectedContext;
  if (!context) return;
  const editable = new Set(context.capabilities.editable_fields || []);
  const data = new FormData(elements.editForm);
  const payload = {};
  for (const name of editable) payload[name] = data.get(name) || null;
  elements.editFormError.classList.add("hidden");
  try {
    const updated = await api(`/api/work-items/${encodeURIComponent(context.work_item.id)}`, {
      method: "PATCH", body: JSON.stringify(payload),
    });
    closeEditModal();
    await loadItems({ selectId: updated.work_item.id });
  } catch (error) {
    elements.editFormError.textContent = error.message;
    elements.editFormError.classList.remove("hidden");
    if (error.status === 409) await loadItems({ selectId: context.work_item.id });
  }
}

function openDeleteModal() {
  const context = state.selectedContext;
  if (!context?.capabilities?.can_delete) return;
  document.querySelector("#delete-work-item-id").textContent = context.work_item.id;
  elements.deleteConfirmation.value = "";
  elements.confirmDelete.disabled = true;
  document.querySelector("#delete-error").classList.add("hidden");
  elements.deleteModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  elements.deleteConfirmation.focus();
}

function closeDeleteModal() {
  elements.deleteModal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function deleteSelectedItem() {
  const item = state.selectedContext?.work_item;
  if (!item || elements.deleteConfirmation.value !== item.id) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    state.selectedId = null;
    state.selectedContext = null;
    closeDeleteModal();
    await loadItems();
  } catch (error) {
    const target = document.querySelector("#delete-error");
    target.textContent = error.message;
    target.classList.remove("hidden");
  }
}

function memoFormValues() {
  const data = new FormData(elements.memoForm);
  return {
    title: String(data.get("title") || ""),
    content: String(data.get("content") || ""),
    kind: String(data.get("kind") || "general"),
    author: String(data.get("author") || ""),
    isModelVisible: data.has("is_model_visible"),
  };
}

function applyMemoFormValues(values) {
  elements.memoForm.elements.namedItem("title").value = values.title || "";
  elements.memoForm.elements.namedItem("content").value = values.content || "";
  elements.memoForm.elements.namedItem("kind").value = values.kind || "general";
  elements.memoForm.elements.namedItem("author").value = values.author || "";
  elements.memoForm.elements.namedItem("is_model_visible").checked = Boolean(values.isModelVisible);
}

function memoFormSignature(values = memoFormValues()) {
  return JSON.stringify(values);
}

function memoDraftStorageKey(workItemId, memoId) {
  return `harness:memo-draft:v1:${encodeURIComponent(workItemId)}:${encodeURIComponent(memoId || "new")}`;
}

function memoHasUnsavedChanges() {
  return state.memoBaseline !== null && memoFormSignature() !== state.memoBaseline;
}

function showMemoDraftStatus(message, restored = false) {
  elements.memoDraftStatus.textContent = message;
  elements.memoDraftStatus.classList.toggle("is-restored", restored);
  elements.memoDraftStatus.classList.remove("hidden");
}

function hideMemoDraftStatus() {
  elements.memoDraftStatus.textContent = "";
  elements.memoDraftStatus.classList.remove("is-restored");
  elements.memoDraftStatus.classList.add("hidden");
}

function readMemoDraft() {
  if (!state.memoDraftKey) return null;
  try {
    const value = window.localStorage.getItem(state.memoDraftKey);
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function removeMemoDraft() {
  if (state.memoDraftTimer) window.clearTimeout(state.memoDraftTimer);
  state.memoDraftTimer = null;
  if (!state.memoDraftKey) return;
  try { window.localStorage.removeItem(state.memoDraftKey); } catch (_) { /* unavailable storage */ }
}

function persistMemoDraft() {
  if (state.memoDraftTimer) window.clearTimeout(state.memoDraftTimer);
  state.memoDraftTimer = null;
  if (!state.memoDraftKey) return false;
  if (!memoHasUnsavedChanges()) {
    removeMemoDraft();
    hideMemoDraftStatus();
    return true;
  }
  const payload = {
    version: 1,
    baseUpdatedAt: state.memoBaselineUpdatedAt,
    values: memoFormValues(),
    savedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(state.memoDraftKey, JSON.stringify(payload));
    showMemoDraftStatus("브라우저에 임시 저장됨");
    return true;
  } catch (_) {
    showMemoDraftStatus("임시 저장 불가", true);
    return false;
  }
}

function scheduleMemoDraftSave() {
  if (elements.memoModal.classList.contains("hidden")) return;
  if (state.memoDraftTimer) window.clearTimeout(state.memoDraftTimer);
  state.memoDraftTimer = window.setTimeout(persistMemoDraft, 400);
}

function openMemoModal(memoId = null) {
  const memo = (state.selectedContext?.memos || []).find((entry) => entry.id === memoId);
  if (!state.selectedContext || (memoId && !memo)) return;
  state.editingMemoId = memoId;
  state.memoBaselineUpdatedAt = memo?.updated_at || null;
  state.memoDraftKey = memoDraftStorageKey(state.selectedContext.work_item.id, memoId);
  elements.memoForm.reset();
  elements.memoForm.elements.namedItem("kind").value = "general";
  if (memo) {
    document.querySelector("#memo-modal-title").textContent = "메모 수정";
    elements.memoForm.elements.namedItem("title").value = memo.title;
    elements.memoForm.elements.namedItem("content").value = memo.content;
    elements.memoForm.elements.namedItem("author").value = memo.author || "";
    elements.memoForm.elements.namedItem("is_model_visible").checked = Boolean(memo.is_model_visible);
    const kind = elements.memoForm.querySelector(`input[name="kind"][value="${CSS.escape(memo.kind)}"]`);
    if (kind) kind.checked = true;
  } else {
    document.querySelector("#memo-modal-title").textContent = "새 메모";
  }
  state.memoBaseline = memoFormSignature();
  hideMemoDraftStatus();
  const draft = readMemoDraft();
  if (draft?.version === 1 && draft.values) {
    if (draft.baseUpdatedAt === state.memoBaselineUpdatedAt) {
      applyMemoFormValues(draft.values);
      if (memoHasUnsavedChanges()) showMemoDraftStatus("임시 저장본 복원됨", true);
      else removeMemoDraft();
    } else {
      removeMemoDraft();
      showMemoDraftStatus("오래된 임시 저장본 정리됨", true);
    }
  }
  elements.memoFormError.classList.add("hidden");
  elements.memoFormError.textContent = "";
  updateMemoPreview();
  elements.memoModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  elements.memoForm.elements.namedItem("title")?.focus();
}

function closeMemoModal() {
  if (state.memoDraftTimer) window.clearTimeout(state.memoDraftTimer);
  state.memoDraftTimer = null;
  elements.memoCloseModal.classList.add("hidden");
  elements.memoModal.classList.add("hidden");
  document.body.style.overflow = "";
  state.editingMemoId = null;
  state.memoBaseline = null;
  state.memoBaselineUpdatedAt = null;
  state.memoDraftKey = null;
  state.memoLastFocus = null;
  hideMemoDraftStatus();
}

function requestCloseMemoModal() {
  if (elements.submitMemo.disabled || !elements.memoCloseModal.classList.contains("hidden")) return;
  if (!memoHasUnsavedChanges()) {
    removeMemoDraft();
    closeMemoModal();
    return;
  }
  persistMemoDraft();
  state.memoLastFocus = document.activeElement;
  elements.memoCloseModal.classList.remove("hidden");
  document.querySelector("#continue-memo-editing").focus();
}

function continueMemoEditing() {
  elements.memoCloseModal.classList.add("hidden");
  (state.memoLastFocus instanceof HTMLElement ? state.memoLastFocus : elements.memoForm.elements.namedItem("title"))?.focus();
  state.memoLastFocus = null;
}

function keepMemoDraftAndClose() {
  if (!persistMemoDraft()) {
    window.alert("브라우저에 임시 저장하지 못했습니다. 변경사항을 버리거나 계속 작성해 주세요.");
    return;
  }
  closeMemoModal();
}

function discardMemoChangesAndClose() {
  removeMemoDraft();
  closeMemoModal();
}

async function submitMemo(event) {
  event.preventDefault();
  const item = state.selectedContext?.work_item;
  if (!item) return;
  const data = new FormData(elements.memoForm);
  const payload = {
    title: data.get("title"), content: data.get("content"), kind: data.get("kind"),
    author: data.get("author") || null,
    is_model_visible: data.has("is_model_visible"),
  };
  elements.submitMemo.disabled = true;
  elements.submitMemo.querySelector(".memo-submit-label").textContent = "저장 중";
  elements.submitMemo.querySelector(".button-spinner").classList.remove("hidden");
  try {
    const base = `/api/work-items/${encodeURIComponent(item.id)}/memos`;
    await api(state.editingMemoId ? `${base}/${encodeURIComponent(state.editingMemoId)}` : base, {
      method: state.editingMemoId ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
    removeMemoDraft();
    closeMemoModal();
    await refreshSelectedDetail();
  } catch (error) {
    elements.memoFormError.textContent = error.message;
    elements.memoFormError.classList.remove("hidden");
  } finally {
    elements.submitMemo.disabled = false;
    elements.submitMemo.querySelector(".memo-submit-label").textContent = "메모 저장";
    elements.submitMemo.querySelector(".button-spinner").classList.add("hidden");
  }
}

function showFormError(error) {
  clearFormErrors();
  const details = error.payload?.error;
  const fields = details?.fields || {};
  for (const [name, message] of Object.entries(fields)) {
    const input = elements.form.elements.namedItem(name);
    input?.setAttribute("aria-invalid", "true");
    const target = document.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (target) target.textContent = message;
  }
  if (!Object.keys(fields).length || error.status !== 422) {
    elements.formError.textContent = error.status === 503 ? "상태 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." : error.message;
    elements.formError.classList.remove("hidden");
  }
}

async function submitDraft(event) {
  event.preventDefault();
  clearFormErrors();
  const data = new FormData(elements.form);
  const payload = {
    title: data.get("title"),
    kind: data.get("kind"),
    goal: data.get("goal"),
    description: data.get("description") || null,
    feature_id: data.get("feature_id") || null,
  };
  elements.submitButton.disabled = true;
  elements.submitButton.querySelector(".submit-label").textContent = "저장 중";
  elements.submitButton.querySelector(".button-spinner").classList.remove("hidden");
  try {
    const response = await api("/api/draft-work-items", { method: "POST", body: JSON.stringify(payload) });
    elements.form.reset();
    closeModal();
    await loadItems({ selectId: response.work_item.id });
  } catch (error) {
    showFormError(error);
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.querySelector(".submit-label").textContent = "Draft 생성";
    elements.submitButton.querySelector(".button-spinner").classList.add("hidden");
  }
}

document.querySelector("#open-draft-modal").addEventListener("click", () => {
  if (state.currentView === "features") window.featuresPage.openCreate();
  else openModal();
});
document.querySelector("#close-draft-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-draft").addEventListener("click", closeModal);
document.querySelector("#open-feature-picker").addEventListener("click", openFeaturePicker);
document.querySelector("#close-feature-picker").addEventListener("click", () => closeFeaturePicker());
document.querySelector("#clear-feature-picker").addEventListener("click", () => chooseDraftFeature(null));
document.querySelector("#feature-picker-list").addEventListener("click", (event) => {
  const card = event.target.closest("[data-picker-feature-id]");
  if (!card) return;
  const feature = draftFeatures.find((item) => item.id === card.dataset.pickerFeatureId);
  if (feature) chooseDraftFeature(feature);
});
document.querySelector("#refresh-items").addEventListener("click", () => loadItems());
elements.nextActionsTrigger.addEventListener("click", () => setNextActionsOpen(!state.nextActionsOpen));
document.querySelector("#next-actions-close").addEventListener("click", () => setNextActionsOpen(false));
document.querySelector("#next-actions-refresh").addEventListener("click", loadNextActions);
elements.nextActionsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-next-action-id]");
  if (!button) return;
  const workItemId = button.dataset.nextActionId;
  setNextActionsOpen(false);
  switchView("work-items", workItemId);
});
document.querySelector("#brand-home").addEventListener("click", () => switchView("overview"));
document.querySelector("#nav-overview").addEventListener("click", (event) => { event.preventDefault(); switchView("overview"); });
document.querySelector("#nav-features").addEventListener("click", (event) => { event.preventDefault(); switchView("features"); });
document.querySelector("#nav-work-items").addEventListener("click", (event) => { event.preventDefault(); switchView("work-items"); });
document.addEventListener("feature:open-work-item", (event) => {
  state.statusFilters.clear();
  state.kindFilters.clear();
  switchView("work-items", event.detail.workItemId);
});
document.querySelector("#nav-runs").addEventListener("click", (event) => { event.preventDefault(); switchView("runs"); });
document.querySelector("#nav-activity-timeline").addEventListener("click", (event) => { event.preventDefault(); switchView("activity-timeline"); });
document.querySelector("#refresh-overview").addEventListener("click", () => loadOverview());
document.querySelector("#refresh-runs").addEventListener("click", () => loadRuns());
document.querySelector("#runs-prev").addEventListener("click", () => { state.runsOffset = Math.max(0, state.runsOffset - state.runsLimit); loadRuns(); });
document.querySelector("#runs-next").addEventListener("click", () => { state.runsOffset += state.runsLimit; loadRuns(); });
document.querySelectorAll('input[name="runs-period"]').forEach((input) => input.addEventListener("change", () => {
  if (!input.checked) return;
  state.runsPeriod = input.value;
  state.runsOffset = 0;
  loadRuns();
}));
let runsSearchTimer = null;
document.querySelector("#runs-query").addEventListener("input", (event) => {
  window.clearTimeout(runsSearchTimer);
  runsSearchTimer = window.setTimeout(() => { state.runsQuery = event.target.value.trim(); state.runsOffset = 0; loadRuns(); }, 250);
});
document.querySelector("#reset-runs-filters").addEventListener("click", () => {
  state.runsQuery = ""; state.runsPeriod = ""; state.runsOffset = 0; state.runsStatusFilter = "";
  document.querySelector("#runs-query").value = "";
  document.querySelector('input[name="runs-period"][value=""]').checked = true;
  buildRunsStatusFilters();
  loadRuns();
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  state.statusFilters.clear();
  state.kindFilters.clear();
  buildFilters("#status-filters", "status", STATUS_OPTIONS);
  buildFilters("#kind-filters", "kind", KIND_OPTIONS);
  renderItems();
});
elements.sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!state.sidebarCollapsed));
elements.fontScaleDecrease.addEventListener("click", () => changeFontScale(-1));
elements.fontScaleIncrease.addEventListener("click", () => changeFontScale(1));
elements.fontScaleValue.addEventListener("animationend", () => {
  elements.fontScaleValue.classList.remove("is-increasing", "is-decreasing");
});
elements.form.addEventListener("submit", submitDraft);
elements.editForm.addEventListener("submit", submitEdit);
document.querySelector("#close-edit-modal").addEventListener("click", closeEditModal);
document.querySelector("#cancel-edit").addEventListener("click", closeEditModal);
document.querySelector("#cancel-delete").addEventListener("click", closeDeleteModal);
document.querySelector("#close-memo-modal").addEventListener("click", requestCloseMemoModal);
document.querySelector("#cancel-memo").addEventListener("click", requestCloseMemoModal);
document.querySelector("#continue-memo-editing").addEventListener("click", continueMemoEditing);
document.querySelector("#discard-memo-changes").addEventListener("click", discardMemoChangesAndClose);
document.querySelector("#keep-memo-draft").addEventListener("click", keepMemoDraftAndClose);
elements.memoForm.addEventListener("submit", submitMemo);
elements.memoForm.addEventListener("input", scheduleMemoDraftSave);
elements.memoForm.addEventListener("change", scheduleMemoDraftSave);
elements.memoForm.elements.namedItem("content").addEventListener("input", updateMemoPreview);
elements.memoForm.elements.namedItem("content").addEventListener("keydown", (event) => {
  const textarea = event.currentTarget;
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (command && !event.altKey && key === "e") {
    event.preventDefault();
    toggleMemoCodeFormatting(textarea);
  } else if (command && !event.altKey && key === "b") {
    event.preventDefault();
    toggleMemoInlineFormatting(textarea, "**");
  } else if (command && !event.altKey && key === "i") {
    event.preventDefault();
    toggleMemoInlineFormatting(textarea, "*");
  } else if (command && key === "enter") {
    event.preventDefault();
    elements.memoForm.requestSubmit();
  } else if (!command && !event.altKey && event.key === "Tab") {
    event.preventDefault();
    indentMemoSelection(textarea, event.shiftKey);
  }
});
elements.deleteConfirmation.addEventListener("input", () => {
  elements.confirmDelete.disabled = elements.deleteConfirmation.value !== state.selectedContext?.work_item?.id;
});
elements.confirmDelete.addEventListener("click", deleteSelectedItem);
elements.modal.addEventListener("click", (event) => { if (event.target === elements.modal) closeModal(); });
document.querySelector("#feature-picker-modal").addEventListener("click", (event) => {
  if (event.target.id === "feature-picker-modal") closeFeaturePicker();
});
elements.editModal.addEventListener("click", (event) => { if (event.target === elements.editModal) closeEditModal(); });
elements.deleteModal.addEventListener("click", (event) => { if (event.target === elements.deleteModal) closeDeleteModal(); });
elements.memoModal.addEventListener("click", (event) => { if (event.target === elements.memoModal) requestCloseMemoModal(); });
elements.memoCloseModal.addEventListener("click", (event) => { if (event.target === elements.memoCloseModal) continueMemoEditing(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.memoCloseModal.classList.contains("hidden")) continueMemoEditing();
  else if (!document.querySelector("#feature-picker-modal").classList.contains("hidden")) closeFeaturePicker();
  else if (!elements.deleteModal.classList.contains("hidden")) closeDeleteModal();
  else if (!elements.editModal.classList.contains("hidden")) closeEditModal();
  else if (!elements.modal.classList.contains("hidden")) closeModal();
  else if (!elements.memoModal.classList.contains("hidden")) requestCloseMemoModal();
  else if (state.nextActionsOpen) setNextActionsOpen(false);
});

setSidebarCollapsed(readSidebarPreference(), false);
setFontScale(readFontScalePreference(), false);
buildRunsStatusFilters();
switchView("overview");
loadItems();
