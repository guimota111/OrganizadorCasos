import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── State ────────────────────────────────────────────────────────────────────
let allCases    = [];
let allOpinioes = [];
let activeFilter = "all";

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const caseListEl    = document.getElementById("case-list");
const emptyList     = document.getElementById("empty-list");
const opiniaoListEl = document.getElementById("opiniao-list");
const emptyOpiniao  = document.getElementById("empty-opiniao-list");

// ─── Firestore listeners ──────────────────────────────────────────────────────
// Order by createdAt (field all docs have). listOrder is applied client-side
// so docs without it still appear, sorted to the end.
onSnapshot(query(collection(db, "casos"), orderBy("createdAt", "desc")), (snap) => {
  allCases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderCases();
});

onSnapshot(query(collection(db, "opinioes"), orderBy("createdAt", "desc")), (snap) => {
  allOpinioes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderOpinioes();
});

// ─── Render cases ─────────────────────────────────────────────────────────────
function renderCases() {
  const open = allCases
    .filter((c) => !c.liberado)
    .sort((a, b) => (a.listOrder ?? a.sortOrder ?? 0) - (b.listOrder ?? b.sortOrder ?? 0));

  updateFilterCounts(open);

  caseListEl.innerHTML = "";
  const visible = open.filter((c) => activeFilter === "all" || c.status === activeFilter);

  if (visible.length === 0) {
    emptyList.hidden = false;
    return;
  }
  emptyList.hidden = true;
  visible.forEach((c) => caseListEl.appendChild(buildRow(c, "casos")));
  initDrag(caseListEl, "casos");
}

function renderOpinioes() {
  const open = allOpinioes
    .filter((c) => !c.discutido)
    .sort((a, b) => (a.listOrder ?? a.sortOrder ?? 0) - (b.listOrder ?? b.sortOrder ?? 0));

  opiniaoListEl.innerHTML = "";
  if (open.length === 0) {
    emptyOpiniao.hidden = false;
    return;
  }
  emptyOpiniao.hidden = true;
  open.forEach((c) => opiniaoListEl.appendChild(buildRow(c, "opinioes")));
  initDrag(opiniaoListEl, "opinioes");
}

// ─── Build row ────────────────────────────────────────────────────────────────
function buildRow(c, collection) {
  const row = document.createElement("div");
  row.className = `list-row list-row--${c.status}`;
  row.setAttribute("draggable", "true");
  row.dataset.id  = c.id;
  row.dataset.col = collection;

  const statusBadge = {
    "a-ser-visto":  `<span class="badge badge--a-ser-visto">👁️ A ser visto</span>`,
    "encaminhado":  `<span class="badge badge--encaminhado">✅ Encaminhado</span>`,
    "terceirizado": `<span class="badge badge--terceirizado">🔀 Terceirizado</span>`,
    "pendencia":    `<span class="badge badge--pendencia">⏳ Pendência</span>`,
    "a-ver":        `<span class="badge badge--a-ser-visto">👁️ A ver</span>`,
  }[c.status] ?? "";

  row.innerHTML = `
    <div class="list-row__handle" title="Arrastar para reordenar">⠿</div>
    <div class="list-row__fap">${escHtml(c.fap)}</div>
    <div class="list-row__main">
      <div class="list-row__nome">${escHtml(c.nome)}</div>
    </div>
    ${statusBadge}
    <span class="list-row__chevron" aria-hidden="true">▾</span>
    <div class="list-row__detail" hidden>
      ${c.remetente ? `<p class="list-row__remetente">📨 Enviado por <strong>${escHtml(c.remetente)}</strong></p>` : ""}
      ${c.resumo    ? `<p class="list-row__resumo-detail">${escHtml(c.resumo)}</p>` : ""}
      ${c.status === "pendencia" && c.pendenciaDesc
        ? `<div class="list-row__pendencia"><strong>Pendência:</strong> ${escHtml(c.pendenciaDesc)}</div>` : ""}
      <label class="list-row__notes-label">Anotações do preceptor${c.notasPreceptor ? ' <span class="notes-dot"></span>' : ""}</label>
      <textarea placeholder="Anote aqui os comentários do preceptor...">${c.notasPreceptor ? escHtml(c.notasPreceptor) : ""}</textarea>
      <div class="list-row__detail-actions">
        <button class="btn btn--primary btn--sm" data-action="save-notes">Salvar anotações</button>
        <button class="btn btn--ghost btn--sm" data-action="copy-fap" data-fap="${escHtml(c.fap)}">📋 Copiar FAP</button>
      </div>
    </div>`;

  // click anywhere on the summary row (not inside the detail) toggles expand
  row.addEventListener("click", (e) => {
    if (e.target.closest(".list-row__detail") || e.target.closest(".list-row__handle")) return;
    toggleDetail(row);
  });

  row.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => handleRowAction(e, c, collection, row));
  });

  return row;
}

function toggleDetail(row) {
  const detail  = row.querySelector(".list-row__detail");
  const chevron = row.querySelector(".list-row__chevron");
  const open    = detail.hidden;
  detail.hidden = !open;
  row.classList.toggle("list-row--expanded", open);
  chevron.style.transform = open ? "rotate(180deg)" : "";
}

async function handleRowAction(e, c, col, row) {
  e.stopPropagation();
  const action = e.currentTarget.dataset.action;

  if (action === "save-notes") {
    const val = row.querySelector("textarea").value.trim();
    await updateDoc(doc(db, col, c.id), { notasPreceptor: val, updatedAt: serverTimestamp() });
    flash(row, "✅ Salvo");
  } else if (action === "copy-fap") {
    await navigator.clipboard.writeText(c.fap).catch(() => {});
    const btn = e.currentTarget;
    const orig = btn.textContent;
    btn.textContent = "✅ Copiado!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderCases();
  });
});

function updateFilterCounts(open) {
  document.getElementById("cnt-all").textContent             = open.length;
  document.getElementById("cnt-f-a-ser-visto").textContent   = open.filter((c) => c.status === "a-ser-visto").length;
  document.getElementById("cnt-f-encaminhado").textContent   = open.filter((c) => c.status === "encaminhado").length;
  document.getElementById("cnt-f-terceirizado").textContent  = open.filter((c) => c.status === "terceirizado").length;
  document.getElementById("cnt-f-pendencia").textContent     = open.filter((c) => c.status === "pendencia").length;
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────
let dragSrcId  = null;
let dragSrcCol = null;

function initDrag(container, col) {
  container.querySelectorAll(".list-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragSrcId  = row.dataset.id;
      dragSrcCol = col;
      row.classList.add("list-row--dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragSrcId);
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (row.dataset.id !== dragSrcId) row.classList.add("list-row--drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("list-row--drag-over"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("list-row--drag-over");
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId || dragSrcCol !== col) return;

      const ids    = [...container.querySelectorAll(".list-row")].map((r) => r.dataset.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;

      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);

      const batch = writeBatch(db);
      ids.forEach((id, i) => batch.update(doc(db, col, id), { listOrder: (i + 1) * 1000 }));
      await batch.commit();
    });
    row.addEventListener("dragend", () => {
      document.querySelectorAll(".list-row--dragging, .list-row--drag-over")
        .forEach((el) => el.classList.remove("list-row--dragging", "list-row--drag-over"));
      dragSrcId = dragSrcCol = null;
    });
  });
}

// ─── Flash feedback ───────────────────────────────────────────────────────────
function flash(row, msg) {
  const el = document.createElement("span");
  el.style.cssText = "position:absolute;right:16px;top:12px;font-size:12px;font-weight:700;color:#166534;pointer-events:none;";
  el.textContent = msg;
  row.style.position = "relative";
  row.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
