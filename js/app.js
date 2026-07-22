/**
 * CRSC Parecer RSC — app principal (GitHub Pages)
 */
(function () {
  "use strict";

  const state = {
    req: null,
    comissaoId: "",
    numeroProcesso: "",
    dataRequerimento: "",
    prioridade: false,
    diligencias: false,
    vigencia: "",
    anexoNumero: "I",
    justificativa: "",
  };

  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "alert alert-" + (type || "info");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
  }

  function fillUnidades() {
    const sel = $("selUnidade");
    sel.innerHTML = '<option value="">Selecione o campus / Reitoria…</option>';
    RSCComissoes.listUnidades().forEach((u) => {
      const o = document.createElement("option");
      o.value = u.id;
      o.textContent = u.nome;
      sel.appendChild(o);
    });
  }

  function renderSigners() {
    const box = $("signers");
    box.innerHTML = "";
    const id = state.comissaoId;
    if (!id) {
      box.innerHTML = '<p class="muted">Selecione a unidade da CRSC.</p>';
      return;
    }
    const com = RSCComissoes.getComissao(id);
    $("comissaoInfo").textContent = com
      ? `Portarias ${com.portariaInstituicao} (institui) e ${com.portariaDesignacao} (designa).`
      : "";
    const titulares = RSCComissoes.titulares(id);
    titulares.forEach((m, i) => {
      const row = document.createElement("label");
      row.className = "signer";
      row.innerHTML = `<input type="checkbox" class="signer-cb" data-i="${i}" checked>
        <span><strong>${m.nome}</strong><br><span class="small">SIAPE ${m.siape} · ${m.segmento} · Titular</span></span>`;
      box.appendChild(row);
    });
    checkImpedimento();
  }

  function checkImpedimento() {
    const alert = $("impedimentoAlert");
    if (!state.req || !state.comissaoId) {
      alert.classList.add("hidden");
      return;
    }
    const hits = RSCComissoes.checarImpedimento(state.comissaoId, state.req.siape);
    if (hits.length) {
      alert.classList.remove("hidden");
      alert.innerHTML =
        "<strong>Impedimento:</strong> o(a) requerente consta como membro desta CRSC (" +
        hits.map((h) => h.nome + " / " + h.funcao).join("; ") +
        "). Redistribuir o processo a outra comissão (Regimento CRSC).";
    } else {
      alert.classList.add("hidden");
    }
  }

  function renderIdent() {
    const r = state.req;
    if (!r) return;
    $("identBox").classList.remove("hidden");
    $("identBox").innerHTML = `
      <div class="metrics">
        <div class="metric"><div class="k">Servidor</div><div class="v" style="font-size:1rem">${esc(r.nome)}</div></div>
        <div class="metric"><div class="k">SIAPE</div><div class="v" style="font-size:1rem">${esc(r.siape)}</div></div>
        <div class="metric"><div class="k">Nível pedido</div><div class="v" style="font-size:1rem">RSC ${esc(r.nivelRsc || "—")}</div></div>
        <div class="metric"><div class="k">Pontos (declarados)</div><div class="v" style="font-size:1rem">${r.pontuacaoTotalDeclarada ?? "—"}</div></div>
      </div>
      <p class="muted small" style="margin-top:.75rem">
        <strong>Cargo:</strong> ${esc(r.cargo)} ·
        <strong>Lotação:</strong> ${esc(r.lotacao)} ·
        <strong>Ingresso:</strong> ${esc(r.dataIngresso)} ·
        <strong>E-mail:</strong> ${esc(r.email)}
      </p>`;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderChecklist() {
    const r = state.req;
    const tbody = $("checklistBody");
    tbody.innerHTML = "";
    if (!r || !r.itens.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted">Nenhum critério extraído. Ajuste o PDF ou confira o texto.</td></tr>';
      return;
    }
    r.itens.forEach((it, idx) => {
      const tr = document.createElement("tr");
      tr.className = it.aceito === "ok" ? "ok" : it.aceito === "no" ? "no" : "pend";
      tr.innerHTML = `
        <td>${esc(it.grupo || "—")}</td>
        <td>${esc(it.descricao)}</td>
        <td>${esc(it.unidade)}</td>
        <td>${it.pontosObtidos != null ? it.pontosObtidos : "—"}</td>
        <td>
          <select data-idx="${idx}" class="aceite-sel">
            <option value="pend" ${it.aceito === "pend" ? "selected" : ""}>Pendente</option>
            <option value="ok" ${it.aceito === "ok" ? "selected" : ""}>Comprovado</option>
            <option value="no" ${it.aceito === "no" ? "selected" : ""}>Não comprovado</option>
          </select>
        </td>
        <td><input type="text" data-idx="${idx}" class="obs-inp" placeholder="Obs." value="${esc(it.obs || "")}"></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".aceite-sel").forEach((el) => {
      el.addEventListener("change", () => {
        const i = Number(el.getAttribute("data-idx"));
        state.req.itens[i].aceito = el.value;
        updateAvaliacao();
        el.closest("tr").className =
          el.value === "ok" ? "ok" : el.value === "no" ? "no" : "pend";
      });
    });
    tbody.querySelectorAll(".obs-inp").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-idx"));
        state.req.itens[i].obs = el.value;
      });
    });
  }

  function itensParaAvaliacao() {
    return (state.req?.itens || []).map((it) => ({
      descricao: it.descricao,
      pontosObtidos: it.aceito === "ok" ? Number(it.pontosObtidos) || 0 : 0,
      grupo: it.grupo,
      aceito: it.aceito,
    }));
  }

  function updateAvaliacao() {
    if (!state.req) return;
    // por padrão, para teste: se todos pendentes, tratar como ok para prévia matemática
    const itens = state.req.itens.map((it) => {
      const aceito = it.aceito === "pend" ? "ok" : it.aceito;
      return {
        descricao: it.descricao,
        pontosObtidos: aceito === "ok" ? Number(it.pontosObtidos) || 0 : 0,
        grupo: it.grupo,
        aceito,
      };
    });
    // se usuário já marcou algo, usar marcações reais
    const marked = state.req.itens.some((i) => i.aceito !== "pend");
    const finalItens = marked
      ? state.req.itens.map((it) => ({
          descricao: it.descricao,
          pontosObtidos: it.aceito === "ok" ? Number(it.pontosObtidos) || 0 : 0,
          grupo: it.grupo,
          aceito: it.aceito,
        }))
      : itens;

    const av = RSCRegras.avaliar(state.req, finalItens);
    state._avaliacao = av;
    state._avaliacaoMode = marked ? "marcado" : "previa-todos-ok";

    $("metricsBox").innerHTML = `
      <div class="metric"><div class="k">Mín. pontos</div><div class="v">${av.minPontos ?? "—"}</div></div>
      <div class="metric"><div class="k">Pontos (aceitos)</div><div class="v">${av.pontosObtidos}</div></div>
      <div class="metric"><div class="k">Mín. critérios</div><div class="v">${av.minItens ?? "—"}</div></div>
      <div class="metric"><div class="k">Critérios ok</div><div class="v">${av.qtdCriterios}</div></div>
      <div class="metric"><div class="k">Saldo</div><div class="v">${av.saldoPontuacao}</div></div>
      <div class="metric"><div class="k">Prévia parecer</div><div class="v" style="font-size:1rem">${av.favoravel ? "Favorável" : "Não favorável"}</div></div>
    `;

    const hyp = $("hipotesesBox");
    if (av.favoravel) {
      hyp.className = "alert alert-ok";
      hyp.innerHTML =
        "<strong>Prévia:</strong> requisitos quantitativos atendidos" +
        (marked ? "" : " (simulando todos os itens como comprovados até a comissão marcar)") +
        ".";
    } else {
      hyp.className = "alert alert-err";
      hyp.innerHTML =
        "<strong>Hipóteses objetivas de indeferimento:</strong><ul style='margin:.4rem 0 0 1.1rem'>" +
        (av.hipoteses || []).map((h) => `<li>${esc(h.texto)}</li>`).join("") +
        "</ul>";
    }
    hyp.classList.remove("hidden");

    $("btnParecer").disabled = false;
  }

  async function onFile(file) {
    if (!file) return;
    $("fileName").textContent = file.name;
    try {
      toast("Lendo PDF do requerimento…", "info");
      const data = await RSCParseRequerimento.parseRequerimentoPdf(file);
      // default: leave pendente; user can bulk-accept
      state.req = data;
      renderIdent();
      renderChecklist();
      $("step2").classList.remove("hidden");
      $("step3").classList.remove("hidden");
      updateAvaliacao();
      checkImpedimento();
      toast(
        `Extraídos ${data.itens.length} critério(s). Confira e marque o checklist.`,
        "ok"
      );
    } catch (e) {
      console.error(e);
      toast(e.message || "Falha ao ler PDF", "err");
    }
  }

  function collectAssinantes() {
    const com = RSCComissoes.getComissao(state.comissaoId);
    if (!com) return [];
    const tits = RSCComissoes.titulares(state.comissaoId);
    const cbs = [...document.querySelectorAll(".signer-cb")];
    return tits.filter((_, i) => {
      const cb = cbs.find((c) => Number(c.getAttribute("data-i")) === i);
      return cb ? cb.checked : true;
    });
  }

  async function gerarParecer() {
    if (!state.req) return toast("Carregue o requerimento.", "err");
    if (!state.comissaoId) return toast("Selecione o campus/Reitoria.", "err");
    if (!state.numeroProcesso.trim())
      return toast("Informe o número do processo SIPAC.", "err");

    // se ainda pendente, marcar todos ok para gerar (com aviso) — ou exigir marcação
    const pend = state.req.itens.filter((i) => i.aceito === "pend");
    if (pend.length === state.req.itens.length) {
      // assume comprovados para teste
      state.req.itens.forEach((i) => (i.aceito = "ok"));
      renderChecklist();
      updateAvaliacao();
      toast("Itens estavam pendentes: marcados como comprovados para o teste.", "warn");
    }

    const av = RSCRegras.avaliar(
      state.req,
      state.req.itens.map((it) => ({
        descricao: it.descricao,
        pontosObtidos: it.aceito === "ok" ? Number(it.pontosObtidos) || 0 : 0,
        grupo: it.grupo,
        aceito: it.aceito,
      }))
    );

    const just =
      $("justificativa").value.trim() ||
      (av.hipoteses || []).map((h) => h.texto).join(" ");

    const ctx = {
      req: state.req,
      numeroProcesso: state.numeroProcesso.trim(),
      dataRequerimento: state.dataRequerimento || "—",
      prioridade: state.prioridade,
      diligencias: state.diligencias,
      vigencia: state.vigencia,
      anexoNumero: state.anexoNumero || "I",
      comissao: RSCComissoes.getComissao(state.comissaoId),
      assinantes: collectAssinantes(),
      avaliacao: av,
      justificativa: just,
      complexidadeDesc: av.nivel?.complexidadeDesc,
    };

    try {
      toast("Gerando PDF do parecer…", "info");
      const bytes = await RSCParecerPdf.gerarParecerPdf(ctx);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const safe = (state.req.siape || "servidor").replace(/\W/g, "");
      a.download = `Parecer_RSC_${safe}_${state.numeroProcesso.replace(/\W/g, "_")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Parecer PDF gerado.", "ok");
    } catch (e) {
      console.error(e);
      toast(e.message || "Erro ao gerar PDF", "err");
    }
  }

  function bind() {
    fillUnidades();

    $("selUnidade").addEventListener("change", (e) => {
      state.comissaoId = e.target.value;
      renderSigners();
    });
    $("numProcesso").addEventListener("input", (e) => {
      state.numeroProcesso = e.target.value;
    });
    $("dataReq").addEventListener("change", (e) => {
      state.dataRequerimento = e.target.value
        ? e.target.value.split("-").reverse().join("/")
        : "";
    });
    $("chkPrioridade").addEventListener("change", (e) => {
      state.prioridade = e.target.checked;
    });
    $("chkDiligencias").addEventListener("change", (e) => {
      state.diligencias = e.target.checked;
    });
    $("vigencia").addEventListener("change", (e) => {
      state.vigencia = e.target.value
        ? e.target.value.split("-").reverse().join("/")
        : "";
    });
    $("anexoNum").addEventListener("input", (e) => {
      state.anexoNumero = e.target.value || "I";
    });

    const drop = $("fileDrop");
    const input = $("fileInput");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.style.borderColor = "#008037";
    });
    drop.addEventListener("dragleave", () => {
      drop.style.borderColor = "";
    });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.style.borderColor = "";
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
    input.addEventListener("change", () => {
      if (input.files[0]) onFile(input.files[0]);
    });

    $("btnAllOk").addEventListener("click", () => {
      if (!state.req) return;
      state.req.itens.forEach((i) => (i.aceito = "ok"));
      renderChecklist();
      updateAvaliacao();
    });
    $("btnAllNo").addEventListener("click", () => {
      if (!state.req) return;
      state.req.itens.forEach((i) => (i.aceito = "no"));
      renderChecklist();
      updateAvaliacao();
    });
    $("btnParecer").addEventListener("click", gerarParecer);
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
