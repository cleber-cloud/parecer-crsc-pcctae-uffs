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
    hipotesesSelecionadas: [],
    /** @type {Record<string, boolean>} chave siape → marcado */
    signerChecked: {},
  };

  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "alert alert-" + (type || "info");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6500);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function renderHipotesesDropdown() {
    const box = $("hipotesesChecks");
    if (!box) return;
    box.innerHTML = "";
    const cap = document.createElement("p");
    cap.className = "muted small";
    cap.style.margin = "0 0 .6rem";
    cap.textContent = RSCRegras.CAPUT_ART14;
    box.appendChild(cap);

    RSCRegras.HIPOTESES_ART14.forEach((h) => {
      const lab = document.createElement("label");
      lab.className = "signer hip-item";
      lab.innerHTML = `<input type="checkbox" class="hip-cb" data-id="${h.id}" ${
        state.hipotesesSelecionadas.includes(h.id) ? "checked" : ""
      } />
        <span class="small">${esc(h.texto)}</span>`;
      box.appendChild(lab);
    });

    box.querySelectorAll(".hip-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.getAttribute("data-id");
        if (cb.checked) {
          if (!state.hipotesesSelecionadas.includes(id))
            state.hipotesesSelecionadas.push(id);
        } else {
          state.hipotesesSelecionadas = state.hipotesesSelecionadas.filter(
            (x) => x !== id
          );
        }
        syncJustificativaFromHipoteses();
      });
    });
  }

  function syncJustificativaFromHipoteses() {
    const ta = $("justificativa");
    if (!ta) return;
    ta.value = RSCRegras.textoJustificativa(state.hipotesesSelecionadas);
  }

  function applySugestoesHipoteses(sugestoes) {
    state.hipotesesSelecionadas = [...new Set(sugestoes || [])];
    renderHipotesesDropdown();
    syncJustificativaFromHipoteses();
  }

  /**
   * Pares titular/suplente por segmento (e ordem dentro do segmento).
   */
  function paresAssinatura(comissaoId) {
    const membros = RSCComissoes.todosMembros(comissaoId);
    const bySeg = {};
    membros.forEach((m) => {
      const s = m.segmento || "OUTROS";
      if (!bySeg[s]) bySeg[s] = { titulares: [], suplentes: [] };
      if (m.funcao === "Titular") bySeg[s].titulares.push(m);
      else bySeg[s].suplentes.push(m);
    });
    const pares = [];
    Object.keys(bySeg).forEach((seg) => {
      const t = bySeg[seg].titulares;
      const s = bySeg[seg].suplentes;
      const n = Math.max(t.length, s.length);
      for (let i = 0; i < n; i++) {
        pares.push({
          segmento: seg,
          titular: t[i] || null,
          suplente: s[i] || null,
        });
      }
    });
    return pares;
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

    const pares = paresAssinatura(id);
    // init defaults: titulares checked, suplentes not
    pares.forEach((p) => {
      if (p.titular && state.signerChecked[p.titular.siape] === undefined)
        state.signerChecked[p.titular.siape] = true;
      if (p.suplente && state.signerChecked[p.suplente.siape] === undefined)
        state.signerChecked[p.suplente.siape] = false;
    });

    pares.forEach((p, pi) => {
      const wrap = document.createElement("div");
      wrap.className = "signer-pair";
      wrap.innerHTML = `<div class="small" style="font-weight:700;color:#065228;margin-bottom:.35rem">${esc(
        p.segmento
      )}</div>`;
      const row = document.createElement("div");
      row.className = "signer-pair-row";

      function mk(m, role, pairIndex) {
        if (!m) {
          const empty = document.createElement("div");
          empty.className = "signer muted small";
          empty.textContent = role + ": —";
          return empty;
        }
        const lab = document.createElement("label");
        lab.className = "signer";
        const checked = !!state.signerChecked[m.siape];
        lab.innerHTML = `<input type="checkbox" class="signer-cb" data-siape="${m.siape}" data-role="${role}" data-pair="${pairIndex}" ${
          checked ? "checked" : ""
        } />
          <span><strong>${esc(m.nome)}</strong><br>
          <span class="small">SIAPE ${esc(m.siape)} · ${esc(role)}</span></span>`;
        return lab;
      }

      row.appendChild(mk(p.titular, "Titular", pi));
      row.appendChild(mk(p.suplente, "Suplente", pi));
      wrap.appendChild(row);
      box.appendChild(wrap);
    });

    box.querySelectorAll(".signer-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        const siape = cb.getAttribute("data-siape");
        const role = cb.getAttribute("data-role");
        const pair = cb.getAttribute("data-pair");
        state.signerChecked[siape] = cb.checked;
        if (cb.checked) {
          // desmarca o outro do mesmo par
          box.querySelectorAll(`.signer-cb[data-pair="${pair}"]`).forEach((other) => {
            if (other !== cb) {
              other.checked = false;
              state.signerChecked[other.getAttribute("data-siape")] = false;
            }
          });
        }
      });
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

  function pontosItem(it) {
    const pu = Number(it.pontosUnitario) || 0;
    const q = Number(it.qtdAceita);
    if (Number.isFinite(q) && pu > 0) return Math.round(q * pu * 10) / 10;
    return 0;
  }

  function renderChecklist() {
    const r = state.req;
    const tbody = $("checklistBody");
    tbody.innerHTML = "";
    if (!r || !r.itens.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="muted">Nenhum critério extraído.</td></tr>';
      return;
    }
    r.itens.forEach((it, idx) => {
      if (it.qtdDeclarada == null && it.pontosUnitario && it.pontosObtidos) {
        it.qtdDeclarada =
          Math.round((it.pontosObtidos / it.pontosUnitario) * 1000) / 1000;
      }
      if (it.qtdAceita == null) it.qtdAceita = it.qtdDeclarada ?? 0;
      const pts = pontosItem(it);
      const tr = document.createElement("tr");
      const st =
        Number(it.qtdAceita) <= 0
          ? "no"
          : Number(it.qtdAceita) < Number(it.qtdDeclarada)
            ? "pend"
            : "ok";
      tr.className = st;
      tr.innerHTML = `
        <td>${esc(it.grupo || "—")}</td>
        <td>${esc(it.descricao)}</td>
        <td>${esc(it.unidade)}</td>
        <td class="num">${it.pontosUnitario != null ? it.pontosUnitario : "—"}</td>
        <td class="num">${it.qtdDeclarada != null ? it.qtdDeclarada : "—"}</td>
        <td><input type="number" min="0" step="any" class="qtd-aceita" data-idx="${idx}" value="${
          it.qtdAceita != null ? it.qtdAceita : 0
        }" style="width:4.5rem"></td>
        <td class="num pts-aceitos" data-idx="${idx}">${pts}</td>
        <td><input type="text" data-idx="${idx}" class="obs-inp" placeholder="Obs." value="${esc(
          it.obs || ""
        )}"></td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".qtd-aceita").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-idx"));
        let v = Number(el.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        const max = Number(state.req.itens[i].qtdDeclarada);
        if (Number.isFinite(max) && v > max) v = max;
        state.req.itens[i].qtdAceita = v;
        state.req.itens[i].aceito = v <= 0 ? "no" : "ok";
        const pts = pontosItem(state.req.itens[i]);
        const cell = tbody.querySelector(`.pts-aceitos[data-idx="${i}"]`);
        if (cell) cell.textContent = String(pts);
        const tr = el.closest("tr");
        const qd = Number(state.req.itens[i].qtdDeclarada);
        tr.className =
          v <= 0 ? "no" : Number.isFinite(qd) && v < qd ? "pend" : "ok";
        updateAvaliacao();
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
      grupo: it.grupo,
      qtdDeclarada: it.qtdDeclarada,
      qtdAceita: it.qtdAceita,
      pontosAceitos: pontosItem(it),
      aceito: Number(it.qtdAceita) > 0 ? "ok" : "no",
    }));
  }

  function updateAvaliacao() {
    if (!state.req) return;
    const av = RSCRegras.avaliar(state.req, itensParaAvaliacao());
    state._avaliacao = av;

    $("metricsBox").innerHTML = `
      <div class="metric"><div class="k">Mín. pontos</div><div class="v">${av.minPontos ?? "—"}</div></div>
      <div class="metric"><div class="k">Pontos aceitos</div><div class="v">${av.pontosObtidos}</div></div>
      <div class="metric"><div class="k">Mín. critérios</div><div class="v">${av.minItens ?? "—"}</div></div>
      <div class="metric"><div class="k">Critérios com qtd &gt; 0</div><div class="v">${av.qtdCriterios}</div></div>
      <div class="metric"><div class="k">Saldo</div><div class="v">${av.saldoPontuacao}</div></div>
      <div class="metric"><div class="k">Prévia</div><div class="v" style="font-size:1rem">${
        av.favoravel ? "Favorável" : "Não favorável"
      }</div></div>
    `;

    const hyp = $("hipotesesBox");
    if (av.favoravel) {
      hyp.className = "alert alert-ok";
      hyp.innerHTML =
        "<strong>Prévia quantitativa:</strong> pontuação, quantidade de critérios e complexidade atendidos com as quantidades aceitas. Confira o mérito documental e o art. 14.";
    } else {
      hyp.className = "alert alert-err";
      hyp.innerHTML =
        "<strong>Prévia quantitativa:</strong> requisitos numéricos não atendidos. Sugestão de incisos do art. 14: <strong>" +
        (av.sugestoesArt14 || []).join(", ") +
        "</strong>. Marque no quadro abaixo (textos literais do decreto).";
      if (av.sugestoesArt14?.length) applySugestoesHipoteses(av.sugestoesArt14);
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
      state.req = data;
      state.hipotesesSelecionadas = [];
      renderIdent();
      renderChecklist();
      renderHipotesesDropdown();
      $("step2").classList.remove("hidden");
      $("step3").classList.remove("hidden");
      updateAvaliacao();
      checkImpedimento();
      toast(
        `Extraídos ${data.itens.length} critério(s). Ajuste as quantidades aceitas se negar parte dos comprovantes.`,
        "ok"
      );
    } catch (e) {
      console.error(e);
      toast(e.message || "Falha ao ler PDF", "err");
    }
  }

  function collectAssinantes() {
    const id = state.comissaoId;
    const membros = RSCComissoes.todosMembros(id);
    return membros.filter((m) => state.signerChecked[m.siape]);
  }

  async function gerarParecer() {
    if (!state.req) return toast("Carregue o requerimento.", "err");
    if (!state.comissaoId) return toast("Selecione o campus/Reitoria.", "err");
    if (!state.numeroProcesso.trim())
      return toast("Informe o número do processo SIPAC.", "err");

    const av = RSCRegras.avaliar(state.req, itensParaAvaliacao());
    if (!av.favoravel && !state.hipotesesSelecionadas.length) {
      return toast(
        "Parecer não favorável: marque ao menos um inciso do art. 14 (texto literal).",
        "err"
      );
    }

    const just =
      $("justificativa").value.trim() ||
      RSCRegras.textoJustificativa(state.hipotesesSelecionadas);

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
      hipotesesArt14: state.hipotesesSelecionadas,
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
    renderHipotesesDropdown();

    $("selUnidade").addEventListener("change", (e) => {
      state.comissaoId = e.target.value;
      state.signerChecked = {};
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
      state.req.itens.forEach((i) => {
        i.qtdAceita = i.qtdDeclarada ?? i.qtdAceita ?? 0;
        i.aceito = Number(i.qtdAceita) > 0 ? "ok" : "no";
      });
      renderChecklist();
      updateAvaliacao();
    });
    $("btnAllNo").addEventListener("click", () => {
      if (!state.req) return;
      state.req.itens.forEach((i) => {
        i.qtdAceita = 0;
        i.aceito = "no";
      });
      renderChecklist();
      updateAvaliacao();
    });
    $("btnParecer").addEventListener("click", gerarParecer);

    // toggle painel hipóteses
    const toggle = $("toggleHipoteses");
    if (toggle) {
      toggle.addEventListener("click", () => {
        $("hipotesesPanel").classList.toggle("hidden");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
