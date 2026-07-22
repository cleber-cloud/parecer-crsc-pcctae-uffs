/**
 * CRSC-PCCTAE por campus/reitoria (portarias GR/UFFS/2026).
 * Dados em comissoes-data.js
 */
(function (global) {
  "use strict";

  function data() {
    return global.RSC_COMISSOES_DATA || {};
  }

  function listUnidades() {
    return Object.values(data()).map((c) => ({ id: c.id, nome: c.nome }));
  }

  function getComissao(id) {
    return data()[id] || null;
  }

  function titulares(id) {
    const c = getComissao(id);
    if (!c) return [];
    return (c.membros || []).filter((m) => m.funcao === "Titular");
  }

  function todosMembros(id) {
    const c = getComissao(id);
    return c ? c.membros || [] : [];
  }

  function checarImpedimento(comissaoId, siapeRequerente) {
    const s = String(siapeRequerente || "").replace(/\D/g, "");
    if (!s) return [];
    return todosMembros(comissaoId).filter((m) => String(m.siape) === s);
  }

  global.RSCComissoes = {
    listUnidades,
    getComissao,
    titulares,
    todosMembros,
    checarImpedimento,
  };
})(typeof window !== "undefined" ? window : globalThis);
