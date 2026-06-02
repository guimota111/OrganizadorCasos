import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── State ────────────────────────────────────────────────────────────────────
let allCases = [];
let editingId = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const form = document.getElementById("case-form");
const formTitle = document.getElementById("form-title");
const cancelEditBtn = document.getElementById("cancel-edit");
const statusRadios = document.querySelectorAll('input[name="status"]');
const pendenciaGroup = document.getElementById("pendencia-group");
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const aSerVistoList = document.getElementById("a-ser-visto-list");
const encaminhadoList = document.getElementById("encaminhado-list");
const terceirizadoList = document.getElementById("terceirizado-list");
const pendenciaList = document.getElementById("pendencia-list");
const releasedList = document.getElementById("released-list");
const emptyASerVisto = document.getElementById("empty-a-ser-visto");
const emptyEncaminhado = document.getElementById("empty-encaminhado");
const emptyTerceirizado = document.getElementById("empty-terceirizado");
const emptyPendencia = document.getElementById("empty-pendencia");
const emptyReleased = document.getElementById("empty-released");
const cntTotal = document.getElementById("cnt-total");
const cntASerVisto = document.getElementById("cnt-a-ser-visto");
const cntPendencia = document.getElementById("cnt-pendencia");
const cntEncaminhado = document.getElementById("cnt-encaminhado");
const cntTerceirizado = document.getElementById("cnt-terceirizado");
const cntLiberado = document.getElementById("cnt-liberado");
const toast = document.getElementById("toast");
const deleteModal = document.getElementById("delete-modal");
const deleteModalMsg = document.getElementById("delete-modal-msg");
const confirmDeleteBtn = document.getElementById("confirm-delete");
const cancelDeleteBtn = document.getElementById("cancel-delete");
let pendingDeleteId = null;

// ─── Tabs ─────────────────────────────────────────────────────────────────────
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ─── Status toggle ────────────────────────────────────────────────────────────
statusRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    pendenciaGroup.hidden = radio.value !== "pendencia";
    if (radio.value !== "pendencia") {
      document.getElementById("pendencia-desc").value = "";
    }
  });
});

// ─── Form submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("nome").value.trim();
  const fap = document.getElementById("fap").value.trim();
  const resumo = document.getElementById("resumo").value.trim();
  const status = document.querySelector('input[name="status"]:checked').value;
  const pendenciaDesc =
    status === "pendencia"
      ? document.getElementById("pendencia-desc").value.trim()
      : "";

  if (!nome || !fap) {
    showToast("Preencha nome e FAP.", "error");
    return;
  }

  const payload = { nome, fap, resumo, status, pendenciaDesc };

  try {
    if (editingId) {
      await updateDoc(doc(db, "casos", editingId), payload);
      showToast("Caso atualizado.");
      cancelEdit();
    } else {
      // New cases go to the bottom of their column
      const group = allCases.filter((c) => !c.liberado && c.status === status);
      const maxOrder = group.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);
      payload.createdAt = serverTimestamp();
      payload.liberado = false;
      payload.sortOrder = maxOrder + 1000;
      await addDoc(collection(db, "casos"), payload);
      showToast("Caso cadastrado.");
    }
    form.reset();
    pendenciaGroup.hidden = true;
  } catch (err) {
    showToast("Erro ao salvar: " + err.message, "error");
  }
});

cancelEditBtn.addEventListener("click", cancelEdit);

function cancelEdit() {
  editingId = null;
  formTitle.textContent = "Novo Caso";
  cancelEditBtn.hidden = true;
  form.reset();
  pendenciaGroup.hidden = true;
}

// ─── Firestore listener ───────────────────────────────────────────────────────
const q = query(collection(db, "casos"), orderBy("createdAt", "desc"));
onSnapshot(q, (snapshot) => {
  allCases = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const open = allCases.filter((c) => !c.liberado);
  const released = allCases.filter((c) => c.liberado);
  const sorted = (status) =>
    open
      .filter((c) => c.status === status)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const aSerVistos    = sorted("a-ser-visto");
  const encaminhados  = sorted("encaminhado");
  const terceirizados = sorted("terceirizado");
  const pendencias    = sorted("pendencia");

  cntTotal.textContent        = allCases.length;
  cntASerVisto.textContent    = aSerVistos.length;
  cntEncaminhado.textContent  = encaminhados.length;
  cntTerceirizado.textContent = terceirizados.length;
  cntPendencia.textContent    = pendencias.length;
  cntLiberado.textContent     = released.length;

  document.getElementById("badge-open").textContent     = open.length;
  document.getElementById("badge-released").textContent = released.length;

  renderColumn(aSerVistoList,    emptyASerVisto,    aSerVistos);
  renderColumn(encaminhadoList,  emptyEncaminhado,  encaminhados);
  renderColumn(terceirizadoList, emptyTerceirizado, terceirizados);
  renderColumn(pendenciaList,    emptyPendencia,    pendencias);
  renderList(releasedList, emptyReleased, released);
}

function renderColumn(container, emptyEl, cases) {
  container.innerHTML = "";
  emptyEl.hidden = cases.length > 0;
  cases.forEach((c) => container.appendChild(buildCard(c, false)));
  initDrag(container);
}

function renderList(container, emptyEl, cases) {
  container.innerHTML = "";
  emptyEl.hidden = cases.length > 0;
  cases.forEach((c) => container.appendChild(buildCard(c, true)));
}

// ─── Card builder ─────────────────────────────────────────────────────────────
function buildCard(c, isReleased) {
  const card = document.createElement("article");
  card.className = "card" + (isReleased ? " card--released" : "");
  if (!isReleased && c.status === "pendencia")    card.classList.add("card--pendencia");
  if (!isReleased && c.status === "a-ser-visto")  card.classList.add("card--a-ser-visto");
  if (!isReleased && c.status === "terceirizado") card.classList.add("card--terceirizado");
  card.setAttribute("draggable", isReleased ? "false" : "true");
  card.dataset.id = c.id;

  const statusBadge = isReleased
    ? `<span class="badge badge--liberado">Liberado</span>`
    : c.status === "a-ser-visto"
    ? `<span class="badge badge--a-ser-visto">👁️ A ser visto</span>`
    : c.status === "encaminhado"
    ? `<span class="badge badge--encaminhado">✅ Encaminhado</span>`
    : c.status === "terceirizado"
    ? `<span class="badge badge--terceirizado">🔀 Terceirizado</span>`
    : `<span class="badge badge--pendencia">⏳ Pendência</span>`;

  card.innerHTML = `
    <header class="card__header">
      <div class="card__drag-handle" aria-hidden="true" title="Arrastar para reordenar">⠿</div>
      <div class="card__title-group">
        <span class="card__fap">${escHtml(c.fap)}</span>
        <h3 class="card__nome">${escHtml(c.nome)}</h3>
      </div>
      ${statusBadge}
    </header>
    ${c.resumo ? `<p class="card__resumo">${escHtml(c.resumo)}</p>` : ""}
    ${
      c.status === "pendencia" && c.pendenciaDesc && !isReleased
        ? `<div class="card__pendencia-desc"><strong>Pendência:</strong> ${escHtml(c.pendenciaDesc)}</div>`
        : ""
    }
    <div class="card__notes">
      <button class="card__notes-toggle" data-action="toggle-notes" data-id="${c.id}" aria-expanded="${c.notasPreceptor ? "true" : "false"}">
        📋 Anotações do preceptor${c.notasPreceptor ? ' <span class="notes-dot"></span>' : ""}
      </button>
      <div class="card__notes-body" ${c.notasPreceptor ? "" : "hidden"}>
        <textarea class="card__notes-textarea" placeholder="Anote aqui os comentários do preceptor..." data-id="${c.id}">${c.notasPreceptor ? escHtml(c.notasPreceptor) : ""}</textarea>
        <div class="card__notes-actions">
          <button class="btn btn--primary btn--sm" data-action="salvar-notas" data-id="${c.id}">Salvar anotações</button>
        </div>
      </div>
    </div>
    <footer class="card__actions">
      ${
        !isReleased
          ? `<button class="btn btn--primary btn--sm" data-action="liberar" data-id="${c.id}">Liberar caso</button>
             <button class="btn btn--ghost btn--sm" data-action="editar" data-id="${c.id}">Editar</button>`
          : ""
      }
      <button class="btn btn--ghost btn--sm btn--copy" data-action="copiar-fap" data-id="${c.id}" data-fap="${escHtml(c.fap)}" title="Copiar FAP">📋 ${escHtml(c.fap)}</button>
      <button class="btn btn--danger btn--sm" data-action="excluir" data-id="${c.id}" data-nome="${escHtml(c.nome)}">Excluir</button>
    </footer>`;

  card.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", handleCardAction);
  });

  return card;
}

// ─── Card actions ─────────────────────────────────────────────────────────────
async function handleCardAction(e) {
  const { action, id, nome } = e.currentTarget.dataset;

  if (action === "copiar-fap") {
    const { fap } = e.currentTarget.dataset;
    try {
      await navigator.clipboard.writeText(fap);
      const btn = e.currentTarget;
      btn.textContent = "✅ Copiado!";
      setTimeout(() => { btn.textContent = `📋 ${fap}`; }, 1500);
    } catch {
      showToast("Não foi possível copiar.", "error");
    }
  } else if (action === "toggle-notes") {
    const card = e.currentTarget.closest(".card");
    const body = card.querySelector(".card__notes-body");
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    e.currentTarget.setAttribute("aria-expanded", String(isHidden));
    if (isHidden) card.querySelector(".card__notes-textarea").focus();
  } else if (action === "salvar-notas") {
    const textarea = e.currentTarget.closest(".card__notes-body").querySelector("textarea");
    try {
      await updateDoc(doc(db, "casos", id), { notasPreceptor: textarea.value.trim() });
      showToast("Anotações salvas.");
    } catch (err) {
      showToast("Erro ao salvar: " + err.message, "error");
    }
  } else if (action === "liberar") {
    await updateDoc(doc(db, "casos", id), { liberado: true });
    showToast("Caso liberado.");
  } else if (action === "editar") {
    const c = allCases.find((x) => x.id === id);
    if (!c) return;
    editingId = id;
    formTitle.textContent = "Editar Caso";
    cancelEditBtn.hidden = false;
    document.getElementById("nome").value = c.nome;
    document.getElementById("fap").value = c.fap;
    document.getElementById("resumo").value = c.resumo || "";
    document.querySelector(`input[name="status"][value="${c.status}"]`).checked = true;
    pendenciaGroup.hidden = c.status !== "pendencia";
    document.getElementById("pendencia-desc").value = c.pendenciaDesc || "";
    document.getElementById("form-section").scrollIntoView({ behavior: "smooth" });
  } else if (action === "excluir") {
    pendingDeleteId = id;
    deleteModalMsg.textContent = `Excluir o caso de "${nome}"? Esta ação não pode ser desfeita.`;
    deleteModal.hidden = false;
  }
}

// ─── Drag-and-drop reordering ─────────────────────────────────────────────────
let dragSrcId = null;

function initDrag(container) {
  container.querySelectorAll(".card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", onDragStart);
    card.addEventListener("dragover", onDragOver);
    card.addEventListener("dragleave", onDragLeave);
    card.addEventListener("drop", onDrop);
    card.addEventListener("dragend", onDragEnd);
  });
}

function onDragStart(e) {
  dragSrcId = this.dataset.id;
  this.classList.add("card--dragging");
  e.dataTransfer.effectAllowed = "move";
  // Prevents Firefox from treating the card as a link drag
  e.dataTransfer.setData("text/plain", dragSrcId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (this.dataset.id !== dragSrcId) this.classList.add("card--drag-over");
}

function onDragLeave() {
  this.classList.remove("card--drag-over");
}

async function onDrop(e) {
  e.preventDefault();
  this.classList.remove("card--drag-over");
  const targetId = this.dataset.id;
  if (!dragSrcId || dragSrcId === targetId) return;

  // Collect ordered IDs from the DOM column, then swap src into target's position
  const container = this.closest(".card-list");
  const ids = [...container.querySelectorAll(".card[draggable='true']")].map(
    (c) => c.dataset.id
  );
  const srcIdx = ids.indexOf(dragSrcId);
  const tgtIdx = ids.indexOf(targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  ids.splice(srcIdx, 1);
  ids.splice(tgtIdx, 0, dragSrcId);

  // Persist new order — space by 1000 so future inserts don't collide
  const batch = writeBatch(db);
  ids.forEach((id, i) => {
    batch.update(doc(db, "casos", id), { sortOrder: (i + 1) * 1000 });
  });
  await batch.commit();
}

function onDragEnd() {
  document.querySelectorAll(".card--dragging, .card--drag-over").forEach((el) => {
    el.classList.remove("card--dragging", "card--drag-over");
  });
  dragSrcId = null;
}

// ─── Delete modal ─────────────────────────────────────────────────────────────
confirmDeleteBtn.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  try {
    await deleteDoc(doc(db, "casos", pendingDeleteId));
    showToast("Caso excluído.");
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
  pendingDeleteId = null;
  deleteModal.hidden = true;
});

cancelDeleteBtn.addEventListener("click", () => {
  pendingDeleteId = null;
  deleteModal.hidden = true;
});

deleteModal.addEventListener("click", (e) => {
  if (e.target === deleteModal) {
    pendingDeleteId = null;
    deleteModal.hidden = true;
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = "toast toast--" + type + " toast--visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
