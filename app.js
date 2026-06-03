import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy,
  serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ─── State ────────────────────────────────────────────────────────────────────
let allCases     = [];
let editingId    = null;
let activeFilter = "all";
let pendingDeleteId = null;

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

  const payload = { nome, fap, resumoLinha, resumo, status, pendenciaDesc, updatedAt: serverTimestamp() };

  try {
    if (editingId) {
      await updateDoc(doc(db, "casos", editingId), payload);
      showToast("Caso atualizado.");
      cancelEdit();
    } else {
      const group    = allCases.filter((c) => !c.liberado && c.status === status);
      const maxOrder = group.reduce((m, c) => Math.max(m, c.listOrder ?? c.sortOrder ?? 0), 0);
      payload.createdAt = serverTimestamp();
      payload.liberado  = false;
      payload.listOrder = maxOrder + 1000;
      await addDoc(collection(db, "casos"), payload);
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

// ─── Firestore listener (starts only after auth is ready) ────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  onSnapshot(query(collection(db, "casos"), orderBy("createdAt", "desc")), (snap) => {
    allCases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
});

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const open     = allCases.filter((c) => !c.liberado)
    .sort((a, b) => (a.listOrder ?? a.sortOrder ?? 0) - (b.listOrder ?? b.sortOrder ?? 0));
  const released = allCases.filter((c) =>  c.liberado)
    .sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0));

  // counters
  document.getElementById("cnt-total").textContent    = allCases.length;
  document.getElementById("cnt-nao-visto").textContent= open.filter((c) => c.status === "nao-visto").length;
  document.getElementById("cnt-visto").textContent    = open.filter((c) => c.status === "visto").length;
  document.getElementById("cnt-laudado").textContent  = open.filter((c) => c.status === "laudado").length;
  document.getElementById("cnt-pendencia").textContent= open.filter((c) => c.status === "pendencia").length;
  document.getElementById("cnt-outros").textContent   = open.filter((c) => c.status === "outros").length;
  document.getElementById("cnt-liberado").textContent = released.length;
  document.getElementById("badge-liberado").textContent = released.length;
  updateFilterCounts(open);

  // open list
  caseListEl.innerHTML = "";
  const visible = open.filter((c) => activeFilter === "all" || c.status === activeFilter);
  emptyList.hidden = visible.length > 0;
  visible.forEach((c) => caseListEl.appendChild(buildRow(c)));
  initDrag(caseListEl);

  // released list
  releasedListEl.innerHTML = "";
  emptyReleased.hidden = released.length > 0;
  released.forEach((c) => releasedListEl.appendChild(buildReleasedRow(c)));
}

function updateFilterCounts(open) {
  document.getElementById("cnt-all").textContent          = open.length;
  document.getElementById("cnt-f-nao-visto").textContent  = open.filter((c) => c.status === "nao-visto").length;
  document.getElementById("cnt-f-visto").textContent      = open.filter((c) => c.status === "visto").length;
  document.getElementById("cnt-f-laudado").textContent    = open.filter((c) => c.status === "laudado").length;
  document.getElementById("cnt-f-pendencia").textContent  = open.filter((c) => c.status === "pendencia").length;
  document.getElementById("cnt-f-outros").textContent     = open.filter((c) => c.status === "outros").length;
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

const STATUS_OPTIONS = [
  { value: "nao-visto", label: "⬜ Não visto" },
  { value: "visto",     label: "🟢 Visto" },
  { value: "laudado",   label: "✅ Laudado" },
  { value: "pendencia", label: "⏳ Pendência" },
  { value: "outros",    label: "🔵 Outros" },
];

// ─── Open case row ────────────────────────────────────────────────────────────
function buildRow(c) {
  const row = document.createElement("div");
  row.className = `list-row list-row--${c.status}${c.checked ? " list-row--checked" : ""}`;
  row.setAttribute("draggable", "true");
  row.dataset.id = c.id;

  const selectOptions = STATUS_OPTIONS.map((o) =>
    `<option value="${o.value}"${c.status === o.value ? " selected" : ""}>${o.label}</option>`
  ).join("");

  row.innerHTML = `
    <div class="list-row__handle" title="Arrastar para reordenar">⠿</div>
    <button class="list-row__check" data-action="toggle-check" title="Marcar como checado">✓</button>
    <div class="list-row__fap" title="Clique para copiar FAP" style="cursor:pointer;">${escHtml(c.fap)}</div>
    <div class="list-row__main">
      <div class="list-row__nome">${escHtml(c.nome)}</div>
      ${c.resumoLinha ? `<div class="list-row__resumo-linha">${escHtml(c.resumoLinha)}</div>` : ""}
    </div>
    <select class="status-select status-select--${c.status}" data-action="change-status">${selectOptions}</select>
    <span class="list-row__chevron" aria-hidden="true">▾</span>
    <div class="list-row__detail" hidden>
      ${c.resumo ? `<p class="list-row__resumo-detail">${escHtml(c.resumo)}</p>` : ""}
      ${c.status === "pendencia" && c.pendenciaDesc
        ? `<div class="list-row__pendencia"><strong>Pendência:</strong> ${escHtml(c.pendenciaDesc)}</div>` : ""}
      <label class="list-row__notes-label">Anotações do preceptor${c.notasPreceptor ? ' <span class="notes-dot"></span>' : ""}</label>
      <textarea placeholder="Anote aqui os comentários do preceptor...">${c.notasPreceptor ? escHtml(c.notasPreceptor) : ""}</textarea>
      <div class="list-row__detail-actions">
        <button class="btn btn--primary btn--sm" data-action="save-notes">Salvar anotações</button>
        <button class="btn btn--ghost btn--sm" data-action="edit-case">Editar caso</button>
        <button class="btn btn--success btn--sm" data-action="liberar">Liberar caso</button>
        <button class="btn btn--warning btn--sm" data-action="add-pendencia">⏳ Adicionar pendência</button>
        <button class="btn btn--danger btn--sm" data-action="excluir" data-nome="${escHtml(c.nome)}">Excluir</button>
      </div>
      <div class="list-row__pendencia-input" hidden>
        <input type="text" class="pendencia-text" placeholder="Descreva a pendência…" />
        <button class="btn btn--warning btn--sm" data-action="save-pendencia">Salvar</button>
        <button class="btn btn--ghost btn--sm" data-action="cancel-pendencia">Cancelar</button>
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

  row.addEventListener("click", (e) => {
    if (e.target.closest(".list-row__detail") || e.target.closest(".list-row__handle") || e.target.closest(".status-select")) return;
    toggleRowDetail(row);
  });
  row.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", (e) => handleRowAction(e, c, row))
  );
  // Status dropdown change
  row.querySelector(".status-select").addEventListener("change", async (e) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    await updateDoc(doc(db, "casos", c.id), { status: newStatus, updatedAt: serverTimestamp() });
  });
  return row;
}

function toggleRowDetail(row) {
  const detail  = row.querySelector(".list-row__detail");
  const chevron = row.querySelector(".list-row__chevron");
  const open    = detail.hidden;
  detail.hidden = !open;
  row.classList.toggle("list-row--expanded", open);
  chevron.style.transform = open ? "rotate(180deg)" : "";
}

async function handleRowAction(e, c, row) {
  e.stopPropagation();
  const action = e.currentTarget.dataset.action;

  if (action === "toggle-check") {
    await updateDoc(doc(db, "casos", c.id), { checked: !c.checked });

  } else if (action === "save-notes") {
    const val = row.querySelector("textarea").value.trim();
    await updateDoc(doc(db, "casos", c.id), { notasPreceptor: val, updatedAt: serverTimestamp() });
    flash(row, "✅ Salvo");

  } else if (action === "liberar") {
    await updateDoc(doc(db, "casos", c.id), { liberado: true, checked: false, updatedAt: serverTimestamp() });

  } else if (action === "edit-case") {
    editingId = c.id;
    formTitle.textContent = "Editar Caso";
    cancelEditBtn.hidden  = false;
    document.getElementById("nome").value          = c.nome;
    document.getElementById("fap").value           = c.fap;
    document.getElementById("resumo-linha").value  = c.resumoLinha || "";
    document.getElementById("resumo").value        = c.resumo || "";
    document.querySelector(`input[name="status"][value="${c.status}"]`).checked = true;
    pendenciaGroup.hidden = c.status !== "pendencia";
    document.getElementById("pendencia-desc").value = c.pendenciaDesc || "";
    toggleSection(formBody, formToggle, true);
    document.getElementById("form-section").scrollIntoView({ behavior: "smooth" });

  } else if (action === "add-pendencia") {
    const box = row.querySelector(".list-row__pendencia-input");
    box.hidden = false;
    box.querySelector(".pendencia-text").focus();

  } else if (action === "cancel-pendencia") {
    const box = row.querySelector(".list-row__pendencia-input");
    box.hidden = true;
    box.querySelector(".pendencia-text").value = "";

  } else if (action === "save-pendencia") {
    const box  = row.querySelector(".list-row__pendencia-input");
    const desc = box.querySelector(".pendencia-text").value.trim();
    await updateDoc(doc(db, "casos", c.id), { status: "pendencia", pendenciaDesc: desc, updatedAt: serverTimestamp() });

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
    <div class="list-row__main"><div class="list-row__nome" style="color:var(--clr-text-muted);font-weight:500;">${escHtml(c.nome)}</div></div>
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
  row.addEventListener("click", (e) => {
    if (e.target.closest(".list-row__detail") || e.target.closest(".list-row__fap")) return;
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
    await updateDoc(doc(db, "casos", c.id), { liberado: false, updatedAt: serverTimestamp() });
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
      ids.forEach((id, i) => batch.update(doc(db, "casos", id), { listOrder: (i + 1) * 1000 }));
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
confirmDelBtn.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  try {
    await deleteDoc(doc(db, "casos", pendingDeleteId));
    showToast("Caso excluído.");
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
  pendingDeleteId   = null;
  deleteModal.hidden = true;
});
cancelDelBtn.addEventListener("click", () => { pendingDeleteId = null; deleteModal.hidden = true; });
deleteModal.addEventListener("click", (e) => { if (e.target === deleteModal) { pendingDeleteId = null; deleteModal.hidden = true; }});

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
  const newList        = document.getElementById("import-new-list");
  const existingList   = document.getElementById("import-existing-list");
  const existingSection= document.getElementById("import-existing-section");
  const newLabel       = document.getElementById("import-new-label");
  const existingLabel  = document.getElementById("import-existing-label");
  const confirmBtn     = document.getElementById("import-confirm-btn");

  let selectedFile = null;

  function showStep(step) {
    [stepKey, stepUpload, stepLoading, stepResults].forEach((s) => { s.hidden = true; });
    step.hidden = false;
  }

  function openModal() {
    importModal.hidden = false;
    const key = localStorage.getItem("anthropic-api-key");
    showStep(key ? stepUpload : stepKey);
    selectedFile = null;
    previewImg.hidden = true;
    analyzeBtn.disabled = true;
    dropzoneLabel.textContent = "Clique para selecionar imagem";
  }

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
          max_tokens: 1024,
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
      const text = data?.content?.[0]?.text ?? "[]";
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      const extracted = parsed
        .map((c) => ({ ...c, fap: (c.fap ?? "").trim().replace(/\./g, "") }))
        .filter((c) => /^\d{12}$/.test(c.fap));

      showResults(extracted);
    } catch (err) {
      showStep(stepUpload);
      showToast("Erro: " + err.message, "error");
    }
  });

  function normFap(fap) {
    return (fap ?? "").trim().replace(/\./g, "").toUpperCase();
  }

  function showResults(extracted) {
    const existingFaps = new Set(allCases.map((c) => normFap(c.fap)));
    const novos     = extracted.filter((c) => !existingFaps.has(normFap(c.fap)));
    const jaExistem = extracted.filter((c) =>  existingFaps.has(normFap(c.fap)));

    newList.innerHTML = "";
    existingList.innerHTML = "";

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
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>`;
        row.dataset.fap  = c.fap;
        row.dataset.nome = c.nome;
        newList.appendChild(row);
      });
    }

    newLabel.textContent = `${novos.length} novo${novos.length !== 1 ? "s" : ""}`;

    if (jaExistem.length > 0) {
      existingSection.hidden = false;
      existingLabel.textContent = `${jaExistem.length} já existe${jaExistem.length !== 1 ? "m" : ""} no organizador`;
      jaExistem.forEach((c) => {
        const row = document.createElement("div");
        row.className = "import-case-row import-case-row--existing";
        row.innerHTML = `
          <span style="width:16px;flex-shrink:0;">—</span>
          <span class="import-case-row__fap">${escHtml(c.fap)}</span>
          <span class="import-case-row__nome">${escHtml(c.nome)}</span>`;
        existingList.appendChild(row);
      });
    } else {
      existingSection.hidden = true;
    }

    showStep(stepResults);
  }

  // Back to upload
  document.getElementById("import-results-back").addEventListener("click", () => showStep(stepUpload));

  // Confirm import
  confirmBtn.addEventListener("click", async () => {
    const checked = [...newList.querySelectorAll(".import-case-row input:checked")];
    if (checked.length === 0) { showToast("Nenhum caso selecionado.", "error"); return; }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Importando…";

    try {
      const maxOrder = allCases
        .filter((c) => !c.liberado)
        .reduce((m, c) => Math.max(m, c.listOrder ?? c.sortOrder ?? 0), 0);

      for (let i = 0; i < checked.length; i++) {
        const row = checked[i].closest(".import-case-row");
        await addDoc(collection(db, "casos"), {
          nome:       row.dataset.nome,
          fap:        row.dataset.fap,
          status:     "nao-visto",
          liberado:   false,
          resumoLinha: "",
          resumo:     "",
          pendenciaDesc: "",
          listOrder:  maxOrder + (i + 1) * 1000,
          createdAt:  serverTimestamp(),
          updatedAt:  serverTimestamp(),
        });
      }

      closeModal();
      showToast(`${checked.length} caso${checked.length !== 1 ? "s" : ""} importado${checked.length !== 1 ? "s" : ""}.`);
    } catch (err) {
      showToast("Erro ao importar: " + err.message, "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Importar selecionados";
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
})();

// ─── Export image ────────────────────────────────────────────────────────────
document.getElementById("export-img-btn").addEventListener("click", () => {
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
    "nao-visto": "#94a3b8",
    "visto":     "#86efac",
    "laudado":   "#16a34a",
    "pendencia": "#d97706",
    "outros":    "#93c5fd",
  };

  let curY = HDR_H + 26;
  rowData.forEach(({ c, lines, height }, i) => {
    const y      = curY;
    const isEven = i % 2 === 0;

    // zebra
    ctx.fillStyle = isEven ? "#f8fafc" : "#ffffff";
    ctx.fillRect(PAD - 8, y - 14, W - (PAD - 8) * 2, height);

    // status left bar
    ctx.fillStyle = STATUS_COLORS[c.status] ?? "#94a3b8";
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

    // Resumo em uma linha — wrapped, laranja se pendência
    if (lines.length > 0) {
      ctx.fillStyle = c.status === "pendencia" ? "#d97706" : "#334155";
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
});

function clip(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
