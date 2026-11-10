(() => {
  const gallery = document.querySelector("#feature-gallery");
  const panel = document.querySelector("#feature-detail");
  const scrim = document.querySelector("#feature-scrim");
  const modal = document.querySelector("#feature-create-modal");
  const form = document.querySelector("#feature-create-form");
  const statusInputs = [...document.querySelectorAll(".feature-status-filters input[type=checkbox]")];
  const allStatusesButton = document.querySelector("#feature-status-all");
  const state = { features: [], selectedId: null, detailVersion: 0 };
  const labels = { planned: "Planned", active: "Active", paused: "Paused", completed: "Completed", cancelled: "Cancelled", backlog: "Backlog", ready: "Ready", in_progress: "In Progress", blocked: "Blocked", done: "Done" };
  const order = ["done", "in_progress", "ready", "backlog", "blocked"];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  async function request(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "Feature를 불러오지 못했습니다.");
    return payload;
  }

  function counts(feature) {
    const progress = feature.progress || {};
    const total = Number(progress.total_work_items || 0);
    const cancelled = Number(progress.cancelled_count || 0);
    return { progress, total, eligible: total - cancelled, done: Number(progress.done_count || 0), cancelled };
  }

  function bar(feature) {
    const { progress, eligible } = counts(feature);
    if (!eligible) return '<div class="feature-progress-bar is-empty" aria-label="진행률 계산 전"></div>';
    return `<div class="feature-progress-bar" role="img" aria-label="완료 ${Number(progress.done_count || 0)} / ${eligible}">` +
      order.map((key) => {
        const amount = Number(progress[`${key}_count`] || 0);
        return amount ? `<span class="feature-segment is-${key}" style="width:${amount / eligible * 100}%" title="${labels[key]} ${amount}개"></span>` : "";
      }).join("") + "</div>";
  }

  function render() {
    const query = document.querySelector("#feature-search").value.trim().toLowerCase();
    const selectedStatuses = new Set(statusInputs.filter((input) => input.checked).map((input) => input.value));
    allStatusesButton.setAttribute("aria-pressed", String(statusInputs.every((input) => input.checked)));
    const visible = state.features.filter((feature) =>
      selectedStatuses.has(feature.status) && (!query || `${feature.title} ${feature.id}`.toLowerCase().includes(query))
    );
    document.querySelector("#feature-visible-count").textContent = `${visible.length}개 표시`;
    document.querySelector("#visible-count").textContent = `${state.features.length} total`;
    document.querySelector("#dock-summary").textContent = `Feature ${state.features.length}개, 표시 ${visible.length}개`;
    gallery.innerHTML = visible.length ? visible.map((feature) => {
      const { done, eligible, total } = counts(feature);
      const percent = eligible ? `${Math.round(done / eligible * 100)}%` : "진행률 계산 전";
      return `<button class="feature-card" type="button" data-feature-id="${escape(feature.id)}" aria-label="${escape(feature.title)} 상세 보기">
        <span class="feature-card-top"><span><strong>${escape(feature.title)}</strong><small>${escape(feature.id)}</small></span></span>
        <span class="feature-card-summary"><span>${eligible ? `<b>${done} / ${eligible}</b> WI 완료` : total ? "진행 대상 WI 없음" : "WI 없음"}</span><span>${percent}</span></span>
        ${bar(feature)}
        <span class="feature-card-bottom"><span class="feature-state is-${escape(feature.status)}">${labels[feature.status] || escape(feature.status)}</span><span>${escape(feature.priority)} priority</span></span>
      </button>`;
    }).join("") : `<div class="feature-gallery-empty">${selectedStatuses.size ? "표시할 Feature가 없습니다." : "선택된 상태가 없습니다."}</div>`;
  }

  async function load() {
    gallery.innerHTML = '<div class="feature-gallery-empty">Feature를 불러오는 중입니다.</div>';
    try {
      const payload = await request("/api/features");
      state.features = payload.features;
      render();
    } catch (error) {
      gallery.innerHTML = `<div class="feature-gallery-empty" role="alert">${escape(error.message)}</div>`;
    }
  }

  function closeDetail() {
    state.detailVersion += 1;
    state.selectedId = null;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
    scrim.classList.add("hidden");
  }

  async function openDetail(id) {
    const version = ++state.detailVersion;
    state.selectedId = id;
    scrim.classList.remove("hidden");
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    panel.inert = false;
    panel.innerHTML = '<div class="feature-detail-loading">상세 정보를 불러오는 중입니다.</div>';
    try {
      const { feature, work_items: items } = await request(`/api/features/${encodeURIComponent(id)}`);
      if (version !== state.detailVersion) return;
      const { progress, eligible, done, total, cancelled } = counts(feature);
      const metric = eligible ? `${Math.round(done / eligible * 100)}%` : "—";
      const breakdown = eligible ? `<div class="feature-breakdown">${order.filter((key) => Number(progress[`${key}_count`] || 0) > 0).map((key) => `<span><i class="is-${key}"></i>${labels[key]} <b>${Number(progress[`${key}_count`])}</b></span>`).join("")}${cancelled ? `<span>Cancelled <b>${cancelled}</b> (계산 제외)</span>` : ""}</div>` : `<p class="feature-progress-hint">${total ? "모든 WI가 취소되어 진행률 계산 대상이 없습니다." : "WI를 연결하면 진행률이 표시됩니다."} Feature 상태는 별도로 관리됩니다.</p>`;
      const workItems = items.length ? items.map((item) => {
        const label = item.is_draft ? "Draft" : labels[item.status] || item.status;
        return `<button class="feature-wi-row" type="button" data-feature-work-item="${escape(item.id)}" aria-label="${escape(item.title)} WorkItem 상세 보기"><span><strong>${escape(item.title)}</strong><small>${escape(item.id)}</small></span><span class="feature-wi-status is-${escape(item.status)}">${escape(label)}</span></button>`;
      }).join("") : '<div class="feature-no-wi"><strong>아직 연결된 WI가 없습니다</strong><p>작업 항목을 연결하면 이곳에 목록과 진행 상황이 표시됩니다.</p></div>';
      panel.innerHTML = `<div class="feature-detail-head"><div class="feature-detail-top"><span>${escape(feature.id)}</span><button class="feature-detail-close" type="button" aria-label="Feature 상세 닫기">×</button></div><h2>${escape(feature.title)}</h2><p>${escape(feature.goal)}</p></div>
        <div class="feature-detail-body"><section><h3>속성</h3><dl class="feature-properties"><dt>상태</dt><dd><span class="feature-state is-${escape(feature.status)}">${labels[feature.status] || escape(feature.status)}</span></dd><dt>우선순위</dt><dd>${escape(feature.priority)}</dd><dt>연결된 WI</dt><dd>${total}개</dd></dl></section>
        <section><h3>진행 상황</h3><div class="feature-metric"><strong>${metric}</strong><span>${eligible ? `${done} / ${eligible} WI 완료` : "진행률 계산 전"}</span></div>${bar(feature)}${breakdown}</section>
        <section><h3>연결된 Work Items <small>${items.length}</small></h3>${workItems}</section></div>`;
      panel.querySelector(".feature-detail-close").focus();
    } catch (error) {
      if (version === state.detailVersion) panel.innerHTML = `<div class="feature-detail-loading" role="alert">${escape(error.message)}<button class="feature-detail-close" type="button" aria-label="닫기">×</button></div>`;
    }
  }

  function closeCreate() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    document.querySelector("#open-draft-modal").focus();
  }

  function openCreate() {
    form.reset();
    document.querySelector("#feature-create-error").classList.add("hidden");
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    form.elements.namedItem("title").focus();
  }

  gallery.addEventListener("click", (event) => {
    const card = event.target.closest("[data-feature-id]");
    if (card) openDetail(card.dataset.featureId);
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest(".feature-detail-close")) return closeDetail();
    const row = event.target.closest("[data-feature-work-item]");
    if (!row) return;
    const workItemId = row.dataset.featureWorkItem;
    closeDetail();
    document.dispatchEvent(new CustomEvent("feature:open-work-item", { detail: { workItemId } }));
  });
  scrim.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!modal.classList.contains("hidden")) closeCreate();
    else if (panel.classList.contains("is-open")) closeDetail();
  });
  document.querySelector("#feature-search").addEventListener("input", render);
  document.querySelector(".feature-status-filters").addEventListener("change", render);
  allStatusesButton.addEventListener("click", () => {
    const selectAll = !statusInputs.every((input) => input.checked);
    statusInputs.forEach((input) => { input.checked = selectAll; });
    render();
  });
  document.querySelector("#refresh-features").addEventListener("click", load);
  document.querySelector("#close-feature-create").addEventListener("click", closeCreate);
  document.querySelector("#cancel-feature-create").addEventListener("click", closeCreate);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeCreate(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorNode = document.querySelector("#feature-create-error");
    const title = form.elements.namedItem("title").value.trim();
    const goal = form.elements.namedItem("goal").value.trim();
    if (!title || !goal) { errorNode.textContent = "Title과 Goal을 입력해 주세요."; errorNode.classList.remove("hidden"); return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { feature } = await request("/api/features", { method: "POST", body: JSON.stringify({ title, goal, priority: form.elements.namedItem("priority").value }) });
      closeCreate();
      await load();
      await openDetail(feature.id);
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.classList.remove("hidden");
    } finally { submit.disabled = false; }
  });

  window.featuresPage = { load, closeDetail, openCreate };
})();
