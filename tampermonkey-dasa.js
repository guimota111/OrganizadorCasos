// ==UserScript==
// @name         Organizador de Casos — Busca automática DASA
// @namespace    https://guimota111.github.io/OrganizadorCasos/
// @version      1.0
// @description  Quando a aba ganhar foco com BUSCAR:<FAP> no clipboard, preenche e busca automaticamente.
// @author       guimota1
// @match        https://motionap.dasa.com.br/LiberacaoPorRequisicao.action
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  let lastFap = "";

  // Simula digitação nativa para não acionar detecção do Akamai
  function setNativeValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function tryAutoSearch() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (_) {
      return; // permissão de clipboard negada
    }

    if (!text.startsWith("BUSCAR:")) return;

    const fap = text.replace("BUSCAR:", "").trim();
    if (!fap || fap === lastFap) return;
    if (!/^\d{12}$/.test(fap)) return;

    lastFap = fap;

    // Limpa o clipboard para não repetir a busca
    try { await navigator.clipboard.writeText(""); } catch (_) {}

    const input = document.querySelector('input[name="filtroBusca.codigoRequisicao"]');
    if (!input) return;

    // Foca e preenche o campo
    input.focus();
    setNativeValue(input, fap);

    // Aguarda um breve momento antes de clicar (mais natural para o Akamai)
    setTimeout(() => {
      // Procura o botão "Procurar" pelo texto
      const botoes = document.querySelectorAll(".button-content");
      const btn = [...botoes].find((el) => el.textContent.trim() === "Procurar");
      if (btn) {
        btn.click();
      } else {
        // Fallback: Enter no campo
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", keyCode: 13, bubbles: true }));
      }
    }, 300);
  }

  // Dispara quando a aba recebe foco
  window.addEventListener("focus", tryAutoSearch);

  // Também tenta ao carregar a página (caso já tenha FAP no clipboard)
  window.addEventListener("load", tryAutoSearch);
})();
