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
  currentView: "work-items",
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
  overviewQuery: "",
  overviewScope: "all",
  overviewStatus: "",
  overviewSelectedId: null,
  overviewScale: 1,
  overviewOffset: { x: 0, y: 0 },
  overviewSpread: false,
  overviewDragging: null,
  overviewCanvas: { width: 1400, height: 760 },
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
  runsView: document.querySelector("#runs-view"),
  overviewView: document.querySelector("#overview-view"),
  overviewGraph: document.querySelector("#overview-graph"),
  overviewScene: document.querySelector("#overview-graph-scene"),
  overviewSelection: document.querySelector("#overview-selection"),
  overviewLoading: document.querySelector("#overview-loading"),
  overviewEngineSummary: document.querySelector("#overview-engine-summary"),
  runsBody: document.querySelector("#runs-table-body"),
  runsLoading: document.querySelector("#runs-loading"),
  runsEmpty: document.querySelector("#runs-empty"),
  runsRange: document.querySelector("#runs-range"),
};

function statusOf(item) {
  return item.is_draft ? "draft" : item.status;
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
  elements.visibleCount.textContent = `${items.length} visible`;
  elements.dockSummary.textContent = `전체 ${state.items.length}개 · 화면 ${items.length}개`;
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

function overviewShortTitle(value, maximum = 10) {
  const characters = Array.from(String(value || "제목 없음").trim());
  if (characters.length <= maximum) return characters.join("");
  return `${characters.slice(0, maximum - 1).join("")}…`;
}

function overviewFeatureTitleLines(value) {
  const characters = Array.from(overviewShortTitle(value, 10));
  return [characters.slice(0, 5).join(""), characters.slice(5, 10).join("")].filter(Boolean);
}

function overviewNodeStatusClass(status) {
  const normalized = String(status || "unknown").replace(/[^a-z0-9_-]/gi, "-");
  return `overview-node-status-${normalized}`;
}

function overviewNodes(payload = state.overview) {
  if (!payload) return [];
  const workItemCounts = new Map();
  const runCounts = new Map();
  for (const item of payload.work_items) {
    if (item.feature_id) workItemCounts.set(item.feature_id, (workItemCounts.get(item.feature_id) || 0) + 1);
  }
  for (const run of payload.runs) {
    if (run.work_item_id) runCounts.set(run.work_item_id, (runCounts.get(run.work_item_id) || 0) + 1);
  }
  return [
    ...payload.features.map((feature) => ({ ...feature, type: "feature", childCount: workItemCounts.get(feature.id) || 0 })),
    ...payload.work_items.map((item) => ({ ...item, type: "work_item", childCount: runCounts.get(item.id) || 0 })),
    ...payload.runs.map((run) => ({ ...run, type: "run", title: run.intent || run.id, childCount: 0 })),
  ];
}

function filteredOverviewNodes() {
  const query = state.overviewQuery.toLocaleLowerCase();
  return overviewNodes().filter((node) => {
    if (state.overviewScope !== "all" && node.type !== state.overviewScope) return false;
    if (state.overviewStatus && node.status !== state.overviewStatus) return false;
    if (!query) return true;
    return [node.id, node.title, node.intent, node.feature_title, node.work_item_title]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
  });
}

function overviewRunRingRadius(runCount, spread) {
  const runDiameter = 16;
  const minimumGap = 18;
  const circumferenceRadius = (Math.max(runCount, 1) * (runDiameter + minimumGap)) / (Math.PI * 2);
  return Math.max(128, circumferenceRadius) * spread;
}

function overviewWorkItemClusterRadius(runCount, spread) {
  if (!runCount) return 82 * spread;
  return overviewRunRingRadius(runCount, spread) + 24 * spread;
}

function packOverviewCircles(circles, reservedRadius = 0, gap = 30) {
  const positions = new Map();
  const placed = reservedRadius > 0 ? [{ id: null, x: 0, y: 0, radius: reservedRadius }] : [];
  const ordered = [...circles].sort((left, right) => right.radius - left.radius || left.id.localeCompare(right.id));
  const directions = 40;

  for (const circle of ordered) {
    if (!placed.length) {
      positions.set(circle.id, { x: 0, y: 0 });
      placed.push({ ...circle, x: 0, y: 0 });
      continue;
    }
    let accepted = null;
    for (let ring = 0; ring < 80 && !accepted; ring += 1) {
      const distance = ring * 28 + (reservedRadius ? reservedRadius + circle.radius + gap : 0);
      for (let step = 0; step < directions; step += 1) {
        const angle = (Math.PI * 2 * step) / directions + ring * .31;
        const candidate = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
        const collides = placed.some((other) => {
          const minimumDistance = circle.radius + other.radius + gap;
          return Math.hypot(candidate.x - other.x, candidate.y - other.y) < minimumDistance;
        });
        if (!collides) { accepted = candidate; break; }
      }
    }
    const position = accepted || { x: placed.length * (circle.radius * 2 + gap), y: 0 };
    positions.set(circle.id, position);
    placed.push({ ...circle, ...position });
  }

  const radius = placed.reduce((maximum, circle) => {
    if (circle.id === null) return Math.max(maximum, circle.radius);
    return Math.max(maximum, Math.hypot(circle.x, circle.y) + circle.radius);
  }, reservedRadius);
  return { positions, radius };
}

function overviewLayout(nodes) {
  const positions = new Map();
  const features = nodes.filter((node) => node.type === "feature");
  const workItems = nodes.filter((node) => node.type === "work_item");
  const runs = nodes.filter((node) => node.type === "run");
  const spread = state.overviewSpread ? 1.3 : 1;
  const visibleWorkItemIds = new Set(workItems.map((item) => item.id));
  const runGroups = new Map();
  for (const run of runs) {
    if (!visibleWorkItemIds.has(run.work_item_id)) continue;
    const group = runGroups.get(run.work_item_id) || [];
    group.push(run);
    runGroups.set(run.work_item_id, group);
  }

  const visibleFeatureIds = new Set(features.map((feature) => feature.id));
  const workItemGroups = new Map(features.map((feature) => [feature.id, []]));
  workItemGroups.set("orphan", []);
  for (const item of workItems) {
    const parentId = visibleFeatureIds.has(item.feature_id) ? item.feature_id : "orphan";
    workItemGroups.get(parentId).push(item);
  }

  const graphGroups = [];
  for (const feature of features) {
    const children = workItemGroups.get(feature.id);
    const circles = children.map((item) => ({
      id: item.id,
      radius: overviewWorkItemClusterRadius((runGroups.get(item.id) || []).length, spread),
    }));
    const local = packOverviewCircles(circles, 92 * spread, 34 * spread);
    graphGroups.push({ id: `group:${feature.id}`, feature, children, local, radius: local.radius + 34 * spread });
  }
  const orphanChildren = workItemGroups.get("orphan");
  if (orphanChildren.length) {
    const circles = orphanChildren.map((item) => ({
      id: item.id,
      radius: overviewWorkItemClusterRadius((runGroups.get(item.id) || []).length, spread),
    }));
    const local = packOverviewCircles(circles, 0, 42 * spread);
    graphGroups.push({ id: "group:orphan", feature: null, children: orphanChildren, local, radius: local.radius + 34 * spread });
  }

  const attachedRunIds = new Set([...runGroups.values()].flat().map((run) => run.id));
  const standaloneRuns = runs.filter((run) => !attachedRunIds.has(run.id));
  if (standaloneRuns.length) {
    const local = packOverviewCircles(standaloneRuns.map((run) => ({ id: run.id, radius: 32 * spread })), 0, 18 * spread);
    graphGroups.push({ id: "group:runs", feature: null, children: [], standaloneRuns, local, radius: local.radius + 24 * spread });
  }

  const packedGroups = packOverviewCircles(
    graphGroups.map((group) => ({ id: group.id, radius: group.radius })),
    0,
    55 * spread,
  );
  for (const group of graphGroups) {
    const groupPosition = packedGroups.positions.get(group.id) || { x: 0, y: 0 };
    if (group.feature) positions.set(group.feature.id, groupPosition);
    for (const item of group.children) {
      const localPosition = group.local.positions.get(item.id) || { x: 0, y: 0 };
      positions.set(item.id, { x: groupPosition.x + localPosition.x, y: groupPosition.y + localPosition.y });
    }
    for (const run of group.standaloneRuns || []) {
      const localPosition = group.local.positions.get(run.id) || { x: 0, y: 0 };
      positions.set(run.id, { x: groupPosition.x + localPosition.x, y: groupPosition.y + localPosition.y });
    }
  }

  for (const [workItemId, group] of runGroups) {
    const parent = positions.get(workItemId);
    if (!parent) continue;
    const radius = overviewRunRingRadius(group.length, spread);
    group.forEach((run, index) => {
      const angle = (Math.PI * 2 * index) / group.length - Math.PI / 2;
      positions.set(run.id, { x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius });
    });
  }

  for (const node of nodes) {
    if (!positions.has(node.id)) positions.set(node.id, { x: 0, y: 0 });
  }
  const nodeRadius = (node) => node.type === "feature" ? 82 : node.type === "work_item" ? 76 : 16;
  const bounds = nodes.reduce((result, node) => {
    const position = positions.get(node.id);
    const radius = nodeRadius(node) * spread;
    return {
      minX: Math.min(result.minX, position.x - radius), maxX: Math.max(result.maxX, position.x + radius),
      minY: Math.min(result.minY, position.y - radius), maxY: Math.max(result.maxY, position.y + radius),
    };
  }, { minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const width = Math.max(1400, contentWidth + 180);
  const height = Math.max(760, contentHeight + 180);
  const offsetX = (width - contentWidth) / 2 - bounds.minX;
  const offsetY = (height - contentHeight) / 2 - bounds.minY;
  for (const [id, position] of positions) positions.set(id, { x: position.x + offsetX, y: position.y + offsetY });
  return { positions, width, height };
}

function overviewFeatureNodeHtml(node, position) {
  const lines = overviewFeatureTitleLines(node.title);
  return `<g class="overview-node overview-node-feature ${overviewNodeStatusClass(node.status)}" data-overview-node="${escapeHtml(node.id)}" transform="translate(${position.x} ${position.y})" tabindex="0" role="button" aria-label="${escapeHtml(node.id)} ${escapeHtml(node.title)}">
    <title>${escapeHtml(node.title)}</title><rect x="-72" y="-55" width="144" height="110" rx="17"></rect>
    <text class="overview-node-id" text-anchor="middle" y="-29">${escapeHtml(node.id)}</text>
    ${lines.map((line, index) => `<text class="overview-node-title" text-anchor="middle" y="${lines.length === 1 ? 2 : -2 + index * 22}">${escapeHtml(line)}</text>`).join("")}
    <text class="overview-node-count" text-anchor="middle" y="39">${node.childCount} WIs</text>
  </g>`;
}

function overviewWorkItemNodeHtml(node, position) {
  return `<g class="overview-node overview-node-work-item ${overviewNodeStatusClass(node.status)}" data-overview-node="${escapeHtml(node.id)}" transform="translate(${position.x} ${position.y})" tabindex="0" role="button" aria-label="${escapeHtml(node.id)} ${escapeHtml(node.title)}">
    <title>${escapeHtml(node.title)}</title><rect x="-66" y="-39" width="132" height="78" rx="13"></rect>
    <text class="overview-node-id" text-anchor="middle" y="-18">${escapeHtml(node.id)}</text>
    <text class="overview-node-title" text-anchor="middle" y="5">${escapeHtml(overviewShortTitle(node.title, 10))}</text>
    <text class="overview-node-count" text-anchor="middle" y="25">${node.childCount} Runs</text>
  </g>`;
}

function overviewRunNodeHtml(node, position) {
  const status = runStatusLabel(node.status);
  return `<g class="overview-node overview-node-run ${overviewNodeStatusClass(node.status)}" data-overview-node="${escapeHtml(node.id)}" transform="translate(${position.x} ${position.y})" tabindex="0" role="button" aria-label="${escapeHtml(node.id)} ${escapeHtml(status)}">
    <title>${escapeHtml(node.intent || node.id)}</title><circle r="8"></circle>
  </g>`;
}

function overviewSelectionHtml(node) {
  if (!node) return "";
  const typeLabel = { feature: "Feature", work_item: "WorkItem", run: "Run" }[node.type];
  const parent = node.type === "work_item" ? node.feature_title : node.type === "run" ? node.work_item_title : null;
  const action = node.type === "work_item"
    ? `<button type="button" data-overview-open-work-item="${escapeHtml(node.id)}">WorkItem 상세 보기 →</button>`
    : node.type === "run"
      ? `<button type="button" data-overview-open-run="${escapeHtml(node.id)}" data-overview-run-work-item="${escapeHtml(node.work_item_id || "")}">Run 상세 보기 →</button>` : "";
  return `<div class="overview-selection-heading"><span>${escapeHtml(typeLabel)}</span><button type="button" data-overview-close aria-label="상세 닫기">×</button></div>
    <code>${escapeHtml(node.id)}</code><h3>${escapeHtml(node.title)}</h3>
    <dl><div><dt>Status</dt><dd>${escapeHtml(node.status)}</dd></div>${parent ? `<div><dt>Parent</dt><dd>${escapeHtml(parent)}</dd></div>` : ""}<div><dt>Connected</dt><dd>${node.childCount || 0}</dd></div></dl>${action}`;
}

function applyOverviewTransform() {
  if (!elements.overviewScene) return;
  const { x, y } = state.overviewOffset;
  elements.overviewScene.setAttribute("transform", `translate(${x} ${y}) scale(${state.overviewScale})`);
}

function bindOverviewNodes(nodes) {
  document.querySelectorAll("[data-overview-node]").forEach((element) => {
    const select = () => { state.overviewSelectedId = element.dataset.overviewNode; renderOverview(); };
    const connectedEdge = () => [...document.querySelectorAll("[data-overview-edge-target]")]
      .find((edge) => edge.dataset.overviewEdgeTarget === element.dataset.overviewNode);
    element.addEventListener("click", (event) => { event.stopPropagation(); select(); });
    element.addEventListener("pointerenter", () => connectedEdge()?.classList.add("is-hovered"));
    element.addEventListener("pointerleave", () => connectedEdge()?.classList.remove("is-hovered"));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
  });
  document.querySelector("[data-overview-close]")?.addEventListener("click", () => { state.overviewSelectedId = null; renderOverview(); });
  document.querySelector("[data-overview-open-work-item]")?.addEventListener("click", (event) => {
    switchView("work-items", event.currentTarget.dataset.overviewOpenWorkItem);
  });
  document.querySelector("[data-overview-open-run]")?.addEventListener("click", (event) => {
    switchView("runs", event.currentTarget.dataset.overviewRunWorkItem || null, event.currentTarget.dataset.overviewOpenRun);
  });
}

function renderOverview() {
  if (!state.overview || !elements.overviewScene) return;
  const allNodes = overviewNodes();
  const nodes = filteredOverviewNodes();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layout = overviewLayout(nodes);
  const positions = layout.positions;
  state.overviewCanvas = { width: layout.width, height: layout.height };
  elements.overviewGraph.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  const links = state.overview.links.filter((link) => nodeById.has(link.source) && nodeById.has(link.target));
  const edges = links.map((link) => {
    const source = positions.get(link.source);
    const target = positions.get(link.target);
    const targetNode = nodeById.get(link.target);
    const runStatusClass = targetNode?.type === "run" ? ` overview-edge-status-${escapeHtml(targetNode.status)}` : "";
    const selectedClass = state.overviewSelectedId === link.target ? " is-selected" : "";
    const edgeTarget = targetNode?.type === "run" ? ` data-overview-edge-target="${escapeHtml(link.target)}"` : "";
    return `<line class="overview-edge overview-edge-${escapeHtml(link.kind.replaceAll("_", "-"))}${runStatusClass}${selectedClass}"${edgeTarget} x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const position = positions.get(node.id);
    if (node.type === "feature") return overviewFeatureNodeHtml(node, position);
    if (node.type === "work_item") return overviewWorkItemNodeHtml(node, position);
    return overviewRunNodeHtml(node, position);
  }).join("");
  elements.overviewScene.innerHTML = `${edges}${nodeMarkup}`;
  applyOverviewTransform();

  const counts = {
    feature: allNodes.filter((node) => node.type === "feature").length,
    work_item: allNodes.filter((node) => node.type === "work_item").length,
  };
  document.querySelector("#overview-all-count").textContent = String(allNodes.length);
  document.querySelector("#overview-feature-count").textContent = String(counts.feature);
  document.querySelector("#overview-work-item-count").textContent = String(counts.work_item);
  document.querySelector("#overview-run-count").textContent = String(state.overview.summary.run_count);
  elements.overviewEngineSummary.textContent = `Nodes ${nodes.length} · Links ${links.length}${state.overview.summary.truncated_runs ? " · 최근 Run 100개" : ""}`;
  elements.visibleCount.textContent = `${allNodes.length} nodes`;
  elements.dockSummary.textContent = `Feature ${counts.feature} · WorkItem ${counts.work_item} · Run ${state.overview.summary.run_count}`;

  const selected = allNodes.find((node) => node.id === state.overviewSelectedId);
  elements.overviewSelection.classList.toggle("hidden", !selected);
  elements.overviewSelection.innerHTML = overviewSelectionHtml(selected);
  bindOverviewNodes(nodes);
}

async function loadOverview() {
  elements.overviewLoading.classList.remove("hidden");
  try {
    state.overview = await api("/api/overview");
    elements.healthDot.className = "health-dot healthy";
    elements.healthLabel.textContent = "State DB 연결됨";
    renderOverview();
  } catch (error) {
    elements.healthDot.className = "health-dot failed";
    elements.healthLabel.textContent = "State DB 연결 실패";
    elements.overviewScene.innerHTML = `<text class="overview-error" x="700" y="380" text-anchor="middle">${escapeHtml(error.message)}</text>`;
    elements.overviewEngineSummary.textContent = "그래프를 불러오지 못했습니다.";
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
  state.currentView = view;
  const isOverview = view === "overview";
  const isRuns = view === "runs";
  elements.overviewView.classList.toggle("hidden", !isOverview);
  elements.workItemsView.classList.toggle("hidden", isOverview || isRuns);
  elements.runsView.classList.toggle("hidden", !isRuns);
  document.querySelector("#nav-overview").classList.toggle("active", isOverview);
  document.querySelector("#nav-work-items").classList.toggle("active", !isOverview && !isRuns);
  document.querySelector("#nav-runs").classList.toggle("active", isRuns);
  document.querySelector("#nav-overview").toggleAttribute("aria-current", isOverview);
  document.querySelector("#nav-work-items").toggleAttribute("aria-current", !isOverview && !isRuns);
  document.querySelector("#nav-runs").toggleAttribute("aria-current", isRuns);
  const title = isOverview ? "Overview" : isRuns ? "Runs" : "Work Items";
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#page-crumb").textContent = title;
  document.querySelector("#open-draft-modal").classList.toggle("hidden", isOverview || isRuns);
  if (isOverview) await loadOverview();
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
  elements.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.querySelector("#draft-title").focus();
}

function closeModal() {
  elements.modal.classList.add("hidden");
  document.body.style.overflow = "";
  document.querySelector("#open-draft-modal").focus();
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

document.querySelector("#open-draft-modal").addEventListener("click", openModal);
document.querySelector("#close-draft-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-draft").addEventListener("click", closeModal);
document.querySelector("#refresh-items").addEventListener("click", () => loadItems());
document.querySelector("#nav-overview").addEventListener("click", (event) => { event.preventDefault(); switchView("overview"); });
document.querySelector("#nav-work-items").addEventListener("click", (event) => { event.preventDefault(); switchView("work-items"); });
document.querySelector("#nav-runs").addEventListener("click", (event) => { event.preventDefault(); switchView("runs"); });
document.querySelector("#refresh-overview").addEventListener("click", () => loadOverview());
document.querySelector("#overview-query").addEventListener("input", (event) => { state.overviewQuery = event.target.value.trim(); renderOverview(); });
document.querySelector("#overview-status").addEventListener("change", (event) => { state.overviewStatus = event.target.value; renderOverview(); });
document.querySelectorAll("[data-overview-scope]").forEach((button) => button.addEventListener("click", () => {
  state.overviewScope = button.dataset.overviewScope;
  document.querySelectorAll("[data-overview-scope]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  renderOverview();
}));
document.querySelector("#overview-fit").addEventListener("click", () => { state.overviewScale = 1; state.overviewOffset = { x: 0, y: 0 }; applyOverviewTransform(); });
document.querySelector("#overview-reset").addEventListener("click", () => {
  state.overviewQuery = ""; state.overviewScope = "all"; state.overviewStatus = ""; state.overviewSelectedId = null;
  state.overviewScale = 1; state.overviewOffset = { x: 0, y: 0 }; state.overviewSpread = false;
  document.querySelector("#overview-query").value = ""; document.querySelector("#overview-status").value = "";
  document.querySelector("#overview-spread").setAttribute("aria-pressed", "false");
  document.querySelectorAll("[data-overview-scope]").forEach((button) => button.classList.toggle("active", button.dataset.overviewScope === "all"));
  renderOverview();
});
document.querySelector("#overview-spread").addEventListener("click", (event) => {
  state.overviewSpread = !state.overviewSpread;
  event.currentTarget.setAttribute("aria-pressed", String(state.overviewSpread));
  renderOverview();
});
function changeOverviewZoom(delta) {
  state.overviewScale = Math.max(.55, Math.min(2.1, state.overviewScale + delta));
  applyOverviewTransform();
}
document.querySelector("#overview-zoom-in").addEventListener("click", () => changeOverviewZoom(.15));
document.querySelector("#overview-zoom-out").addEventListener("click", () => changeOverviewZoom(-.15));
document.querySelector("#overview-zoom-reset").addEventListener("click", () => { state.overviewScale = 1; state.overviewOffset = { x: 0, y: 0 }; applyOverviewTransform(); });
elements.overviewGraph.addEventListener("wheel", (event) => { event.preventDefault(); changeOverviewZoom(event.deltaY < 0 ? .1 : -.1); }, { passive: false });
elements.overviewGraph.addEventListener("pointerdown", (event) => {
  if (event.target.closest?.("[data-overview-node]")) return;
  state.overviewDragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...state.overviewOffset } };
  elements.overviewGraph.setPointerCapture(event.pointerId);
  elements.overviewGraph.classList.add("is-dragging");
});
elements.overviewGraph.addEventListener("pointermove", (event) => {
  if (!state.overviewDragging || state.overviewDragging.pointerId !== event.pointerId) return;
  const bounds = elements.overviewGraph.getBoundingClientRect();
  state.overviewOffset = {
    x: state.overviewDragging.origin.x + (event.clientX - state.overviewDragging.x) * state.overviewCanvas.width / bounds.width,
    y: state.overviewDragging.origin.y + (event.clientY - state.overviewDragging.y) * state.overviewCanvas.height / bounds.height,
  };
  applyOverviewTransform();
});
elements.overviewGraph.addEventListener("pointerup", (event) => {
  if (state.overviewDragging?.pointerId !== event.pointerId) return;
  state.overviewDragging = null;
  elements.overviewGraph.classList.remove("is-dragging");
  elements.overviewGraph.releasePointerCapture(event.pointerId);
});
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
elements.editModal.addEventListener("click", (event) => { if (event.target === elements.editModal) closeEditModal(); });
elements.deleteModal.addEventListener("click", (event) => { if (event.target === elements.deleteModal) closeDeleteModal(); });
elements.memoModal.addEventListener("click", (event) => { if (event.target === elements.memoModal) requestCloseMemoModal(); });
elements.memoCloseModal.addEventListener("click", (event) => { if (event.target === elements.memoCloseModal) continueMemoEditing(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.memoCloseModal.classList.contains("hidden")) continueMemoEditing();
  else if (!elements.deleteModal.classList.contains("hidden")) closeDeleteModal();
  else if (!elements.editModal.classList.contains("hidden")) closeEditModal();
  else if (!elements.modal.classList.contains("hidden")) closeModal();
  else if (!elements.memoModal.classList.contains("hidden")) requestCloseMemoModal();
});

buildRunsStatusFilters();
loadItems();
