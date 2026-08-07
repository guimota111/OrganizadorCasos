import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, getDocs,
  serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ─── Multi-user data scoping ──────────────────────────────────────────────────
// Each pathologist's cases live under users/{uid}/casos
let currentUid = null;
const casesCol = () => collection(db, "users", currentUid, "casos");
const caseDoc  = (id) => doc(db, "users", currentUid, "casos", id);

// ─── State ────────────────────────────────────────────────────────────────────
let allCases        = [];
let editingId       = null;
let activeFilter    = "all";
let pendingDeleteId = null;
let reorderMode     = false;
let reorderQueue    = [];   // IDs in the order the user clicks
let selectMode      = false;
const selectedIds   = new Set();   // IDs selected for bulk delete
let lastPrintOrder  = JSON.parse(localStorage.getItem("lastPrintOrder") || "[]");
const expandedIds   = new Set();

// A importação por URL (#motion=…) só pode rodar depois que os casos existentes
// chegarem — sem eles, tudo pareceria "novo" e nada seria reconhecido.
let casosCarregados    = false;
const aguardandoCasos  = [];
function quandoCasosCarregarem(fn) {
  if (casosCarregados) fn();
  else aguardandoCasos.push(fn);
}

// lastPrintOrder restored from localStorage — sort button always available

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form           = document.getElementById("case-form");
const formTitle      = document.getElementById("form-title");
const cancelEditBtn  = document.getElementById("cancel-edit");
const pendenciaGroup = document.getElementById("pendencia-group");
const formToggle     = document.getElementById("form-toggle");
const formBody       = document.getElementById("form-body");
const caseListEl     = document.getElementById("case-list");
const emptyList      = document.getElementById("empty-list");
const releasedListEl = document.getElementById("released-list");
const emptyReleased  = document.getElementById("empty-released");
const releasedToggle = document.getElementById("released-toggle");
const releasedBody   = document.getElementById("released-body");
const toast          = document.getElementById("toast");
const deleteModal    = document.getElementById("delete-modal");
const deleteModalMsg = document.getElementById("delete-modal-msg");
const confirmDelBtn  = document.getElementById("confirm-delete");
const cancelDelBtn   = document.getElementById("cancel-delete");

// ─── Form toggle ──────────────────────────────────────────────────────────────
formToggle.addEventListener("click", () => toggleSection(formBody, formToggle));
releasedToggle.addEventListener("click", () => toggleSection(releasedBody, releasedToggle));

function toggleSection(body, btn, forceOpen) {
  const open = forceOpen ?? body.hidden;
  body.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.querySelector(".section__chevron").style.transform = open ? "rotate(180deg)" : "";
}

// ─── Status radio toggle ──────────────────────────────────────────────────────
document.querySelectorAll('input[name="status"]').forEach((r) => {
  r.addEventListener("change", () => {
    pendenciaGroup.hidden = r.value !== "pendencia";
    if (r.value !== "pendencia") document.getElementById("pendencia-desc").value = "";
  });
});

// ─── Form submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome        = document.getElementById("nome").value.trim();
  const fap         = document.getElementById("fap").value.trim();
  const resumoLinha = document.getElementById("resumo-linha").value.trim();
  const resumo      = document.getElementById("resumo").value.trim();
  const status      = document.querySelector('input[name="status"]:checked').value;
  const pendenciaDesc = status === "pendencia"
    ? document.getElementById("pendencia-desc").value.trim() : "";

  if (!nome || !fap) { showToast("Preencha nome e FAP.", "error"); return; }

  const resumoLog = resumoLinha ? [{ text: resumoLinha, ts: Date.now() }] : [];
  const payload = { nome, fap, resumoLinha, resumoLog, resumo, status, pendenciaDesc, updatedAt: serverTimestamp() };

  try {
    if (editingId) {
      await updateDoc(caseDoc(editingId), payload);
      showToast("Caso atualizado.");
      cancelEdit();
    } else {
      const group    = allCases.filter((c) => !c.liberado && c.status === status);
      const maxOrder = group.reduce((m, c) => Math.max(m, c.listOrder ?? c.sortOrder ?? 0), 0);
      payload.createdAt = serverTimestamp();
      payload.liberado  = false;
      payload.listOrder = maxOrder + 1000;
      await addDoc(casesCol(), payload);
      showToast("Caso cadastrado.");
    }
    form.reset();
    pendenciaGroup.hidden = true;
    toggleSection(formBody, formToggle, false);
  } catch (err) {
    showToast("Erro ao salvar: " + err.message, "error");
  }
});

cancelEditBtn.addEventListener("click", cancelEdit);

function cancelEdit() {
  editingId = null;
  formTitle.textContent = "Novo Caso";
  cancelEditBtn.hidden  = true;
  form.reset();
  pendenciaGroup.hidden = true;
  toggleSection(formBody, formToggle, false);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const loginScreen  = document.getElementById("login-screen");
const mainHeader   = document.getElementById("main-header");
const mainContent  = document.getElementById("main-content");
const loginForm    = document.getElementById("login-form");
const loginError   = document.getElementById("login-error");
const loginBtn     = document.getElementById("login-btn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando…";
  loginError.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    loginError.textContent = "E-mail ou senha incorretos.";
    loginError.hidden = false;
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

let unsubscribeSnapshot = null;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    loginScreen.hidden  = true;
    mainHeader.hidden   = false;
    mainContent.hidden  = false;
    loginBtn.disabled   = false;
    loginBtn.textContent = "Entrar";
    const userEmailEl = document.getElementById("user-email");
    if (userEmailEl) userEmailEl.textContent = user.email ?? "";
    await migrateLegacyCases();
    unsubscribeSnapshot = onSnapshot(
      query(casesCol(), orderBy("createdAt", "desc")),
      (snap) => {
        allCases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
        if (!casosCarregados) {
          casosCarregados = true;
          aguardandoCasos.splice(0).forEach((fn) => fn());
        }
      },
      (err) => showToast("Erro ao carregar casos: " + err.message, "error")
    );
  } else {
    currentUid = null;
    loginScreen.hidden  = false;
    mainHeader.hidden   = true;
    mainContent.hidden  = true;
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    allCases = [];
    casosCarregados = false;
  }
});

// One-time migration: copy docs from the legacy root "casos" collection into
// users/{uid}/casos. Runs silently; skips if the user already has data or the
// legacy collection is unreadable (e.g. rules already lock it down).
async function migrateLegacyCases() {
  try {
    const mine = await getDocs(casesCol());
    if (!mine.empty) return;
    const legacy = await getDocs(collection(db, "casos"));
    if (legacy.empty) return;
    const batch = writeBatch(db);
    legacy.docs.forEach((d) => batch.set(caseDoc(d.id), d.data()));
    await batch.commit();
    showToast(`${legacy.size} casos migrados para sua conta.`);
  } catch {
    /* legacy collection inaccessible — nothing to migrate */
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const open     = allCases.filter((c) => !c.liberado)
    .sort((a, b) => (a.listOrder ?? a.sortOrder ?? 0) - (b.listOrder ?? b.sortOrder ?? 0));
  const released = allCases.filter((c) =>  c.liberado)
    .sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0));

  // counters
  document.getElementById("cnt-total").textContent    = open.length;
  document.getElementById("cnt-nao-visto").textContent= open.filter((c) => c.status === "nao-visto").length;
  document.getElementById("cnt-visto").textContent    = open.filter((c) => c.status === "visto").length;
  document.getElementById("cnt-laudado").textContent  = open.filter((c) => c.status === "laudado").length;
  document.getElementById("cnt-parcial").textContent  = open.filter((c) => c.status === "parcial").length;
  document.getElementById("cnt-pendencia").textContent= open.filter((c) => c.status === "pendencia").length;
  document.getElementById("cnt-outros").textContent   = open.filter((c) => c.status === "outros").length;
  document.getElementById("cnt-liberado").textContent = released.length;
  document.getElementById("badge-liberado").textContent = released.length;
  updateFilterCounts(open);

  // Save unsaved textarea content from expanded rows before rebuilding
  const savedResumo = {};
  expandedIds.forEach((id) => {
    const r = caseListEl.querySelector(`[data-id="${id}"]`);
    if (r) {
      const ta = r.querySelector(".ie-resumo");
      if (ta) savedResumo[id] = ta.value;
    }
  });

  // open list
  caseListEl.innerHTML = "";
  const visible = open.filter((c) => activeFilter === "all" || c.status === activeFilter);
  emptyList.hidden = visible.length > 0;
  visible.forEach((c) => caseListEl.appendChild(buildRow(c)));
  // restore accordion state and unsaved textarea content after re-render
  expandedIds.forEach((id) => {
    const r = caseListEl.querySelector(`[data-id="${id}"]`);
    if (r) {
      openRowDetail(r);
      if (savedResumo[id] !== undefined) {
        const ta = r.querySelector(".ie-resumo");
        if (ta) ta.value = savedResumo[id];
      }
    }
  });
  initDrag(caseListEl);

  // released list
  releasedListEl.innerHTML = "";
  emptyReleased.hidden = released.length > 0;
  released.forEach((c) => releasedListEl.appendChild(buildReleasedRow(c)));
}

function updateFilterCounts(open) {
  document.getElementById("cnt-all").textContent           = open.length;
  document.getElementById("cnt-f-nao-visto").textContent   = open.filter((c) => c.status === "nao-visto").length;
  document.getElementById("cnt-f-visto").textContent       = open.filter((c) => c.status === "visto").length;
  document.getElementById("cnt-f-laudado").textContent     = open.filter((c) => c.status === "laudado").length;
  document.getElementById("cnt-f-parcial").textContent     = open.filter((c) => c.status === "parcial").length;
  document.getElementById("cnt-f-pendencia").textContent   = open.filter((c) => c.status === "pendencia").length;
  document.getElementById("cnt-f-outros").textContent      = open.filter((c) => c.status === "outros").length;
}

// ─── Filter buttons ───────────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    render();
  });
});

// ─── resumoLog helpers ────────────────────────────────────────────────────────
// Normalise legacy string field into array format
function getLog(c) {
  if (Array.isArray(c.resumoLog) && c.resumoLog.length) return c.resumoLog;
  if (c.resumoLinha) return [{ text: c.resumoLinha, ts: c.createdAt?.seconds * 1000 || 0 }];
  return [];
}
function lastLogText(c) {
  const log = getLog(c);
  return log.length ? log[log.length - 1].text : "";
}
function renderLogHtml(c) {
  const log = getLog(c);
  if (!log.length) return `<p class="log-empty">Nenhuma entrada ainda.</p>`;
  return [...log].reverse().map((entry, i) => `
    <div class="log-entry${i === 0 ? " log-entry--latest" : ""}">
      <span class="log-entry__ts">${entry.ts ? new Date(entry.ts).toLocaleString("pt-BR", {day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—"}</span>
      <span class="log-entry__text">${escHtml(entry.text)}</span>
    </div>`).join("");
}


const STATUS_OPTIONS = [
  { value: "nao-visto", label: "⬜ Não visto" },
  { value: "visto",     label: "🟡 Visto mas não laudado" },
  { value: "laudado",   label: "✅ Laudado" },
  { value: "parcial",   label: "🟠 Parcialmente montado" },
  { value: "pendencia", label: "⏳ Pendência" },
  { value: "outros",    label: "🔵 Outros" },
];

// ─── Open case row ────────────────────────────────────────────────────────────
function buildRow(c) {
  const row = document.createElement("div");
  const qPos = reorderQueue.indexOf(c.id);
  const isSelected = selectedIds.has(c.id);
  row.className = `list-row list-row--${c.status}${c.checked ? " list-row--checked" : ""}${reorderMode ? (qPos >= 0 ? " reorder-selected" : " reorder-pending") : ""}${selectMode ? (isSelected ? " select-selected" : " select-pending") : ""}`;
  row.setAttribute("draggable", !reorderMode && !selectMode);
  row.dataset.id = c.id;

  const selectOptions = STATUS_OPTIONS.map((o) =>
    `<option value="${o.value}"${c.status === o.value ? " selected" : ""}>${o.label}</option>`
  ).join("");

  const reorderBadge = reorderMode
    ? `<div class="reorder-badge">${qPos >= 0 ? qPos + 1 : ""}</div>`
    : selectMode
    ? `<div class="select-badge">${isSelected ? "✓" : ""}</div>`
    : "";

  row.innerHTML = `
    ${reorderBadge}
    <div class="list-row__handle" title="Arrastar para reordenar">⠿</div>
    <button class="list-row__check" data-action="toggle-check" title="Marcar como checado">✓</button>
    <div class="list-row__fap" title="Clique para copiar FAP" style="cursor:pointer;">${escHtml(c.fap)}</div>
    <div class="list-row__main">
      <div class="list-row__nome">${escHtml(c.nome)}<button class="copy-nome-btn" title="Copiar nome" tabindex="-1">⎘</button>${c.uf ? `<span class="uf-badge uf-badge--${c.uf.toLowerCase()}">${c.uf}</span>` : ""}${c.tipo === "imuno" ? `<span class="tipo-badge tipo-badge--imuno">IHQ</span>` : ""}${c.deadline ? (() => { const cd = fmtCountdown(c.deadline); return `<span class="prazo-chip prazo-chip--${cd.level}" title="Prazo do caso">⏳ ${cd.text}</span>`; })() : ""}</div>
      ${lastLogText(c) ? `<div class="list-row__resumo-linha">${escHtml(lastLogText(c))}</div>` : ""}
    </div>
    <select class="status-select status-select--${c.status}" data-action="change-status">${selectOptions}</select>
    ${c.checked && c.checkedAt ? `<span class="list-row__checked-stamp">Visto em ${fmtStamp(c.checkedAt)}</span>` : ""}
    <span class="list-row__chevron" aria-hidden="true">▾</span>
    <div class="list-row__detail" hidden>
      <div class="inline-edit">
        <div class="inline-edit__row">
          <div class="inline-edit__field">
            <label>Nome do paciente</label>
            <input type="text" class="ie-nome" value="${escHtml(c.nome)}" />
          </div>
          <div class="inline-edit__field">
            <label>FAP</label>
            <input type="text" class="ie-fap" value="${escHtml(c.fap)}" />
          </div>
          <div class="inline-edit__field" style="max-width:120px;">
            <label>Tipo</label>
            <select class="ie-tipo">
              <option value="he"${(c.tipo ?? "he") === "he" ? " selected" : ""}>HE</option>
              <option value="imuno"${c.tipo === "imuno" ? " selected" : ""}>Imuno (IHQ)</option>
            </select>
          </div>
          <div class="inline-edit__field" style="max-width:90px;">
            <label>Estado</label>
            <select class="ie-uf">
              <option value=""${!c.uf ? " selected" : ""}>—</option>
              <option value="RJ"${c.uf === "RJ" ? " selected" : ""}>RJ</option>
              <option value="SP"${c.uf === "SP" ? " selected" : ""}>SP</option>
              <option value="GO"${c.uf === "GO" ? " selected" : ""}>GO</option>
            </select>
          </div>
        </div>
        <div class="inline-edit__field">
          <label>Atualizações / Pendências <span class="log-count">${getLog(c).length} entr${getLog(c).length === 1 ? "ada" : "adas"}</span></label>
          <div class="log-input-row">
            <input type="text" class="ie-log-new" placeholder="Nova entrada…" />
            <button class="btn btn--primary btn--sm" data-action="add-log">Adicionar</button>
          </div>
          <div class="log-list">${renderLogHtml(c)}</div>
        </div>
        <div class="inline-edit__field">
          <label>Resumo clínico / Anotações</label>
          <textarea class="ie-resumo" rows="15" placeholder="Descrição clínica, anotações do preceptor, comentários…">${escHtml(c.resumo || "")}</textarea>
        </div>
        <div class="list-row__detail-actions">
          <button class="btn btn--primary btn--sm" data-action="save-inline">Salvar alterações</button>
          <button class="btn btn--success btn--sm" data-action="liberar">Liberar caso</button>
          <button class="btn btn--ghost btn--sm" data-action="reclamacao">📨 Abrir reclamação</button>
          <button class="btn btn--danger btn--sm" data-action="excluir" data-nome="${escHtml(c.nome)}">Excluir</button>
        </div>
        <div class="reclamacao-panel" hidden>
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Explique a reclamação:</label>
          <textarea class="reclamacao-texto" rows="5" placeholder="Descreva o problema ou solicitação…" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical;"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn--ghost btn--sm" data-action="reclamacao-cancelar">Cancelar</button>
            <button class="btn btn--primary btn--sm" data-action="reclamacao-ok">OK — Copiar mensagem</button>
          </div>
        </div>
      </div>
    </div>`;

  // Click FAP to copy
  row.querySelector(".list-row__fap").addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(c.fap).catch(() => {});
    const el = e.currentTarget;
    const orig = el.textContent;
    el.textContent = "✅ Copiado!";
    setTimeout(() => { el.textContent = orig; }, 1500);
  });

  // Copy name button
  row.querySelector(".copy-nome-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(c.nome).catch(() => {});
    const btn = e.currentTarget;
    btn.textContent = "✅";
    setTimeout(() => { btn.textContent = "⎘"; }, 1500);
  });

  row.addEventListener("click", (e) => {
    if (selectMode) {
      if (selectedIds.has(c.id)) selectedIds.delete(c.id);
      else selectedIds.add(c.id);
      updateSelectDeleteBtn();
      render();
      return;
    }
    if (reorderMode) {
      const idx = reorderQueue.indexOf(c.id);
      if (idx >= 0) reorderQueue.splice(idx, 1);
      else reorderQueue.push(c.id);
      render();
      return;
    }
    if (e.target.closest(".list-row__detail") || e.target.closest(".list-row__handle") || e.target.closest(".status-select") || e.target.closest(".list-row__fap") || e.target.closest(".copy-nome-btn")) return;
    toggleRowDetail(row);
  });
  row.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", (e) => handleRowAction(e, c, row))
  );
  // Tipo dropdown change (HE / Imuno)
  const tipoSel = row.querySelector(".ie-tipo");
  if (tipoSel) tipoSel.addEventListener("change", async (e) => {
    e.stopPropagation();
    await updateDoc(caseDoc(c.id), { tipo: e.target.value, updatedAt: serverTimestamp() });
  });
  // Estado (UF) dropdown change
  const ufSel = row.querySelector(".ie-uf");
  if (ufSel) ufSel.addEventListener("change", async (e) => {
    e.stopPropagation();
    await updateDoc(caseDoc(c.id), { uf: e.target.value, updatedAt: serverTimestamp() });
  });
  // Status dropdown change
  row.querySelector(".status-select").addEventListener("change", async (e) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    await updateDoc(caseDoc(c.id), { status: newStatus, updatedAt: serverTimestamp() });
  });
  return row;
}

function openRowDetail(row) {
  const detail  = row.querySelector(".list-row__detail");
  const chevron = row.querySelector(".list-row__chevron");
  detail.hidden = false;
  row.classList.add("list-row--expanded");
  chevron.style.transform = "rotate(180deg)";
  expandedIds.add(row.dataset.id);
}

function toggleRowDetail(row) {
  const detail  = row.querySelector(".list-row__detail");
  const id      = row.dataset.id;
  if (detail.hidden) {
    openRowDetail(row);
  } else {
    // Auto-save resumo clínico on collapse if changed
    const ta = row.querySelector(".ie-resumo");
    const c  = allCases.find((x) => x.id === id);
    if (ta && c && ta.value.trim() !== (c.resumo ?? "").trim()) {
      updateDoc(caseDoc(id), { resumo: ta.value.trim(), updatedAt: serverTimestamp() })
        .catch(() => {});
    }
    detail.hidden = true;
    row.classList.remove("list-row--expanded");
    row.querySelector(".list-row__chevron").style.transform = "";
    expandedIds.delete(id);
  }
}

async function handleRowAction(e, c, row) {
  e.stopPropagation();
  const action = e.currentTarget.dataset.action;

  if (action === "toggle-check") {
    const nowChecked = !c.checked;
    await updateDoc(caseDoc(c.id), {
      checked: nowChecked,
      checkedAt: nowChecked ? serverTimestamp() : null,
    });

  } else if (action === "save-inline") {
    const nome   = row.querySelector(".ie-nome").value.trim();
    const fap    = row.querySelector(".ie-fap").value.trim();
    const resumo = row.querySelector(".ie-resumo").value.trim();
    if (!nome || !fap) { showToast("Nome e FAP são obrigatórios.", "error"); return; }
    await updateDoc(caseDoc(c.id), { nome, fap, resumo, updatedAt: serverTimestamp() });
    flash(row, "✅ Salvo");

  } else if (action === "add-log") {
    const input  = row.querySelector(".ie-log-new");
    const text   = input.value.trim();
    if (!text) return;
    const entry   = { text, ts: Date.now() };
    const newLog  = [...getLog(c), entry];
    const resumo  = row.querySelector(".ie-resumo")?.value.trim() ?? c.resumo ?? "";
    await updateDoc(caseDoc(c.id), { resumoLog: newLog, resumoLinha: text, resumo, updatedAt: serverTimestamp() });
    input.value = "";

  } else if (action === "liberar") {
    if ((c.tipo ?? "he") === "he") {
      // HE: pergunta se tem IHQ pendente antes de liberar
      askImuno(c);
    } else {
      await updateDoc(caseDoc(c.id), { liberado: true, checked: false, updatedAt: serverTimestamp() });
    }

  } else if (action === "reclamacao") {
    const panel = row.querySelector(".reclamacao-panel");
    panel.hidden = false;
    panel.querySelector(".reclamacao-texto").focus();

  } else if (action === "reclamacao-cancelar") {
    const panel = row.querySelector(".reclamacao-panel");
    panel.hidden = true;
    panel.querySelector(".reclamacao-texto").value = "";

  } else if (action === "reclamacao-ok") {
    const texto = row.querySelector(".reclamacao-texto").value.trim();
    const msg = `Bom dia,\nPor favor, pode ver este caso? ${c.fap ?? ""} - ${c.nome ?? ""}\n${texto}\nMuito obrigado`;
    navigator.clipboard.writeText(msg).then(() => {
      showToast("Mensagem copiada! Cole no WhatsApp.");
      const panel = row.querySelector(".reclamacao-panel");
      panel.hidden = true;
      panel.querySelector(".reclamacao-texto").value = "";
    }).catch(() => {
      showToast("Erro ao copiar. Tente novamente.", "error");
    });

  } else if (action === "excluir") {
    pendingDeleteId = c.id;
    deleteModalMsg.textContent = `Excluir o caso de "${e.currentTarget.dataset.nome}"? Esta ação não pode ser desfeita.`;
    deleteModal.hidden = false;
  }
}

// ─── Released row ─────────────────────────────────────────────────────────────
function buildReleasedRow(c) {
  const row = document.createElement("div");
  row.className = "list-row list-row--released-item";
  row.dataset.id = c.id;

  const when = c.updatedAt
    ? new Date(c.updatedAt.seconds * 1000).toLocaleDateString("pt-BR")
    : "—";

  row.innerHTML = `
    <div></div>
    <div></div>
    <div class="list-row__fap" style="color:var(--clr-text-muted);cursor:pointer;" title="Clique para copiar FAP">${escHtml(c.fap)}</div>
    <div class="list-row__main">
        <div class="list-row__nome" style="color:var(--clr-text-muted);font-weight:500;">${escHtml(c.nome)}<button class="copy-nome-btn" title="Copiar nome" tabindex="-1">⎘</button></div>
        ${lastLogText(c) ? `<div class="list-row__resumo-linha" style="color:var(--clr-text-muted);">${escHtml(lastLogText(c))}</div>` : ""}
      </div>
    <span class="badge badge--liberado">Liberado ${when}</span>
    <span class="list-row__chevron" aria-hidden="true">▾</span>
    <div class="list-row__detail" hidden>
      ${c.resumo ? `<p class="list-row__resumo-detail">${escHtml(c.resumo)}</p>` : ""}
      ${c.notasPreceptor ? `<div><strong style="font-size:12px;">Anotações:</strong><p style="font-size:13px;margin-top:4px;">${escHtml(c.notasPreceptor)}</p></div>` : ""}
      <div class="list-row__detail-actions" style="margin-top:10px;">
        <button class="btn btn--ghost btn--sm" data-action="reabrir">↩ Reabrir caso</button>
        <button class="btn btn--danger btn--sm" data-action="excluir" data-nome="${escHtml(c.nome)}">Excluir</button>
      </div>
    </div>`;

  row.querySelector(".list-row__fap").addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(c.fap).catch(() => {});
    const el = e.currentTarget;
    const orig = el.textContent;
    el.textContent = "✅ Copiado!";
    setTimeout(() => { el.textContent = orig; }, 1500);
  });
  row.querySelector(".copy-nome-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(c.nome).catch(() => {});
    const btn = e.currentTarget;
    btn.textContent = "✅";
    setTimeout(() => { btn.textContent = "⎘"; }, 1500);
  });
  row.addEventListener("click", (e) => {
    if (e.target.closest(".list-row__detail") || e.target.closest(".list-row__fap") || e.target.closest(".copy-nome-btn")) return;
    toggleRowDetail(row);
  });
  row.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", (e) => handleReleasedRowAction(e, c))
  );
  return row;
}

async function handleReleasedRowAction(e, c) {
  e.stopPropagation();
  const action = e.currentTarget.dataset.action;
  if (action === "reabrir") {
    await updateDoc(caseDoc(c.id), { liberado: false, updatedAt: serverTimestamp() });
    showToast("Caso reaberto.");
  } else if (action === "excluir") {
    pendingDeleteId = c.id;
    deleteModalMsg.textContent = `Excluir o caso de "${e.currentTarget.dataset.nome}"? Esta ação não pode ser desfeita.`;
    deleteModal.hidden = false;
  }
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────
let dragSrcId = null;

function initDrag(container) {
  container.querySelectorAll(".list-row[draggable='true']").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      if (row.classList.contains("list-row--expanded")) { e.preventDefault(); return; }
      dragSrcId = row.dataset.id;
      row.classList.add("list-row--dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragSrcId);
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (row.dataset.id !== dragSrcId) row.classList.add("list-row--drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("list-row--drag-over"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("list-row--drag-over");
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;
      const ids    = [...container.querySelectorAll(".list-row")].map((r) => r.dataset.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      const batch = writeBatch(db);
      ids.forEach((id, i) => batch.update(caseDoc(id), { listOrder: (i + 1) * 1000 }));
      await batch.commit();
    });
    row.addEventListener("dragend", () => {
      document.querySelectorAll(".list-row--dragging, .list-row--drag-over")
        .forEach((el) => el.classList.remove("list-row--dragging", "list-row--drag-over"));
      dragSrcId = null;
    });
  });
}

// ─── Delete modal ─────────────────────────────────────────────────────────────
let pendingBulkDelete = null;   // array of ids for bulk delete

confirmDelBtn.addEventListener("click", async () => {
  if (pendingBulkDelete && pendingBulkDelete.length) {
    try {
      const batch = writeBatch(db);
      pendingBulkDelete.forEach((id) => batch.delete(caseDoc(id)));
      await batch.commit();
      showToast(`${pendingBulkDelete.length} caso${pendingBulkDelete.length !== 1 ? "s" : ""} excluído${pendingBulkDelete.length !== 1 ? "s" : ""}.`);
    } catch (err) {
      showToast("Erro ao excluir: " + err.message, "error");
    }
    pendingBulkDelete = null;
    deleteModal.hidden = true;
    if (selectMode) exitSelectMode();
    return;
  }
  if (!pendingDeleteId) return;
  try {
    await deleteDoc(caseDoc(pendingDeleteId));
    showToast("Caso excluído.");
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
  pendingDeleteId   = null;
  deleteModal.hidden = true;
});
cancelDelBtn.addEventListener("click", () => { pendingDeleteId = null; pendingBulkDelete = null; deleteModal.hidden = true; });
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) { pendingDeleteId = null; pendingBulkDelete = null; deleteModal.hidden = true; }});

// ─── Imuno (IHQ) flow ─────────────────────────────────────────────────────────
const imunoModal = document.getElementById("imuno-modal");
const imunoModalMsg = document.getElementById("imuno-modal-msg");
let pendingImunoId = null;

function askImuno(c) {
  pendingImunoId = c.id;
  imunoModalMsg.textContent = `Esse HE (${c.nome}) tem Imuno (IHQ) pendente?`;
  imunoModal.hidden = false;
}

// Não tem IHQ → libera normalmente
document.getElementById("imuno-no").addEventListener("click", async () => {
  if (!pendingImunoId) return;
  await updateDoc(caseDoc(pendingImunoId), { liberado: true, checked: false, updatedAt: serverTimestamp() });
  pendingImunoId = null;
  imunoModal.hidden = true;
});

// Tem IHQ → vira pendência, adiciona linha no log e continua ativo
document.getElementById("imuno-yes").addEventListener("click", async () => {
  if (!pendingImunoId) return;
  const c = allCases.find((x) => x.id === pendingImunoId);
  if (c) {
    const last = lastLogText(c);
    const text = (last ? `${last} - aguarda IHQ` : "Aguarda IHQ").trim();
    const newLog = [...getLog(c), { text, ts: Date.now() }];
    await updateDoc(caseDoc(c.id), {
      status: "pendencia",
      tipo: "imuno",
      checked: false,
      resumoLog: newLog,
      resumoLinha: text,
      updatedAt: serverTimestamp(),
    });
  }
  pendingImunoId = null;
  imunoModal.hidden = true;
});

imunoModal.addEventListener("click", (e) => { if (e.target === imunoModal) { pendingImunoId = null; imunoModal.hidden = true; }});

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = `toast toast--${type} toast--visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("toast--visible"), 3000);
}

// ─── Flash ────────────────────────────────────────────────────────────────────
function flash(row, msg) {
  const el = document.createElement("span");
  el.style.cssText = "position:absolute;right:16px;top:12px;font-size:12px;font-weight:700;color:#166534;pointer-events:none;";
  el.textContent = msg;
  row.style.position = "relative";
  row.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ─── Import from print ───────────────────────────────────────────────────────
(function () {
  const importModal    = document.getElementById("import-modal");
  const stepChoose     = document.getElementById("import-step-choose");
  const stepText       = document.getElementById("import-step-text");
  const stepJson       = document.getElementById("import-step-json");
  const stepKey        = document.getElementById("import-step-key");
  const stepUpload     = document.getElementById("import-step-upload");
  const stepLoading    = document.getElementById("import-step-loading");
  const stepResults    = document.getElementById("import-step-results");
  const apikeyInput    = document.getElementById("import-apikey-input");
  const apikeySaveBtn  = document.getElementById("import-apikey-save");
  const fileInput      = document.getElementById("import-file");
  const dropzone       = document.getElementById("import-dropzone");
  const dropzoneLabel  = document.getElementById("import-dropzone-label");
  const previewImg     = document.getElementById("import-preview");
  const analyzeBtn     = document.getElementById("import-analyze-btn");
  const newList         = document.getElementById("import-new-list");
  const existingList    = document.getElementById("import-existing-list");
  const probableList    = document.getElementById("import-probable-list");
  const existingSection = document.getElementById("import-existing-section");
  const probableSection = document.getElementById("import-probable-section");
  const newLabel        = document.getElementById("import-new-label");
  const existingLabel   = document.getElementById("import-existing-label");
  const probableLabel   = document.getElementById("import-probable-label");
  const reopenList      = document.getElementById("import-reopen-list");
  const reopenSection   = document.getElementById("import-reopen-section");
  const reopenLabel     = document.getElementById("import-reopen-label");
  const sobrandoList    = document.getElementById("import-sobrando-list");
  const sobrandoSection = document.getElementById("import-sobrando-section");
  const sobrandoLabel   = document.getElementById("import-sobrando-label");
  const confirmBtn     = document.getElementById("import-confirm-btn");

  let selectedFile = null;

  function showStep(step) {
    [stepChoose, stepText, stepJson, stepKey, stepUpload, stepLoading, stepResults].forEach((s) => { s.hidden = true; });
    step.hidden = false;
  }

  function openModal() {
    importModal.hidden = false;
    showStep(stepChoose);
    selectedFile = null;
    previewImg.hidden = true;
    analyzeBtn.disabled = true;
    dropzoneLabel.textContent = "Clique para selecionar imagem";
  }

  // Choose method
  document.getElementById("import-opt-text").addEventListener("click", () => {
    document.getElementById("import-text-input").value = "";
    showStep(stepText);
  });
  document.getElementById("import-opt-print").addEventListener("click", () => {
    const key = localStorage.getItem("anthropic-api-key");
    showStep(key ? stepUpload : stepKey);
  });
  document.getElementById("import-opt-json").addEventListener("click", () => {
    document.getElementById("import-json-input").value = "";
    showStep(stepJson);
  });
  document.getElementById("import-choose-cancel").addEventListener("click", closeModal);
  document.getElementById("import-text-back").addEventListener("click", () => showStep(stepChoose));
  document.getElementById("import-json-back").addEventListener("click", () => showStep(stepChoose));

  // Prazo (tempo restante) no início da linha → duração em ms
  //   "3d08h" → dias/horas   |   "14h30m" → horas/minutos
  //   "45m"   → minutos      |   "15:45"  → horas:minutos
  function parsePrazoMs(line) {
    let m = line.match(/^(\d+)d\s*(\d+)h/);
    if (m) return ((+m[1] * 24 + +m[2]) * 60) * 60 * 1000;
    m = line.match(/^(\d+)h\s*(\d+)m/);
    if (m) return ((+m[1]) * 60 + +m[2]) * 60 * 1000;
    m = line.match(/^(\d{1,2}):(\d{2})/);
    if (m) return ((+m[1]) * 60 + +m[2]) * 60 * 1000;
    m = line.match(/^(\d+)\s*m(?!\S)/);
    if (m) return (+m[1]) * 60 * 1000;
    return null;
  }

  // Parse pasted text — FAP = last 12 digits of the numbers line, name = next line
  function parsePastedText(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const digits = lines[i].replace(/\D/g, "");
      if (digits.length >= 12) {
        const fap     = digits.slice(-12);
        const prazoMs = parsePrazoMs(lines[i]);
        // Nome (1ª linha) e UF (linha RJ-/SP-/GO-) até a próxima linha de FAP
        let nome = "", uf = "";
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].replace(/\D/g, "").length >= 12) break;
          const um = lines[j].match(/^(RJ|SP|GO)-/i);
          if (um) { uf = um[1].toUpperCase(); continue; }
          if (!nome) nome = lines[j].replace(/\s*-?\s*\d{4,}\s*$/, "").trim();
        }
        if (nome) {
          const c = { nome, fap };
          if (prazoMs != null) c.deadline = Date.now() + prazoMs;
          if (uf) c.uf = uf;
          out.push(c);
        }
      }
    }
    return out;
  }

  document.getElementById("import-text-process").addEventListener("click", () => {
    const text = document.getElementById("import-text-input").value;
    const extracted = parsePastedText(text);
    if (!extracted.length) {
      showToast("Nenhum caso reconhecido no texto colado.", "error");
      return;
    }
    lastPrintOrder = extracted.map((c) => normFap(c.fap));
    localStorage.setItem("lastPrintOrder", JSON.stringify(lastPrintOrder));
    showResults(extracted, { listaCompleta: true });
  });

  // ── JSON vindo do script do Monitor de Pendências ──────────────────────────
  // Aceita [{…}] ou {casos:[…]}. O FAP é o número de 12 dígitos; o script do
  // Motion também manda o prazo como "2d04h" e/ou em horas decimais.
  function parseCasosJson(texto) {
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error("JSON inválido.");
    }
    if (dados && !Array.isArray(dados) && Array.isArray(dados.casos)) dados = dados.casos;
    if (!Array.isArray(dados)) throw new Error("O JSON precisa ser uma lista de casos.");

    const out = [];
    for (const item of dados) {
      if (!item || typeof item !== "object") continue;
      const fap = String(item.fap ?? item.requisicao ?? "").replace(/\D/g, "").slice(-12);
      if (!/^\d{12}$/.test(fap)) continue;
      const c = { nome: String(item.nome ?? "").trim(), fap };
      const deadline = deadlineDoItem(item);
      if (deadline != null) c.deadline = deadline;
      if (item.uf) c.uf = String(item.uf).toUpperCase();
      out.push(c);
    }
    return out;
  }

  function deadlineDoItem(item) {
    if (typeof item.deadline === "number" && item.deadline > 0) return item.deadline;
    if (item.prazo) {
      const ms = parsePrazoMs(String(item.prazo).trim());
      if (ms != null) return Date.now() + ms;
    }
    const horas = Number(item.horas);
    if (Number.isFinite(horas) && horas > 0) return Date.now() + horas * 3600000;
    return null;
  }

  function processarJson(texto) {
    let extracted;
    try {
      extracted = parseCasosJson(texto);
    } catch (err) {
      showToast(err.message, "error");
      return false;
    }
    if (!extracted.length) {
      showToast("Nenhum caso com FAP de 12 dígitos no JSON.", "error");
      return false;
    }
    lastPrintOrder = extracted.map((c) => normFap(c.fap));
    localStorage.setItem("lastPrintOrder", JSON.stringify(lastPrintOrder));
    importModal.hidden = false;
    showResults(extracted, { listaCompleta: true });
    return true;
  }

  document.getElementById("import-json-process").addEventListener("click", () => {
    processarJson(document.getElementById("import-json-input").value);
  });

  function closeModal() {
    importModal.hidden = true;
    selectedFile = null;
    fileInput.value = "";
  }

  document.getElementById("import-print-btn").addEventListener("click", openModal);
  document.getElementById("import-key-cancel").addEventListener("click", closeModal);
  document.getElementById("import-upload-cancel").addEventListener("click", closeModal);
  importModal.addEventListener("click", (e) => { if (e.target === importModal) closeModal(); });

  // Save API key
  apikeySaveBtn.addEventListener("click", () => {
    const key = apikeyInput.value.trim();
    if (!key) return;
    localStorage.setItem("anthropic-api-key", key);
    apikeyInput.value = "";
    showStep(stepUpload);
  });

  // Change key
  document.getElementById("import-change-key").addEventListener("click", () => {
    showStep(stepKey);
  });

  // Dropzone click
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("import-dropzone--over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("import-dropzone--over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("import-dropzone--over");
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) setFile(f);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });

  function setFile(f) {
    selectedFile = f;
    dropzoneLabel.textContent = f.name;
    analyzeBtn.disabled = false;
    const url = URL.createObjectURL(f);
    previewImg.src = url;
    previewImg.hidden = false;
  }

  // Analyze
  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    const apiKey = localStorage.getItem("anthropic-api-key");
    if (!apiKey) { showStep(stepKey); return; }

    showStep(stepLoading);

    try {
      const base64 = await fileToBase64(selectedFile);
      const mimeType = selectedFile.type;

      const prompt = `Analise esta imagem de um sistema de patologia/hospital e extraia todos os casos listados.
Para cada caso, identifique:
- Nome do paciente
- FAP: um número com EXATAMENTE 12 dígitos numéricos (sem letras, sem traços). Ignore qualquer outro número que não tenha exatamente 12 dígitos.
Retorne APENAS um JSON válido, sem markdown, sem explicações, no formato:
[{"nome": "Nome do Paciente", "fap": "123456789012"}, ...]
Se não encontrar casos, retorne [].`;

      const res = await fetch("https://patologia-proxy.guimota1.workers.dev/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Erro HTTP ${res.status}`);
      }

      const data = await res.json();
      const rawText   = data?.content?.[0]?.text ?? "";
      const truncated = data?.stop_reason === "max_tokens";
      const jsonStr   = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      // Regex que captura objetos {nome, fap} em qualquer ordem e com whitespace variado
      function extractByRegex(str) {
        const rx = /\{[^}]*"nome"\s*:\s*"([^"]+)"[^}]*"fap"\s*:\s*"([^"]+)"[^}]*\}|\{[^}]*"fap"\s*:\s*"([^"]+)"[^}]*"nome"\s*:\s*"([^"]+)"[^}]*\}/g;
        const results = [];
        for (const m of str.matchAll(rx)) {
          results.push(m[1] ? { nome: m[1], fap: m[2] } : { nome: m[4], fap: m[3] });
        }
        return results;
      }

      let parsed;
      if (!jsonStr) {
        throw new Error("A IA não retornou nenhuma resposta. Verifique a chave de API e tente novamente.");
      }
      try {
        parsed = JSON.parse(jsonStr);
      } catch (_) {
        // JSON truncado: tenta recuperar objetos completos via regex
        const recovered = extractByRegex(jsonStr);
        if (recovered.length) {
          parsed = recovered;
          const msg = truncated
            ? `Resposta cortada pela IA — ${parsed.length} casos recuperados. Tente com um print menor.`
            : `Formato inesperado — ${parsed.length} casos recuperados.`;
          showToast(msg, "warning");
        } else {
          throw new Error("A IA não conseguiu identificar casos nesta imagem. Tente com uma imagem mais nítida.");
        }
      }
      if (truncated && Array.isArray(parsed)) {
        showToast(`Atenção: resposta cortada. Alguns casos podem ter ficado de fora. Tente um print menor.`, "warning");
      }
      const extracted = parsed
        .map((c) => ({ ...c, fap: (c.fap ?? "").trim().replace(/\./g, "") }))
        .filter((c) => /^\d{12}$/.test(c.fap));

      lastPrintOrder = extracted.map((c) => normFap(c.fap));
      localStorage.setItem("lastPrintOrder", JSON.stringify(lastPrintOrder));
      showResults(extracted);
    } catch (err) {
      showStep(stepUpload);
      showToast("Erro: " + err.message, "error");
    }
  });

  function normNome(nome) {
    return (nome ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  }

  // Returns existing case that is "probably the same" as extracted case c.
  // Matches on: exact FAP, or (name similarity ≥ 80% AND FAP differs by ≤ 2 digits).
  function findDuplicate(c) {
    const fap  = normFap(c.fap);
    const nome = normNome(c.nome);
    for (const ex of allCases) {
      if (normFap(ex.fap) === fap) return { match: ex, reason: "fap" };
      if (nome && normNome(ex.nome) && nameSimilar(nome, normNome(ex.nome)) && fapClose(fap, normFap(ex.fap))) {
        return { match: ex, reason: "nome" };
      }
    }
    return null;
  }

  function nameSimilar(a, b) {
    if (!a || !b) return false;
    // At least 80% of the shorter name's words appear in the other
    const wa = a.split(" "), wb = b.split(" ");
    const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    const hits = shorter.filter((w) => w.length > 2 && longer.includes(w)).length;
    return hits / shorter.length >= 0.8;
  }

  function fapClose(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff <= 2;
  }

  // Released case with a similar name (different FAP) — candidate for reopening
  function findReleasedMatch(c) {
    const nome = normNome(c.nome);
    if (!nome) return null;
    return allCases.find((ex) => ex.liberado && normNome(ex.nome) && nameSimilar(nome, normNome(ex.nome))) ?? null;
  }

  // listaCompleta: a origem representa TODA a lista de pendências (texto colado
  // ou JSON do Motion). Só nesse caso faz sentido apontar o que está sobrando no
  // organizador — num print parcial isso proporia excluir caso legítimo.
  function showResults(extracted, { listaCompleta = false } = {}) {
    const novos      = [];
    const jaExistem  = [];
    const provaveis  = [];   // name match but FAP slightly different (open cases)
    const reaberturas = [];  // name match in released cases → offer to reopen

    for (const c of extracted) {
      const dup = findDuplicate(c);
      if (dup && dup.reason === "fap") { jaExistem.push({ c, match: dup.match }); continue; }
      if (dup && dup.reason === "nome" && !dup.match.liberado) { provaveis.push({ c, match: dup.match }); continue; }
      const rel = findReleasedMatch(c);
      if (rel) { reaberturas.push({ c, match: rel }); continue; }
      novos.push(c);
    }

    // Ativos no organizador que não vieram na lista importada.
    const fapsDaLista = new Set(extracted.map((c) => normFap(c.fap)));
    const sobrando = listaCompleta
      ? allCases.filter((c) => !c.liberado && !fapsDaLista.has(normFap(c.fap)))
      : [];

    newList.innerHTML      = "";
    existingList.innerHTML = "";
    probableList.innerHTML = "";
    reopenList.innerHTML   = "";
    sobrandoList.innerHTML = "";

    if (novos.length === 0) {
      newList.innerHTML = `<p style="font-size:13px;color:var(--clr-text-muted);padding:8px 0;">Nenhum caso novo encontrado.</p>`;
      confirmBtn.disabled = true;
    } else {
      confirmBtn.disabled = false;
      novos.forEach((c) => {
        const row = document.createElement("div");
        row.className = "import-case-row";
        row.innerHTML = `
          <input type="checkbox" checked style="flex-shrink:0;accent-color:var(--clr-primary);width:16px;height:16px;" />
          <span class="import-case-row__fap">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>
          ${c.uf ? `<span class="uf-badge uf-badge--${c.uf.toLowerCase()}">${c.uf}</span>` : ""}
          ${c.deadline ? `<span style="font-size:11px;color:var(--clr-text-muted);margin-left:auto;">⏳ ${fmtCountdown(c.deadline)?.text ?? ""}</span>` : ""}`;
        row.dataset.fap  = c.fap;
        row.dataset.nome = c.nome;
        if (c.deadline) row.dataset.deadline = c.deadline;
        if (c.uf)       row.dataset.uf = c.uf;
        newList.appendChild(row);
      });
    }

    newLabel.textContent = `${novos.length} novo${novos.length !== 1 ? "s" : ""}`;

    // Prováveis duplicatas — nome bate mas FAP ligeiramente diferente
    if (provaveis.length > 0) {
      probableSection.hidden = false;
      probableLabel.textContent = `${provaveis.length} provável duplicata${provaveis.length !== 1 ? "s" : ""} (nome similar, FAP diferente)`;
      provaveis.forEach(({ c, match }) => {
        const row = document.createElement("div");
        row.className = "import-case-row import-case-row--probable";
        row.innerHTML = `
          <input type="checkbox" style="flex-shrink:0;accent-color:#d97706;width:16px;height:16px;" />
          <span class="import-case-row__fap" title="FAP no print">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>
          <span style="font-size:11px;color:#92400e;margin-left:4px;" title="FAP no organizador">já existe: ${escHtml(match.fap)}</span>`;
        row.dataset.fap  = c.fap;
        row.dataset.nome = c.nome;
        probableList.appendChild(row);
      });
    } else {
      probableSection.hidden = true;
    }

    // Reaberturas — nome parecido na lista de liberados
    if (reaberturas.length > 0) {
      reopenSection.hidden = false;
      reopenLabel.textContent = `${reaberturas.length} possível reabertura${reaberturas.length !== 1 ? "s" : ""} (nome já foi liberado)`;
      reaberturas.forEach(({ c, match }) => {
        const row = document.createElement("div");
        row.className = "import-case-row import-case-row--reopen";
        row.innerHTML = `
          <input type="checkbox" style="flex-shrink:0;accent-color:#7c3aed;width:16px;height:16px;" />
          <span class="import-case-row__fap" title="Nova FAP no print">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>
          <span style="font-size:11px;color:#6d28d9;margin-left:4px;" title="Caso liberado com este nome">liberado: ${escHtml(match.nome)} (${escHtml(match.fap)})</span>`;
        row.dataset.fap     = c.fap;
        row.dataset.nome    = c.nome;
        row.dataset.matchId = match.id;
        if (c.deadline) row.dataset.deadline = c.deadline;
        if (c.uf)       row.dataset.uf = c.uf;
        reopenList.appendChild(row);
      });
    } else {
      reopenSection.hidden = true;
    }

    // Já existem: nada é recriado; quando a lista traz prazo, oferecemos
    // atualizar SOMENTE o prazo (marcado por padrão).
    const comPrazoNovo = jaExistem.filter(({ c }) => c.deadline != null).length;

    if (jaExistem.length > 0) {
      existingSection.hidden = false;
      existingLabel.textContent = comPrazoNovo
        ? `${jaExistem.length} já existe${jaExistem.length !== 1 ? "m" : ""} — ${comPrazoNovo} com prazo para atualizar`
        : `${jaExistem.length} já existe${jaExistem.length !== 1 ? "m" : ""} no organizador`;
      jaExistem.forEach(({ c, match }) => {
        const atualizavel = c.deadline != null;
        const row = document.createElement("div");
        row.className = "import-case-row import-case-row--existing";
        row.innerHTML = `
          ${atualizavel
            ? `<input type="checkbox" checked style="flex-shrink:0;accent-color:var(--clr-primary);width:16px;height:16px;" title="Atualizar o prazo deste caso" />`
            : `<span style="width:16px;flex-shrink:0;">—</span>`}
          <span class="import-case-row__fap">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome || match.nome)}</span>
          ${atualizavel
            ? `<span style="font-size:11px;color:var(--clr-text-muted);margin-left:auto;">⏳ ${fmtCountdown(c.deadline)?.text ?? ""}</span>`
            : ""}`;
        row.dataset.id = match.id;
        if (atualizavel) row.dataset.deadline = c.deadline;
        existingList.appendChild(row);
      });
    } else {
      existingSection.hidden = true;
    }

    // Sobrando — ativos no organizador ausentes da lista importada.
    if (sobrando.length > 0) {
      sobrandoSection.hidden = false;
      sobrandoLabel.textContent =
        `${sobrando.length} no organizador fora da lista${sobrando.length !== 1 ? "" : ""}`;
      sobrando.forEach((c) => {
        const row = document.createElement("div");
        row.className = "import-case-row import-case-row--sobrando";
        row.innerHTML = `
          <input type="checkbox" style="flex-shrink:0;accent-color:#dc2626;width:16px;height:16px;" title="Excluir este caso" />
          <span class="import-case-row__fap">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>
          <span style="font-size:11px;color:#b91c1c;margin-left:auto;">excluir</span>`;
        row.dataset.id = c.id;
        sobrandoList.appendChild(row);
      });
    } else {
      sobrandoSection.hidden = true;
    }

    // Há algo a fazer? (novos, prazos a atualizar, reaberturas ou exclusões)
    confirmBtn.disabled = !(novos.length || provaveis.length || reaberturas.length ||
      comPrazoNovo || sobrando.length);
    confirmBtn.textContent = "Aplicar selecionados";

    showStep(stepResults);
  }

  // Back to upload
  document.getElementById("import-results-back").addEventListener("click", () => showStep(stepChoose));

  // Confirm import
  confirmBtn.addEventListener("click", async () => {
    const checked = [
      ...newList.querySelectorAll(".import-case-row input:checked"),
      ...probableList.querySelectorAll(".import-case-row input:checked"),
    ];
    const reopenChecked   = [...reopenList.querySelectorAll(".import-case-row input:checked")];
    const prazoChecked    = [...existingList.querySelectorAll(".import-case-row input:checked")];
    const sobrandoChecked = [...sobrandoList.querySelectorAll(".import-case-row input:checked")];
    if (!checked.length && !reopenChecked.length && !prazoChecked.length && !sobrandoChecked.length) {
      showToast("Nenhum caso selecionado.", "error");
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Aplicando…";

    try {
      const maxOrder = allCases
        .filter((c) => !c.liberado)
        .reduce((m, c) => Math.max(m, c.listOrder ?? c.sortOrder ?? 0), 0);

      let order = maxOrder;

      // Reaberturas — reabre caso liberado com a nova FAP, preservando dados clínicos
      for (const chk of reopenChecked) {
        const r     = chk.closest(".import-case-row");
        const match = allCases.find((c) => c.id === r.dataset.matchId);
        if (!match) continue;
        order += 1000;
        const text   = `Caso reaberto com nova FAP ${r.dataset.fap}`;
        const newLog = [...getLog(match), { text, ts: Date.now() }];
        const upd = {
          fap:         r.dataset.fap,
          liberado:    false,
          checked:     false,
          status:      "nao-visto",
          resumoLog:   newLog,
          resumoLinha: text,
          listOrder:   order,
          updatedAt:   serverTimestamp(),
        };
        if (r.dataset.deadline) upd.deadline = Number(r.dataset.deadline);
        if (r.dataset.uf)       upd.uf = r.dataset.uf;
        await updateDoc(caseDoc(match.id), upd);
      }

      // Casos novos
      for (const chk of checked) {
        const r = chk.closest(".import-case-row");
        order += 1000;
        const doc = {
          nome:        r.dataset.nome,
          fap:         r.dataset.fap,
          status:      "nao-visto",
          liberado:    false,
          resumoLinha: "",
          resumo:      "",
          listOrder:   order,
          createdAt:   serverTimestamp(),
          updatedAt:   serverTimestamp(),
        };
        if (r.dataset.deadline) doc.deadline = Number(r.dataset.deadline);
        if (r.dataset.uf)       doc.uf = r.dataset.uf;
        await addDoc(casesCol(), doc);
      }

      // Casos que já existiam: só o prazo é tocado, nada mais.
      for (const chk of prazoChecked) {
        const r = chk.closest(".import-case-row");
        if (!r.dataset.id || !r.dataset.deadline) continue;
        await updateDoc(caseDoc(r.dataset.id), {
          deadline:  Number(r.dataset.deadline),
          updatedAt: serverTimestamp(),
        });
      }

      // Sobrando marcados — exclusão em lote.
      if (sobrandoChecked.length) {
        const batch = writeBatch(db);
        sobrandoChecked.forEach((chk) => batch.delete(caseDoc(chk.closest(".import-case-row").dataset.id)));
        await batch.commit();
      }

      closeModal();
      const partes = [];
      if (checked.length) partes.push(`${checked.length} importado${checked.length !== 1 ? "s" : ""}`);
      if (reopenChecked.length) partes.push(`${reopenChecked.length} reaberto${reopenChecked.length !== 1 ? "s" : ""}`);
      if (prazoChecked.length) partes.push(`${prazoChecked.length} prazo${prazoChecked.length !== 1 ? "s" : ""} atualizado${prazoChecked.length !== 1 ? "s" : ""}`);
      if (sobrandoChecked.length) partes.push(`${sobrandoChecked.length} excluído${sobrandoChecked.length !== 1 ? "s" : ""}`);
      showToast(partes.join(", ") + ".");
    } catch (err) {
      showToast("Erro ao importar: " + err.message, "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Aplicar selecionados";
    }
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Importação direta por URL ──────────────────────────────────────────────
  // O script do Motion abre  …/#motion=<JSON em base64>  e a tela já vem com o
  // comparativo pronto. Nada é gravado sem o clique em "Aplicar selecionados".
  function base64ParaTexto(b64) {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function lerImportacaoDaUrl() {
    const m = /[#&]motion=([^&]+)/.exec(location.hash);
    if (!m) return;

    // Limpa a URL antes de processar: evita reimportar num F5.
    history.replaceState(null, "", location.pathname + location.search);

    let texto;
    try {
      texto = base64ParaTexto(decodeURIComponent(m[1]));
    } catch {
      showToast("Não consegui ler os dados enviados pelo Motion.", "error");
      return;
    }
    // Espera os casos existentes chegarem — sem eles tudo pareceria novo.
    quandoCasosCarregarem(() => processarJson(texto));
  }

  lerImportacaoDaUrl();
  window.addEventListener("hashchange", lerImportacaoDaUrl);
})();

// ─── Sort modal ──────────────────────────────────────────────────────────────
const sortModal       = document.getElementById("sort-modal");
const sortStepChoose  = document.getElementById("sort-step-choose");
const sortStepType    = document.getElementById("sort-step-type");
const reorderConfirmBtn = document.getElementById("reorder-confirm-btn");
const reorderCancelBtn  = document.getElementById("reorder-cancel-btn");

document.getElementById("sort-open-btn").addEventListener("click", () => {
  sortStepChoose.hidden = false;
  sortStepType.hidden   = true;
  sortModal.hidden = false;
});
document.getElementById("sort-modal-close").addEventListener("click", () => { sortModal.hidden = true; });
sortModal.addEventListener("click", (e) => { if (e.target === sortModal) sortModal.hidden = true; });

// ── Option 1: sort by print
document.getElementById("sort-opt-print").addEventListener("click", async () => {
  sortModal.hidden = true;
  if (!lastPrintOrder.length) { showToast("Nenhum print importado ainda.", "error"); return; }
  const open = allCases.filter((c) => !c.liberado);
  const printIdx = (c) => { const i = lastPrintOrder.indexOf(normFap(c.fap)); return i === -1 ? Infinity : i; };
  const matched = open.filter((c) => printIdx(c) !== Infinity);
  const sorted  = [...open].sort((a, b) => printIdx(a) - printIdx(b));
  try {
    const batch = writeBatch(db);
    sorted.forEach((c, i) => batch.update(caseDoc(c.id), { listOrder: (i + 1) * 1000 }));
    await batch.commit();
    const notFound = lastPrintOrder.filter((fap) => !open.some((c) => normFap(c.fap) === fap));
    if (notFound.length) {
      showToast(`Reordenado. ${matched.length} alinhados. ${notFound.length} FAPs não encontradas.`, "warning");
    } else {
      showToast(`Casos reordenados conforme o print (${matched.length} casos).`);
    }
  } catch (err) { showToast("Erro ao reordenar: " + err.message, "error"); }
});

// ── Option 4: sort by prazo (deadline ascending; no deadline goes last)
document.getElementById("sort-opt-prazo").addEventListener("click", async () => {
  sortModal.hidden = true;
  const open = allCases.filter((c) => !c.liberado);
  const sorted = [...open].sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
  if (!sorted.some((c) => c.deadline)) { showToast("Nenhum caso tem prazo definido.", "error"); return; }
  try {
    const batch = writeBatch(db);
    sorted.forEach((c, i) => batch.update(caseDoc(c.id), { listOrder: (i + 1) * 1000 }));
    await batch.commit();
    showToast("Casos ordenados por prazo.");
  } catch (err) { showToast("Erro ao ordenar: " + err.message, "error"); }
});

// ── Option 2: click-to-reorder
function enterReorderMode() {
  sortModal.hidden = true;
  reorderMode  = true;
  reorderQueue = [];
  document.getElementById("sort-open-btn").hidden = true;
  reorderConfirmBtn.hidden = false;
  reorderCancelBtn.hidden  = false;
  caseListEl.classList.add("reorder-mode");
  render();
}
function exitReorderMode() {
  reorderMode  = false;
  reorderQueue = [];
  document.getElementById("sort-open-btn").hidden = false;
  reorderConfirmBtn.hidden = true;
  reorderCancelBtn.hidden  = true;
  caseListEl.classList.remove("reorder-mode");
  render();
}
document.getElementById("sort-opt-click").addEventListener("click", enterReorderMode);
reorderCancelBtn.addEventListener("click", exitReorderMode);
reorderConfirmBtn.addEventListener("click", async () => {
  const open = allCases.filter((c) => !c.liberado);
  const unclicked = open.filter((c) => !reorderQueue.includes(c.id))
                        .sort((a, b) => (a.listOrder ?? 0) - (b.listOrder ?? 0));
  const ordered = [...reorderQueue.map((id) => open.find((c) => c.id === id)).filter(Boolean), ...unclicked];
  try {
    const batch = writeBatch(db);
    ordered.forEach((c, i) => batch.update(caseDoc(c.id), { listOrder: (i + 1) * 1000 }));
    await batch.commit();
    showToast("Ordem salva.");
  } catch (err) { showToast("Erro ao salvar ordem: " + err.message, "error"); }
  exitReorderMode();
});

// ─── Bulk delete (selection mode) ─────────────────────────────────────────────
const selectModeBtn   = document.getElementById("select-mode-btn");
const selectDeleteBtn = document.getElementById("select-delete-btn");
const selectCancelBtn = document.getElementById("select-cancel-btn");

function updateSelectDeleteBtn() {
  selectDeleteBtn.textContent = `Excluir selecionados (${selectedIds.size})`;
  selectDeleteBtn.disabled = selectedIds.size === 0;
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  selectModeBtn.hidden   = true;
  selectDeleteBtn.hidden = false;
  selectCancelBtn.hidden = false;
  caseListEl.classList.add("select-mode");
  updateSelectDeleteBtn();
  render();
}
function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  selectModeBtn.hidden   = false;
  selectDeleteBtn.hidden = true;
  selectCancelBtn.hidden = true;
  caseListEl.classList.remove("select-mode");
  render();
}
selectModeBtn.addEventListener("click", enterSelectMode);
selectCancelBtn.addEventListener("click", exitSelectMode);

selectDeleteBtn.addEventListener("click", () => {
  if (!selectedIds.size) return;
  pendingBulkDelete = [...selectedIds];
  deleteModalMsg.textContent = `Excluir ${pendingBulkDelete.length} caso${pendingBulkDelete.length !== 1 ? "s" : ""} selecionado${pendingBulkDelete.length !== 1 ? "s" : ""}? Esta ação não pode ser desfeita.`;
  deleteModal.hidden = false;
});

// ── Option 3: type-to-order
let typeQueue = [];          // IDs in order selected by typing
const typeAddedNames = {};   // id -> nome for cases created inside this mode

function openTypeMode() {
  sortStepChoose.hidden = true;
  sortStepType.hidden   = false;
  typeQueue = [];
  renderTypeQueue();
  renderTypeSuggestions("");
  setTimeout(() => document.getElementById("sort-type-input").focus(), 50);
}

function renderTypeQueue() {
  const el = document.getElementById("sort-type-queue");
  const open = allCases.filter((c) => !c.liberado);
  if (!typeQueue.length) {
    el.innerHTML = `<span style="font-size:12px;color:#94a3b8;">Nenhum caso selecionado ainda</span>`;
    return;
  }
  el.innerHTML = typeQueue.map((id, i) => {
    const c = open.find((x) => x.id === id);
    const nome = c?.nome ?? typeAddedNames[id] ?? id;
    return `<span class="type-queue-chip">${i + 1}. ${escHtml(nome)}</span>`;
  }).join("");
}

// Add a brand-new case and drop it straight into the order queue
async function addNewCaseToQueue() {
  const nomeEl = document.getElementById("sort-add-nome");
  const fapEl  = document.getElementById("sort-add-fap");
  const nome = nomeEl.value.trim();
  const fap  = fapEl.value.trim();
  if (!nome || !fap) { showToast("Preencha nome e FAP.", "error"); return; }
  try {
    const ref = await addDoc(casesCol(), {
      nome, fap,
      status:      "nao-visto",
      liberado:    false,
      resumoLinha: "",
      resumo:      "",
      resumoLog:   [],
      listOrder:   0,   // definido no confirmar
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
    typeAddedNames[ref.id] = nome;
    typeQueue.push(ref.id);
    nomeEl.value = "";
    fapEl.value  = "";
    renderTypeQueue();
    renderTypeSuggestions(document.getElementById("sort-type-input").value);
    nomeEl.focus();
  } catch (err) {
    showToast("Erro ao adicionar: " + err.message, "error");
  }
}

document.getElementById("sort-add-btn").addEventListener("click", addNewCaseToQueue);
document.getElementById("sort-add-fap").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addNewCaseToQueue(); }
});

function renderTypeSuggestions(query) {
  const el   = document.getElementById("sort-type-suggestions");
  const open = allCases.filter((c) => !c.liberado && !typeQueue.includes(c.id));
  const q    = query.trim().toLowerCase();
  const matches = q
    ? open.filter((c) =>
        (c.nome ?? "").toLowerCase().includes(q) ||
        (c.fap  ?? "").replace(/\./g, "").includes(q.replace(/\./g, ""))
      )
    : open;

  if (!matches.length) {
    el.innerHTML = `<div style="padding:10px 12px;font-size:13px;color:#94a3b8;">${q ? "Nenhum caso encontrado." : "Todos os casos já foram selecionados."}</div>`;
    return;
  }
  el.innerHTML = matches.map((c, i) => `
    <div class="type-suggestion${i === 0 ? " type-suggestion--first" : ""}" data-id="${c.id}" style="padding:8px 12px;cursor:pointer;font-size:13px;display:flex;gap:10px;align-items:center;${i > 0 ? "border-top:1px solid #f1f5f9;" : ""}">
      <span style="font-weight:700;color:var(--clr-primary);min-width:110px;">${escHtml(c.fap)}</span>
      <span>${escHtml(c.nome)}</span>
    </div>`).join("");

  el.querySelectorAll(".type-suggestion").forEach((div) => {
    div.addEventListener("click", () => selectTypeCase(div.dataset.id));
    div.addEventListener("mouseenter", () => {
      el.querySelectorAll(".type-suggestion").forEach((d) => d.classList.remove("type-suggestion--first"));
      div.classList.add("type-suggestion--first");
    });
  });
}

function selectTypeCase(id) {
  typeQueue.push(id);
  const input = document.getElementById("sort-type-input");
  input.value = "";
  renderTypeQueue();
  renderTypeSuggestions("");
  input.focus();
}

document.getElementById("sort-opt-type").addEventListener("click", openTypeMode);

document.getElementById("sort-type-input").addEventListener("input", (e) => {
  renderTypeSuggestions(e.target.value);
});

document.getElementById("sort-type-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = document.querySelector(".type-suggestion--first");
    if (first) selectTypeCase(first.dataset.id);
  }
});

document.getElementById("sort-type-undo").addEventListener("click", () => {
  if (!typeQueue.length) return;
  typeQueue.pop();
  renderTypeQueue();
  renderTypeSuggestions(document.getElementById("sort-type-input").value);
  document.getElementById("sort-type-input").focus();
});

document.getElementById("sort-type-cancel").addEventListener("click", () => { sortModal.hidden = true; });

document.getElementById("sort-type-confirm").addEventListener("click", async () => {
  const open = allCases.filter((c) => !c.liberado);
  const unselectedIds = open.filter((c) => !typeQueue.includes(c.id))
                            .sort((a, b) => (a.listOrder ?? 0) - (b.listOrder ?? 0))
                            .map((c) => c.id);
  // typeQueue ids first (includes freshly-added cases not yet in allCases), then the rest
  const orderedIds = [...typeQueue, ...unselectedIds];
  try {
    const batch = writeBatch(db);
    orderedIds.forEach((id, i) => batch.update(caseDoc(id), { listOrder: (i + 1) * 1000 }));
    await batch.commit();
    showToast("Ordem salva.");
  } catch (err) { showToast("Erro ao salvar ordem: " + err.message, "error"); }
  sortModal.hidden = true;
});

function normFap(fap) {
  return (fap ?? "").trim().replace(/\./g, "").toUpperCase();
}

// ─── Clear all checkmarks ────────────────────────────────────────────────────
document.getElementById("clear-checks-btn").addEventListener("click", async () => {
  const checked = allCases.filter((c) => !c.liberado && c.checked);
  if (!checked.length) { showToast("Nenhum caso marcado.", "error"); return; }
  try {
    const batch = writeBatch(db);
    checked.forEach((c) => batch.update(caseDoc(c.id), { checked: false, checkedAt: null }));
    await batch.commit();
    showToast(`${checked.length} OK${checked.length !== 1 ? "s" : ""} removido${checked.length !== 1 ? "s" : ""}.`);
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
});

// ─── Export modal ────────────────────────────────────────────────────────────
const exportModal = document.getElementById("export-modal");
document.getElementById("export-open-btn").addEventListener("click", () => { exportModal.hidden = false; });
document.getElementById("export-modal-close").addEventListener("click", () => { exportModal.hidden = true; });
exportModal.addEventListener("click", (e) => { if (e.target === exportModal) exportModal.hidden = true; });
document.getElementById("export-opt-img").addEventListener("click", () => { exportModal.hidden = true; exportImage(); });
document.getElementById("export-opt-list").addEventListener("click", () => { exportModal.hidden = true; exportWhatsappList(); });
document.getElementById("export-opt-report").addEventListener("click", () => { exportModal.hidden = true; exportWhatsappReport(); });

// ─── Export image ────────────────────────────────────────────────────────────
function exportImage() {
  // Collect visible open cases in current order
  const rows = [...document.querySelectorAll("#case-list .list-row")];
  const items = rows.map((row) => {
    const id = row.dataset.id;
    const c  = allCases.find((x) => x.id === id);
    return c ?? null;
  }).filter(Boolean);

  if (items.length === 0) { showToast("Nenhum caso para exportar.", "error"); return; }

  const SCALE  = 2;
  const PAD    = 32;
  const ROW_H  = 38;         // minimum row height
  const LINE_H = 16;         // extra height per additional wrapped line
  const HDR_H  = 56;
  const FOOT_H = 32;
  const W      = 900;

  const COLS = [
    { label: "",         x: PAD,       w: 22  },
    { label: "FAP",      x: PAD + 30,  w: 130 },
    { label: "Paciente", x: PAD + 170, w: 260 },
    { label: "Resumo",   x: PAD + 440, w: W - PAD - 440 - PAD },
  ];

  // Measure text wrapping on a temp canvas
  const tmpCanvas = document.createElement("canvas");
  const tmpCtx    = tmpCanvas.getContext("2d");
  tmpCtx.font = "13px Inter, system-ui, sans-serif";

  function wrapText(ctx2, text, maxW) {
    if (!text) return [];
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx2.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Pre-compute wrapped lines and row heights
  const rowData = items.map((c) => {
    tmpCtx.font = "13px Inter, system-ui, sans-serif";
    const lines  = wrapText(tmpCtx, c.resumoLinha || "", COLS[3].w);
    const height = Math.max(ROW_H, ROW_H + (lines.length - 1) * LINE_H);
    return { c, lines, height };
  });

  const totalRowH = rowData.reduce((s, r) => s + r.height, 0);
  const H = HDR_H + totalRowH + FOOT_H + PAD;

  const canvas  = document.createElement("canvas");
  canvas.width  = W  * SCALE;
  canvas.height = H  * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  // ── background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ── header bar
  ctx.fillStyle = "#1e40af";
  ctx.fillRect(0, 0, W, HDR_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.fillText("🔬  Organizador de Casos — Patologia", PAD, 24);
  ctx.font = "13px Inter, system-ui, sans-serif";
  const dateStr = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" });
  ctx.fillText(dateStr, PAD, 44);

  // ── column headers
  const HDR_Y = HDR_H + 10;
  ctx.fillStyle = "#64748b";
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  COLS.forEach((col) => {
    if (col.label) ctx.fillText(col.label.toUpperCase(), col.x, HDR_Y);
  });

  // ── separator line
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HDR_H + 20);
  ctx.lineTo(W - PAD, HDR_H + 20);
  ctx.stroke();

  // ── rows
  const STATUS_COLORS = {
    "nao-visto": { bar: "#94a3b8", bg: null },
    "visto":     { bar: "#fbbf24", bg: "#fef9c3" },
    "laudado":   { bar: "#16a34a", bg: "#bbf7d0" },
    "parcial":   { bar: "#f97316", bg: "#fed7aa" },
    "pendencia": { bar: "#dc2626", bg: "#fee2e2" },
    "outros":    { bar: "#93c5fd", bg: "#dbeafe" },
  };

  let curY = HDR_H + 26;
  rowData.forEach(({ c, lines, height }, i) => {
    const y      = curY;
    const isEven = i % 2 === 0;
    const sc     = STATUS_COLORS[c.status] ?? STATUS_COLORS["nao-visto"];

    // row background — use status color if defined, else zebra
    ctx.fillStyle = sc.bg ?? (isEven ? "#f8fafc" : "#ffffff");
    ctx.fillRect(PAD - 8, y - 14, W - (PAD - 8) * 2, height);

    // status left bar
    ctx.fillStyle = sc.bar;
    ctx.fillRect(PAD - 8, y - 14, 4, height);

    // check mark
    if (c.checked) {
      ctx.fillStyle = "#16a34a";
      ctx.beginPath();
      ctx.arc(COLS[0].x + 7, y - 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      ctx.fillText("✓", COLS[0].x + 3, y + 2);
    } else {
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(COLS[0].x + 7, y - 2, 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // FAP
    ctx.fillStyle = "#2563eb";
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    ctx.fillText(c.fap ?? "", COLS[1].x, y + 2);

    // Nome
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText(clip(c.nome, 30), COLS[2].x, y + 2);

    // Resumo em uma linha — wrapped, vermelho se pendência
    if (lines.length > 0) {
      ctx.fillStyle = c.status === "pendencia" ? "#991b1b" : "#334155";
      ctx.font = c.status === "pendencia"
        ? "italic 13px Inter, system-ui, sans-serif"
        : "13px Inter, system-ui, sans-serif";
      lines.forEach((line, li) => {
        ctx.fillText(line, COLS[3].x, y + 2 + li * LINE_H);
      });
    }

    // bottom rule
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD - 8, y + height - 14);
    ctx.lineTo(W - PAD + 8, y + height - 14);
    ctx.stroke();

    curY += height;
  });

  // ── footer
  const footY = curY + 16;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText(`${items.length} caso${items.length !== 1 ? "s" : ""} em aberto`, PAD, footY);

  // ── download
  const link = document.createElement("a");
  link.download = `casos-${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// ─── WhatsApp list ───────────────────────────────────────────────────────────
function exportWhatsappList() {
  const rows   = [...document.querySelectorAll("#case-list .list-row")];
  const items  = rows.map((row) => allCases.find((x) => x.id === row.dataset.id)).filter(Boolean);

  if (items.length === 0) { showToast("Nenhum caso para exportar.", "error"); return; }

  const STATUS_LABEL = {
    "nao-visto": "não visto",
    "visto":     "visto mas não laudado",
    "laudado":   "laudado",
    "parcial":   "parcialmente montado",
    "pendencia": "pendência",
    "outros":    "outros",
  };

  const lines = items.map((c, i) => {
    const fap    = c.fap ?? "";
    const nome   = c.nome ?? "";
    const update = lastLogText(c) ?? "";
    const status = c.status ?? "nao-visto";

    const partes = [fap, nome];
    if (update) partes.push(update);

    let linha = partes.join(" - ");

    if (status === "laudado") {
      linha = `*${linha}* ✅`;
    } else if (status === "pendencia") {
      linha = `${linha} ❗`;
    } else if (status === "visto") {
      linha = `${linha} 🟨 — visto mas não laudado`;
    } else if (status === "parcial") {
      linha = `${linha} 🟨 — parcialmente montado`;
    } else if (status !== "nao-visto") {
      linha = `${linha} — ${STATUS_LABEL[status] ?? status}`;
    }

    return `${i + 1}. ${linha}`;
  });

  const texto = lines.join("\n");

  navigator.clipboard.writeText(texto).then(() => {
    showToast("Lista copiada! Cole no WhatsApp.");
  }).catch(() => {
    // fallback: open in a textarea for manual copy
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80vw;height:60vh;z-index:9999;padding:12px;font-size:13px;border-radius:8px;border:1px solid #cbd5e1;";
    document.body.appendChild(ta);
    ta.select();
    const close = (e) => { if (e.target !== ta) { ta.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 100);
    showToast("Copie o texto da caixa que abriu.", "warning");
  });
}

// ─── WhatsApp report ─────────────────────────────────────────────────────────
function exportWhatsappReport() {
  const rows  = [...document.querySelectorAll("#case-list .list-row")];
  const items = rows.map((row) => allCases.find((x) => x.id === row.dataset.id)).filter(Boolean);

  if (items.length === 0) { showToast("Nenhum caso para exportar.", "error"); return; }

  const prontos   = items.filter((c) => c.status === "laudado");
  const pendencia = items.filter((c) => c.status === "pendencia");
  const duvida    = items.filter((c) => !["laudado", "pendencia"].includes(c.status));

  function linhaCase(c) {
    const partes = [c.fap ?? "", c.nome ?? ""];
    const upd = lastLogText(c);
    if (upd) partes.push(upd);
    return partes.join(" - ");
  }

  const resumoParts = [];
  if (prontos.length)   resumoParts.push(`${prontos.length} prontos pra liberação`);
  if (pendencia.length) resumoParts.push(`${pendencia.length} com pendência`);
  if (duvida.length)    resumoParts.push(`${duvida.length} em dúvida`);

  const linhas = [];
  linhas.push(`${items.length} casos no monitor.`);
  linhas.push(resumoParts.join(" - "));

  if (prontos.length) {
    linhas.push("");
    linhas.push("*Prontos pra liberação:*");
    prontos.forEach((c) => linhas.push(linhaCase(c)));
  }
  if (pendencia.length) {
    linhas.push("");
    linhas.push("*Com pendência:*");
    pendencia.forEach((c) => linhas.push(linhaCase(c) + " ❗"));
  }
  if (duvida.length) {
    linhas.push("");
    linhas.push("*Em dúvida:*");
    duvida.forEach((c) => linhas.push(linhaCase(c)));
  }

  const texto = linhas.join("\n");
  navigator.clipboard.writeText(texto).then(() => {
    showToast("Relatório copiado! Cole no WhatsApp.");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80vw;height:60vh;z-index:9999;padding:12px;font-size:13px;border-radius:8px;border:1px solid #cbd5e1;";
    document.body.appendChild(ta);
    ta.select();
    const close = (e) => { if (e.target !== ta) { ta.remove(); document.removeEventListener("click", close); } };
    setTimeout(() => document.addEventListener("click", close), 100);
    showToast("Copie o texto da caixa que abriu.", "warning");
  });
}

function clip(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Countdown até o prazo (deadline em ms). Retorna {text, level} ou null.
function fmtCountdown(deadline) {
  if (!deadline) return null;
  const diff = deadline - Date.now();
  if (diff <= 0) return { text: "Vencido", level: "vencido" };
  const mins = Math.floor(diff / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  let text;
  if (d > 0)      text = `${d}d ${h}h`;
  else if (h > 0) text = `${h}h ${m}m`;
  else            text = `${m}m`;
  const level = d >= 2 ? "ok" : (d >= 1 ? "warn" : "urgent");
  return { text, level };
}

function fmtStamp(ts) {
  if (!ts) return "";
  const d = new Date(ts.seconds * 1000);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dm = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${hm} ${dm}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Live countdown refresh — atualiza os chips de prazo a cada minuto ─────────
setInterval(() => {
  document.querySelectorAll("#case-list .list-row").forEach((row) => {
    const c    = allCases.find((x) => x.id === row.dataset.id);
    const chip = row.querySelector(".prazo-chip");
    if (c && c.deadline && chip) {
      const cd = fmtCountdown(c.deadline);
      chip.textContent = `⏳ ${cd.text}`;
      chip.className = `prazo-chip prazo-chip--${cd.level}`;
    }
  });
}, 60000);
