/* Read-only memory explorer. Layout coordinates never change persisted memories. */
function memoryLayout(nodes, edges) {
  const points = nodes.map((n, i) => ({id: n.id, x: Math.cos(i * 2.39996) * 30 * Math.sqrt(i + 1), y: Math.sin(i * 2.39996) * 30 * Math.sqrt(i + 1)}));
  const byId = new Map(points.map(p => [p.id, p]));
  for (let step = 0; step < 100; step++) {
    const forces = new Map(points.map(p => [p.id, {x: -p.x * .003, y: -p.y * .003}]));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j], dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const force = Math.min(9, 1100 / (d * d) + Math.max(0, 36 - d) * .3);
      const x = dx / d * force, y = dy / d * force;
      forces.get(a.id).x += x; forces.get(a.id).y += y;
      forces.get(b.id).x -= x; forces.get(b.id).y -= y;
    }
    for (const e of edges) {
      const a = byId.get(e.from_id), b = byId.get(e.to_id);
      if (!a || !b || a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - 100) * .012;
      forces.get(a.id).x += dx / d * f; forces.get(a.id).y += dy / d * f;
      forces.get(b.id).x -= dx / d * f; forces.get(b.id).y -= dy / d * f;
    }
    for (const p of points) { const f = forces.get(p.id); p.x += Math.max(-12, Math.min(12, f.x)); p.y += Math.max(-12, Math.min(12, f.y)); }
  }
  return byId;
}

(() => {
  const $ = id => document.getElementById(id);
  const svg = $("memory-graph"), scene = $("memory-scene"), panel = $("memory-detail"), tooltip = $("memory-tooltip");
  const colors = {reference: "#668d88", problem: "#c87865", solution: "#508662", pattern: "#9381ba"};
  const labels = {reference: "배경·참고", problem: "문제·오류", solution: "해결·수정", pattern: "절차·재사용"};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
  const unit = value => Number.isFinite(Number(value)) ? Math.min(1, Math.max(0, Number(value))) : .5;
  let data = {nodes: [], edges: []}, positions = new Map(), selected = null;
  let transform = {x: 600, y: 350, k: 1}, drag = null, loadVersion = 0, detailVersion = 0, timer;
  const transformScene = () => scene.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
  const hideTip = () => tooltip.classList.add("hidden");
  function tip(text, target) {
    tooltip.textContent = text;
    tooltip.classList.remove("hidden");
    const bounds = svg.parentElement.getBoundingClientRect(), rect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left - bounds.left + 15, bounds.width - tooltip.offsetWidth - 12))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(rect.top - bounds.top - tooltip.offsetHeight - 12, bounds.height - tooltip.offsetHeight - 12))}px`;
  }
  function visible() {
    const relation = $("memory-relation").value;
    const edges = data.edges.filter(e => !relation || e.rel_type === relation);
    const ids = new Set(edges.flatMap(e => [e.from_id, e.to_id]));
    return {edges, nodes: data.nodes.filter(n => !relation || ids.has(n.id))};
  }
  function fit() {
    const points = visible().nodes.map(n => positions.get(n.id)).filter(Boolean);
    if (!points.length) { transform = {x:600,y:350,k:1}; transformScene(); return; }
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    const k = Math.min(1.8, 1000 / (width + 100), 500 / (height + 100));
    transform = {x:600 - (left + width / 2) * k, y:330 - (top + height / 2) * k, k}; transformScene(); hideTip();
  }
  function highlight() {
    const neighbors = new Set([selected]);
    for (const e of data.edges) if (e.from_id === selected || e.to_id === selected) { neighbors.add(e.from_id); neighbors.add(e.to_id); }
    for (const n of scene.querySelectorAll(".memory-node")) { n.classList.toggle("selected", n.dataset.id === selected); n.classList.toggle("dimmed", !!selected && !neighbors.has(n.dataset.id)); }
    for (const e of scene.querySelectorAll(".memory-edge")) e.classList.toggle("dimmed", !!selected && e.dataset.from !== selected && e.dataset.to !== selected);
  }
  function closeDetail() { detailVersion++; selected = null; panel.classList.add("hidden"); highlight(); }
  function edgePath(edge, index) {
    const a = positions.get(edge.from_id), b = positions.get(edge.to_id);
    if (a === b) return `M ${a.x-5} ${a.y-5} C ${a.x-45} ${a.y-60}, ${a.x+45} ${a.y-60}, ${a.x+5} ${a.y-8}`;
    const dx = b.x-a.x, dy = b.y-a.y, d = Math.max(1, Math.hypot(dx,dy));
    const bend = 10 + index * 14;
    return `M ${a.x+dx/d*10} ${a.y+dy/d*10} Q ${(a.x+b.x)/2-dy/d*bend} ${(a.y+b.y)/2+dx/d*bend} ${b.x-dx/d*12} ${b.y-dy/d*12}`;
  }
  function render() {
    const {nodes, edges} = visible(), pairs = new Map();
    scene.innerHTML = edges.map(e => {
      const pair = [e.from_id, e.to_id].sort().join("|"), index = pairs.get(pair) || 0; pairs.set(pair, index + 1);
      const path = edgePath(e, index);
      return `<g class="memory-edge" data-id="${esc(e.id)}" data-from="${esc(e.from_id)}" data-to="${esc(e.to_id)}" tabindex="0" role="img" aria-label="${esc(e.rel_type)}"><path class="memory-edge-hit" d="${path}"/><path class="memory-edge-line" d="${path}" stroke-width="${1 + unit(e.strength)}" marker-end="url(#memory-arrow)"/></g>`;
    }).join("") + nodes.map(n => { const p = positions.get(n.id); return `<g class="memory-node" data-id="${esc(n.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(n.title)} (${esc(n.type)})"><circle class="memory-hit" r="15"/><circle class="memory-dot" r="7" fill="${colors[n.group] || colors.reference}" style="stroke-width:${1 + unit(n.importance)*3}px"/></g>`; }).join("");
    const nodeMap = new Map(nodes.map(n => [n.id, n])), edgeMap = new Map(edges.map(e => [e.id, e]));
    for (const el of scene.querySelectorAll(".memory-node, .memory-edge")) {
      const n = nodeMap.get(el.dataset.id), e = edgeMap.get(el.dataset.id);
      const text = n ? `${n.title}\n${n.type} · ${labels[n.group]}` : `${e.rel_type}${e.context ? "\n" + e.context : ""}`;
      el.addEventListener("pointerenter", () => tip(text, el)); el.addEventListener("focus", () => tip(text, el));
      el.addEventListener("pointerleave", hideTip); el.addEventListener("blur", hideTip);
      if (n) { el.addEventListener("click", () => detail(n.id)); el.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) {event.preventDefault(); detail(n.id);} }); }
    }
    $("memory-message").textContent = nodes.length ? "" : (data.total ? "조건에 맞는 기억이 없습니다. 필터를 변경해 보세요." : "표시할 기억이 없습니다. 검색 조건을 확인하거나 저장된 기억을 기다려 주세요.");
    $("memory-count").textContent = `${nodes.length}개 기억 · ${edges.length}개 관계${data.truncated ? ` · 검색 결과 ${data.total}개 중 최근 500개 표시 — 검색으로 범위를 좁혀 주세요.` : ""}`;
    if (state.currentView === "memory-graph") {
      $("visible-count").textContent = `${nodes.length} nodes`;
      $("dock-summary").textContent = `MemoryGraph · ${nodes.length}개 기억 · ${edges.length}개 관계`;
    }
    highlight(); transformScene();
  }
  async function get(url) { const response = await fetch(url); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "조회에 실패했습니다."); return result; }
  async function load() {
    const version = ++loadVersion; closeDetail(); hideTip(); scene.replaceChildren();
    $("memory-message").textContent = "기억을 불러오는 중입니다…";
    $("memory-count").textContent = "";
    if (state.currentView === "memory-graph") { $("visible-count").textContent = ""; $("dock-summary").textContent = "기억 저장소 조회 중"; }
    try {
      const params = new URLSearchParams({query: $("memory-query").value, group: $("memory-group").value});
      const result = await get(`/api/memory-graph?${params}`);
      if (version !== loadVersion) return;
      data = result; positions = memoryLayout(data.nodes, data.edges);
      const previous = $("memory-relation").value;
      $("memory-relation").innerHTML = '<option value="">전체 관계</option>' + [...new Set(data.edges.map(e => e.rel_type))].sort().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
      if ([...$("memory-relation").options].some(o => o.value === previous)) $("memory-relation").value = previous;
      render(); fit();
    } catch (error) { if (version !== loadVersion) return; data = {nodes:[],edges:[]}; $("memory-message").textContent = error.message; $("memory-count").textContent = "조회 실패 · 새로고침으로 재시도"; if (state.currentView === "memory-graph") $("dock-summary").textContent = "기억 저장소 조회 실패"; }
  }
  async function detail(id) {
    selected = id; const version = ++detailVersion; hideTip(); highlight(); panel.classList.remove("hidden");
    const header = '<div class="overview-selection-heading"><span>MEMORY</span><button type="button" aria-label="기억 상세 닫기">×</button></div>';
    const bindClose = () => panel.querySelector("button").addEventListener("click", closeDetail);
    panel.innerHTML = header + '<p>기억을 불러오는 중입니다…</p>'; bindClose();
    try {
      const result = await get(`/api/memory-graph/${encodeURIComponent(id)}`); if (version !== detailVersion) return;
      const n = result.memory;
      const date = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR") : "—";
      panel.innerHTML = header + `<h3>${esc(n.title)}</h3><dl><div><dt>타입</dt><dd>${esc(n.type)}</dd></div><div><dt>범주</dt><dd>${esc(labels[n.group])}</dd></div><div><dt>중요도</dt><dd>${Math.round(unit(n.importance)*100)}%</dd></div><div><dt>신뢰도</dt><dd>${Math.round(unit(n.confidence)*100)}%</dd></div><div><dt>생성</dt><dd>${esc(date(n.created_at))}</dd></div><div><dt>수정</dt><dd>${esc(date(n.updated_at))}</dd></div></dl>` +
        (n.tags.length ? `<div class="memory-tags">${n.tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div>` : "") +
        (n.summary ? `<h4>요약</h4><p>${esc(n.summary)}</p>` : "") +
        (n.content ? `<h4>내용</h4><p>${esc(n.content.slice(0,4000))}</p>${n.content.length > 4000 ? '<details><summary>나머지 내용</summary><p>' + esc(n.content.slice(4000)) + '</p></details>' : ''}` : "") +
        `<h4>연결된 기억 · ${result.relationships.length}</h4><ul class="memory-links">${result.relationships.map(e=>`<li><button type="button" data-memory-id="${esc(e.neighbor_id)}"><small>${e.from_id===id ? "→" : "←"} ${esc(e.rel_type)}</small>${esc(e.neighbor_title)}</button></li>`).join("")}</ul>` + (!result.relationships.length ? '<p>연결된 기억이 없습니다.</p>' : '');
      bindClose(); for (const button of panel.querySelectorAll("[data-memory-id]")) button.addEventListener("click", () => detail(button.dataset.memoryId));
    } catch(error) { if(version!==detailVersion)return; panel.innerHTML=header+`<p>${esc(error.message)}</p>`; bindClose(); }
  }
  function zoom(factor, x=600, y=350) { const k=Math.max(.15,Math.min(5,transform.k*factor)), ratio=k/transform.k; transform={x:x-(x-transform.x)*ratio,y:y-(y-transform.y)*ratio,k}; transformScene(); hideTip(); }
  function point(event) { const p=svg.createSVGPoint(); p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.getScreenCTM().inverse()); }
  svg.addEventListener("wheel", event=>{event.preventDefault();const p=point(event);zoom(event.deltaY<0?1.12:1/1.12,p.x,p.y);},{passive:false});
  svg.addEventListener("pointerdown",event=>{if(event.target.closest(".memory-node, .memory-edge")||event.button!==0)return;const p=point(event);drag={id:event.pointerId,x:p.x,y:p.y,tx:transform.x,ty:transform.y};svg.setPointerCapture(event.pointerId);hideTip();});
  svg.addEventListener("pointermove",event=>{if(!drag||drag.id!==event.pointerId)return;const p=point(event);transform.x=drag.tx+p.x-drag.x;transform.y=drag.ty+p.y-drag.y;transformScene();});
  for(const type of ["pointerup","pointercancel","lostpointercapture"])svg.addEventListener(type,()=>{drag=null;});
  $("memory-fit").addEventListener("click",fit);$("memory-zoom-in").addEventListener("click",()=>zoom(1.2));$("memory-zoom-out").addEventListener("click",()=>zoom(1/1.2));
  $("memory-query").addEventListener("input",()=>{clearTimeout(timer);loadVersion++;timer=setTimeout(load,250);});
  $("memory-group").addEventListener("change",load);$("memory-refresh").addEventListener("click",load);
  $("memory-relation").addEventListener("change",()=>{closeDetail();hideTip();render();fit();});
  $("memory-reset").addEventListener("click",()=>{clearTimeout(timer);for(const id of ["memory-query","memory-group","memory-relation"])$(id).value="";load();});
  $("memory-graph-view").addEventListener("keydown",event=>{if(event.key==="Escape"){closeDetail();hideTip();}});
  $("nav-memory-graph").addEventListener("click",event=>{event.preventDefault();switchView("memory-graph");});
  window.memoryGraph = {load};
})();
