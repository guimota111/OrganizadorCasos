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
const openList = document.getElementById("open-list");
const releasedList = document.getElementById("released-list");
const emptyOpen = document.getElementById("empty-open");
const emptyReleased = document.getElementById("empty-released");
const cntTotal = document.getElementById("cnt-total");
const cntPendencia = document.getElementById("cnt-pendencia");
const cntEncaminhado = document.getElementById("cnt-encaminhado");
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
      payload.createdAt = serverTimestamp();
      payload.liberado = false;
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

  // counters
  cntTotal.textContent = allCases.length;
  cntPendencia.textContent = open.filter((c) => c.status === "pendencia").length;
  cntEncaminhado.textContent = open.filter((c) => c.status === "encaminhado").length;
  cntLiberado.textContent = released.length;

  // tab badge
  document.getElementById("badge-open").textContent = open.length;
  document.getElementById("badge-released").textContent = released.length;

  renderList(openList, emptyOpen, open, false);
  renderList(releasedList, emptyReleased, released, true);
}

function renderList(container, emptyEl, cases, isReleased) {
  container.innerHTML = "";
  if (cases.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  cases.forEach((c) => container.appendChild(buildCard(c, isReleased)));
}

function buildCard(c, isReleased) {
  const card = document.createElement("article");
  card.className = "card" + (isReleased ? " card--released" : "");
  if (!isReleased && c.status === "pendencia") card.classList.add("card--pendencia");

  const statusBadge =
    isReleased
      ? `<span class="badge badge--liberado">Liberado</span>`
      : c.status === "pendencia"
      ? `<span class="badge badge--pendencia">⏳ Pendência</span>`
      : `<span class="badge badge--encaminhado">✅ Encaminhado</span>`;

  card.innerHTML = `
    <header class="card__header">
      <div class="card__title-group">
        <span class="card__fap">${escHtml(c.fap)}</span>
        <h3 class="card__nome">${escHtml(c.nome)}</h3>
      </div>
      ${statusBadge}
    </header>
    ${c.resumo ? `<p class="card__resumo">${escHtml(c.resumo)}</p>` : ""}
    ${
      !isReleased && c.status === "pendencia" && c.pendenciaDesc
        ? `<div class="card__pendencia-desc"><strong>Pendência:</strong> ${escHtml(c.pendenciaDesc)}</div>`
        : ""
    }
    <div class="card__notes">
      <button class="card__notes-toggle" data-action="toggle-notes" data-id="${c.id}" aria-expanded="${c.notasPreceptor ? 'true' : 'false'}">
        📋 Anotações do preceptor${c.notasPreceptor ? ' <span class="notes-dot"></span>' : ''}
      </button>
      <div class="card__notes-body" ${c.notasPreceptor ? '' : 'hidden'}>
        <textarea class="card__notes-textarea" placeholder="Anote aqui os comentários do preceptor..." data-id="${c.id}">${c.notasPreceptor ? escHtml(c.notasPreceptor) : ''}</textarea>
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
      <button class="btn btn--danger btn--sm" data-action="excluir" data-id="${c.id}" data-nome="${escHtml(c.nome)}">Excluir</button>
    </footer>`;

  card.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", handleCardAction);
  });

  return card;
}

async function handleCardAction(e) {
  const { action, id, nome } = e.currentTarget.dataset;

  if (action === "toggle-notes") {
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
