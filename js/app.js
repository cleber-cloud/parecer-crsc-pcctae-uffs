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
    dataEnvioDiligencia: "",
    dataRetornoDiligencia: "",
    vigencia: "",
    hipotesesSelecionadas: [],
    /** @type {Record<string, boolean>} chave siape → marcado */
    signerChecked: {},
    /** ocultar linhas com qtdDeclarada === 0 */
    hideZeroCriterios: true,
    /** campos cuja discórdia texto×OCR o usuário já confirmou/editou */
    confirmedFields: {},
    /** índice do item com caixa de diligência aberta */
    diligenciaOpenIdx: null,
  };

  const IDENT_FIELDS = [
    { key: "nome", label: "Servidor (nome)", type: "text" },
    { key: "siape", label: "SIAPE", type: "text" },
    { key: "cargo", label: "Cargo", type: "text" },
    { key: "lotacao", label: "Lotação", type: "text" },
    { key: "dataIngresso", label: "Data de ingresso", type: "text" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "nivelRsc", label: "Nível RSC pedido", type: "nivel" },
    {
      key: "pontuacaoMinimaDeclarada",
      label: "Pontuação mínima (canônica)",
      type: "derived-min",
    },
    {
      key: "pontuacaoTotalDeclarada",
      label: "Pontos declarados (total)",
      type: "number",
    },
    {
      key: "qtdCriteriosDeclarada",
      label: "Qtd. critérios declarada",
      type: "number",
    },
  ];

  function applyCanonicalMinFromNivel() {
    if (!state.req) return;
    const nv = RSCRegras.NIVEIS[state.req.nivelRsc];
    if (!nv) return;
    state.req.pontuacaoMinimaDeclarada = nv.minPontos;
    state.req.minItensExigidos = nv.minItens;
    if (state.req.pontuacaoTotalDeclarada != null) {
      state.req.excedenteDeclarado =
        Math.round(
          (state.req.pontuacaoTotalDeclarada - nv.minPontos) * 10
        ) / 10;
    }
    if (state.req._fields) {
      state.req._fields.pontuacaoMinimaDeclarada = {
        value: nv.minPontos,
        text: null,
        ocr: null,
        source: "catalogo",
        agree: true,
        conflict: false,
        canonical: true,
      };
    }
  }

  function fieldNeedsConfirm(f) {
    if (!f) return false;
    if (f.canonical || f.source === "catalogo") return false;
    const hasT = f.text != null && String(f.text).trim() !== "";
    const hasO = f.ocr != null && String(f.ocr).trim() !== "";
    if (hasT && hasO) return !f.agree || !!f.conflict;
    // só uma fonte capturou: pede confirmação se o OCR realmente rodou
    const dual = state.req && state.req._dualCapture;
    const ocrRan =
      dual &&
      !dual.ocrFailed &&
      ((dual.ocrLines || 0) > 0 || (dual.ocrConfidence || 0) > 0);
    if (ocrRan && hasT !== hasO) return true;
    return false;
  }

  function isFieldConfirmPending(key) {
    if (state.confirmedFields[key]) return false;
    const f = state.req && state.req._fields && state.req._fields[key];
    return fieldNeedsConfirm(f);
  }

  function markFieldConfirmed(key) {
    state.confirmedFields[key] = true;
  }

  function fmtDateBr(iso) {
    if (!iso) return "";
    const p = String(iso).split("-");
    if (p.length === 3) return p[2] + "/" + p[1] + "/" + p[0];
    return iso;
  }

  function syncDiligenciaDatasUI() {
    const box = $("diligenciaDatas");
    if (!box) return;
    if (state.diligencias) box.classList.remove("hidden");
    else box.classList.add("hidden");
  }

  function updateDiligenciaBtn() {
    const btn = $("btnGerarDiligencia");
    if (!btn) return;
    const n = (state.req?.itens || []).filter(
      (i) => i.diligencia && i.diligencia.texto
    ).length;
    btn.disabled = !state.req || n === 0;
    btn.textContent =
      n > 0
        ? `Gerar diligência (PDF) · ${n} item(ns)`
        : "Gerar diligência (PDF)";
  }

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

  function srcBadge(src, agree) {
    if (agree || src === "both")
      return '<span class="src-badge src-both" title="Texto e OCR concordam">✓ texto+OCR</span>';
    if (src === "text")
      return '<span class="src-badge src-text" title="Priorizado texto nativo">texto</span>';
    if (src === "ocr")
      return '<span class="src-badge src-ocr" title="Priorizado OCR">OCR</span>';
    if (src === "pont-min" || src === "total-excedente" || src === "itens-sum")
      return `<span class="src-badge src-derived" title="Derivado">${esc(src)}</span>`;
    return '<span class="src-badge src-none">—</span>';
  }

  function renderCompare() {
    const box = $("compareBox");
    if (!box) return;
    const r = state.req;
    if (!r || !r._fields) {
      box.classList.add("hidden");
      return;
    }
    const m = r._merge || {};
    const dual = r._dualCapture || {};
    const labels = {
      nome: "Nome",
      siape: "SIAPE",
      cargo: "Cargo",
      dataIngresso: "Ingresso",
      lotacao: "Lotação",
      email: "E-mail",
      nivelRsc: "Nível RSC",
      nivelClassificacao: "Classificação",
      pontuacaoMinimaDeclarada: "Pts mínimos (canônico)",
      pontuacaoTotalDeclarada: "Pts totais",
      qtdCriteriosDeclarada: "Qtd critérios",
      saldoAnterior: "Saldo anterior",
    };
    const order = [
      "nome",
      "siape",
      "cargo",
      "dataIngresso",
      "lotacao",
      "email",
      "nivelRsc",
      "pontuacaoMinimaDeclarada",
      "pontuacaoTotalDeclarada",
      "qtdCriteriosDeclarada",
    ];
    const rows = order
      .filter((k) => r._fields[k])
      .map((k) => {
        const f = r._fields[k];
        const isCanon = f.canonical || f.source === "catalogo";
        const conflict =
          isCanon
            ? ' class="row-agree"'
            : f.conflict
              ? ' class="row-conflict"'
              : f.agree
                ? ' class="row-agree"'
                : "";
        const fmt = (v) =>
          v == null || v === "" ? "—" : esc(String(v));
        return `<tr${conflict}>
          <td>${esc(labels[k] || k)}</td>
          <td class="small">${isCanon ? "—" : fmt(f.text)}</td>
          <td class="small">${isCanon ? "—" : fmt(f.ocr)}</td>
          <td><strong>${fmt(f.value)}</strong>${
            isCanon
              ? ' <span class="muted small">(tabela oficial)</span>'
              : ""
          }</td>
          <td>${
            isCanon
              ? '<span class="src-badge src-derived">catálogo</span>'
              : srcBadge(f.source, f.agree)
          }</td>
        </tr>`;
      })
      .join("");

    const conf =
      m.ocrConfidence != null ? Math.round(m.ocrConfidence) + "%" : "—";
    const ocrNote = r._ocrError
      ? `<span class="alert-err" style="display:inline;padding:.1rem .4rem;border-radius:4px">OCR falhou: ${esc(
          r._ocrError
        )} — usando texto nativo</span>`
      : `confiança OCR ~${conf} · ${m.ocrLines || dual.ocrLines || 0} linhas OCR · ${
          m.textLines || dual.textLines || 0
        } linhas texto`;

    box.classList.remove("hidden");
    box.innerHTML = `
      <details class="compare-panel" open>
        <summary>
          <strong>Comparação texto nativo × OCR</strong>
          <span class="muted small" style="margin-left:.5rem">
            scores texto ${m.scoreText ?? "—"} / OCR ${m.scoreOcr ?? "—"} ·
            ${m.fieldsAgree ?? 0} campos em acordo ·
            ${m.fieldsConflict ?? 0} conflito(s) ·
            itens: ${esc(m.itensStrategy || "—")}
          </span>
        </summary>
        <p class="muted small" style="margin:.5rem 0">${ocrNote}</p>
        <div class="table-wrap">
          <table class="compare-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Texto nativo</th>
                <th>OCR</th>
                <th>Resultado</th>
                <th>Fonte</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="muted small" style="margin:.6rem 0 0">
          Itens: <strong>${(r._textOnly && r._textOnly.itens && r._textOnly.itens.length) || 0}</strong> (texto) ·
          <strong>${(r._ocrOnly && r._ocrOnly.itens && r._ocrOnly.itens.length) || 0}</strong> (OCR) ·
          <strong>${(r.itens && r.itens.length) || 0}</strong> (fusão).
          Linhas amarelas = discórdia resolvida; verdes = acordo.
        </p>
      </details>`;
  }

  function renderIdent() {
    const r = state.req;
    if (!r) return;
    $("identBox").classList.remove("hidden");

    const fieldsHtml = IDENT_FIELDS.map((meta) => {
      const key = meta.key;
      const pending = isFieldConfirmPending(key);
      const f = (r._fields && r._fields[key]) || null;
      const val = r[key] != null ? r[key] : "";
      const cls = "ident-field" + (pending ? " needs-confirm" : "");
      const hint = pending
        ? `<span class="confirm-hint">Confirme esta informação</span>`
        : "";
      let control = "";
      if (meta.type === "nivel") {
        control = `<select data-field="${key}" class="ident-inp">
          ${["I", "II", "III", "IV", "V", "VI"]
            .map(
              (n) =>
                `<option value="${n}" ${
                  String(val) === n ? "selected" : ""
                }>RSC ${n}</option>`
            )
            .join("")}
        </select>`;
      } else if (meta.type === "derived-min") {
        const nv = RSCRegras.NIVEIS[r.nivelRsc];
        const min = nv ? nv.minPontos : val;
        control = `<input type="text" data-field="${key}" class="ident-inp" value="${esc(
          min != null ? min : "—"
        )}" readonly title="Valor fixo do Decreto/calculadora conforme o nível RSC" />`;
      } else {
        const ro = pending ? "" : "readonly";
        control = `<input type="${
          meta.type === "number" ? "number" : meta.type === "email" ? "email" : "text"
        }" data-field="${key}" class="ident-inp" value="${esc(
          val
        )}" step="any" ${pending ? "" : ro} />`;
      }
      const dual =
        meta.type === "derived-min"
          ? `<span class="muted" style="font-size:.68rem">Tabela canônica: I=10 · II=15 · III=25 · IV=30 · V=52 · VI=75</span>`
          : f && (f.text != null || f.ocr != null)
            ? `<span class="muted" style="font-size:.68rem">texto: ${esc(
                f.text == null || f.text === "" ? "—" : f.text
              )} · OCR: ${esc(
                f.ocr == null || f.ocr === "" ? "—" : f.ocr
              )}</span>`
            : "";
      return `<div class="${cls}" data-field-wrap="${key}">
        <span class="k">${esc(meta.label)}</span>
        ${control}
        ${meta.type === "derived-min" ? "" : hint}
        ${dual}
      </div>`;
    }).join("");

    $("identBox").innerHTML = `
      <p class="muted small" style="margin:0 0 .65rem">
        Campos em <strong style="color:#b45309">amarelo</strong> não tiveram concordância entre texto nativo e OCR — confirme ou corrija.
      </p>
      <div class="ident-form">${fieldsHtml}</div>`;

    $("identBox").querySelectorAll(".ident-inp").forEach((el) => {
      const key0 = el.getAttribute("data-field");
      if (key0 === "pontuacaoMinimaDeclarada") return; // sempre canônico
      const apply = () => {
        const key = el.getAttribute("data-field");
        let v = el.value;
        if (
          key === "pontuacaoTotalDeclarada" ||
          key === "qtdCriteriosDeclarada"
        ) {
          const n = Number(String(v).replace(",", "."));
          v = Number.isFinite(n) ? n : null;
        }
        state.req[key] = v;
        markFieldConfirmed(key);
        if (key === "nivelRsc") {
          applyCanonicalMinFromNivel();
          // atualiza o campo readonly da mínima
          const minEl = $("identBox").querySelector(
            '[data-field="pontuacaoMinimaDeclarada"]'
          );
          if (minEl) minEl.value = state.req.pontuacaoMinimaDeclarada ?? "—";
        }
        if (key === "pontuacaoTotalDeclarada") {
          applyCanonicalMinFromNivel();
        }
        if (r._fields && r._fields[key]) {
          r._fields[key].value = v;
          r._fields[key].agree = true;
          r._fields[key].source = "user";
          r._fields[key].conflict = false;
        }
        const wrap = $("identBox").querySelector(
          `[data-field-wrap="${key}"]`
        );
        if (wrap) {
          wrap.classList.remove("needs-confirm");
          const h = wrap.querySelector(".confirm-hint");
          if (h) h.remove();
          el.removeAttribute("readonly");
        }
        updateAvaliacao();
      };
      el.addEventListener("change", apply);
      el.addEventListener("blur", apply);
    });
    renderCompare();
  }

  function pontosItem(it) {
    const pu = Number(it.pontosUnitario) || 0;
    const q = Number(it.qtdAceita);
    if (Number.isFinite(q) && pu > 0) return Math.round(q * pu * 10) / 10;
    return 0;
  }

  function syncHideZeroBtn() {
    const btn = $("btnHideZero");
    if (!btn) return;
    btn.textContent = state.hideZeroCriterios
      ? "Mostrar todos os critérios (incl. zerados)"
      : "Ocultar critérios sem pontuação declarada";
  }

  function renderChecklist() {
    const box = $("checklistBody");
    box.innerHTML = "";
    const r = state.req;
    const info = $("catalogInfo");
    if (!r || !r.itens || !r.itens.length) {
      box.innerHTML =
        '<p class="muted">Nenhum critério no catálogo.</p>';
      if (info) info.textContent = "";
      updateDiligenciaBtn();
      return;
    }

    const comQtd = r.itens.filter((i) => (Number(i.qtdDeclarada) || 0) > 0)
      .length;
    const sumDecl =
      Math.round(
        r.itens.reduce((s, i) => {
          const pu = Number(i.pontosUnitario) || 0;
          const q = Number(i.qtdDeclarada) || 0;
          return s + q * pu;
        }, 0) * 10
      ) / 10;
    if (info) {
      const un = (r._catalogUnmatched && r._catalogUnmatched.length) || 0;
      const nDil = r.itens.filter((i) => i.diligencia && i.diligencia.texto)
        .length;
      info.innerHTML =
        `Catálogo canônico: <strong>${r.itens.length}</strong> critérios · ` +
        `<strong>${comQtd}</strong> com quantidade declarada · ` +
        `soma declarada <strong>${sumDecl}</strong> pts` +
        (r.pontuacaoTotalDeclarada != null
          ? ` (PDF: ${r.pontuacaoTotalDeclarada})`
          : "") +
        (nDil ? ` · <strong>${nDil}</strong> em diligência` : "") +
        (un
          ? ` · <span style="color:#9a3412">${un} item(ns) do PDF sem casamento no catálogo</span>`
          : "");
    }
    syncHideZeroBtn();

    const cats = (window.RSCCriterios && window.RSCCriterios.getCategorias()) ||
      window.RSC_CATEGORIAS || {
        I: "Grupo I",
        II: "Grupo II",
        III: "Grupo III",
        IV: "Grupo IV",
        V: "Grupo V",
        VI: "Grupo VI",
      };
    const order = ["I", "II", "III", "IV", "V", "VI"];
    let visible = 0;

    order.forEach((g) => {
      const indices = [];
      r.itens.forEach((it, idx) => {
        if (String(it.grupo || "") !== g) return;
        if (it.qtdDeclarada == null) it.qtdDeclarada = 0;
        if (it.qtdAceita == null) it.qtdAceita = it.qtdDeclarada;
        const qDecl = Number(it.qtdDeclarada) || 0;
        if (state.hideZeroCriterios && qDecl <= 0) return;
        indices.push(idx);
      });
      if (!indices.length) return;

      const block = document.createElement("section");
      block.className = "grupo-block";
      block.innerHTML = `<header class="grupo-head">
        <span class="grupo-badge">${esc(g)}</span>
        <span class="grupo-title">${esc(cats[g] || "Critério " + g)}</span>
        <span class="muted small">${indices.length} item(ns)</span>
      </header>`;
      const list = document.createElement("div");
      list.className = "grupo-items";

      indices.forEach((idx) => {
        const it = r.itens[idx];
        const qDecl = Number(it.qtdDeclarada) || 0;
        const pts = pontosItem(it);
        const st =
          Number(it.qtdAceita) <= 0
            ? qDecl > 0
              ? "no"
              : "zero"
            : Number(it.qtdAceita) < qDecl
              ? "pend"
              : "ok";
        const hasDil = !!(it.diligencia && it.diligencia.texto);
        const open = state.diligenciaOpenIdx === idx;
        const card = document.createElement("article");
        card.className = "crit-card " + st;
        card.setAttribute("data-idx", String(idx));
        card.innerHTML = `
          <div class="crit-main">
            <span class="crit-id">${esc(it.criterionId || "—")}</span>
            <div class="crit-desc">${esc(it.descricao)}</div>
            <div class="crit-meta">${esc(it.unidade)} · ${
              it.pontosUnitario != null ? it.pontosUnitario : "—"
            } pts/unid.</div>
            ${
              hasDil && !open
                ? `<div class="diligencia-saved"><strong>Diligência:</strong> ${esc(
                    it.diligencia.texto
                  )}</div>`
                : ""
            }
          </div>
          <div class="crit-side">
            <div class="qty-row">
              <div class="qty-pill">
                <label>Qtd decl.</label>
                <span class="val">${qDecl}</span>
              </div>
              <div class="qty-pill">
                <label>Qtd aceita</label>
                <input type="number" min="0" step="any" class="qtd-aceita" data-idx="${idx}" value="${
                  it.qtdAceita != null ? it.qtdAceita : 0
                }" />
              </div>
              <div class="qty-pill pts">
                <label>Pts aceitos</label>
                <span class="val pts-aceitos" data-idx="${idx}">${pts}</span>
              </div>
            </div>
            <button type="button" class="btn-diligencia ${
              hasDil ? "active" : ""
            }" data-idx="${idx}">
              ${hasDil ? "Editar diligência" : "Marcar para diligência"}
            </button>
          </div>
          ${
            open
              ? `<div class="diligencia-box" data-dil-box="${idx}">
                  <label for="dilTxt${idx}">Descreva sua diligência:</label>
                  <textarea id="dilTxt${idx}" placeholder="Informe o que deve ser complementado ou esclarecido neste critério…">${esc(
                    (it.diligencia && it.diligencia.texto) || ""
                  )}</textarea>
                  <div class="btn-row">
                    <button type="button" class="btn btn-primary btn-save-dil" data-idx="${idx}">Salvar diligência</button>
                    <button type="button" class="btn btn-secondary btn-cancel-dil" data-idx="${idx}">Cancelar</button>
                    ${
                      hasDil
                        ? `<button type="button" class="btn btn-secondary btn-clear-dil" data-idx="${idx}">Remover</button>`
                        : ""
                    }
                  </div>
                </div>`
              : ""
          }`;
        list.appendChild(card);
        visible++;
      });

      block.appendChild(list);
      box.appendChild(block);
    });

    if (!visible) {
      box.innerHTML =
        '<p class="muted">Nenhum critério com pontuação declarada. Use “Mostrar todos os critérios”.</p>';
    }

    box.querySelectorAll(".qtd-aceita").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-idx"));
        let v = Number(el.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        const max = Number(state.req.itens[i].qtdDeclarada);
        if (Number.isFinite(max) && max > 0 && v > max) v = max;
        state.req.itens[i].qtdAceita = v;
        state.req.itens[i].aceito = v <= 0 ? "no" : "ok";
        const pts = pontosItem(state.req.itens[i]);
        const cell = box.querySelector(`.pts-aceitos[data-idx="${i}"]`);
        if (cell) cell.textContent = String(pts);
        const card = el.closest(".crit-card");
        const qd = Number(state.req.itens[i].qtdDeclarada) || 0;
        if (card) {
          card.className =
            "crit-card " +
            (v <= 0 ? (qd > 0 ? "no" : "zero") : v < qd ? "pend" : "ok");
        }
        updateAvaliacao();
      });
    });

    box.querySelectorAll(".btn-diligencia").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        state.diligenciaOpenIdx =
          state.diligenciaOpenIdx === i ? null : i;
        renderChecklist();
      });
    });
    box.querySelectorAll(".btn-save-dil").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        const ta = document.getElementById("dilTxt" + i);
        const txt = (ta && ta.value.trim()) || "";
        if (!txt) {
          toast("Descreva a diligência antes de salvar.", "err");
          return;
        }
        state.req.itens[i].diligencia = {
          texto: txt,
          em: new Date().toISOString(),
        };
        state.req.itens[i].obs = txt;
        state.diligenciaOpenIdx = null;
        // marcar que houve diligências no processo
        state.diligencias = true;
        const chk = $("chkDiligencias");
        if (chk) chk.checked = true;
        syncDiligenciaDatasUI();
        renderChecklist();
        updateDiligenciaBtn();
        toast("Diligência salva no item " + (state.req.itens[i].criterionId || i), "ok");
      });
    });
    box.querySelectorAll(".btn-cancel-dil").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.diligenciaOpenIdx = null;
        renderChecklist();
      });
    });
    box.querySelectorAll(".btn-clear-dil").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        state.req.itens[i].diligencia = null;
        state.req.itens[i].obs = "";
        state.diligenciaOpenIdx = null;
        renderChecklist();
        updateDiligenciaBtn();
      });
    });

    updateDiligenciaBtn();
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

  function setProgress(p) {
    const prog = $("ocrProgress");
    const bar = $("ocrBar");
    const fill = $("ocrBarFill");
    if (!prog) return;
    prog.classList.remove("hidden");
    if (bar) bar.classList.remove("hidden");
    if (!p) {
      prog.textContent = "";
      if (fill) fill.style.width = "0%";
      return;
    }
    const pct =
      p.progress != null ? Math.max(0, Math.min(100, Math.round(p.progress * 100))) : null;
    if (fill && pct != null) fill.style.width = pct + "%";

    if (p.phase === "text") {
      prog.textContent = "Extraindo texto nativo (pdf.js)…";
    } else if (p.phase === "text-done") {
      prog.textContent = `Texto nativo ok (${p.numPages || "?"} pág.). Preparando OCR…`;
    } else if (p.phase === "ocr-init") {
      prog.textContent =
        "Carregando motor OCR (Tesseract por+eng)" +
        (p.status ? " · " + p.status : "") +
        "…";
    } else if (p.phase === "ocr" || p.phase === "ocr-page") {
      const pg = p.page || "?";
      const tot = p.total || "?";
      prog.textContent = `OCR em todas as páginas · ${pg}/${tot}${
        pct != null ? " · " + pct + "%" : ""
      }`;
    } else if (p.phase === "merge") {
      prog.textContent = "Cruzando texto nativo × OCR (campo a campo)…";
    } else if (p.phase === "done") {
      prog.textContent = "Fusão concluída.";
      if (fill) fill.style.width = "100%";
    }
  }

  async function onFile(file) {
    if (!file) return;
    $("fileName").textContent = file.name;
    const prog = $("ocrProgress");
    const compare = $("compareBox");
    if (compare) {
      compare.classList.add("hidden");
      compare.innerHTML = "";
    }
    setProgress({ phase: "text", progress: 0.02 });
    try {
      toast(
        "Lendo PDF com captura dual (texto nativo + OCR em todas as páginas)… pode levar alguns minutos.",
        "info"
      );
      const data = await RSCParseRequerimento.parseRequerimentoPdf(file, {
        useOcr: true,
        onProgress: setProgress,
      });
      state.req = data;
      state.hipotesesSelecionadas = [];
      state.confirmedFields = {};
      state.diligenciaOpenIdx = null;
      applyCanonicalMinFromNivel();
      renderIdent();
      renderChecklist();
      renderHipotesesDropdown();
      $("step2").classList.remove("hidden");
      $("step3").classList.remove("hidden");
      updateAvaliacao();
      checkImpedimento();
      updateDiligenciaBtn();
      const m = data._merge || {};
      const cat = data._catalogMeta || {};
      const comQtd =
        cat.comPontuacao != null
          ? cat.comPontuacao
          : (data.itens || []).filter((i) => (Number(i.qtdDeclarada) || 0) > 0)
              .length;
      const miss = [];
      if (!data.nome) miss.push("nome");
      if (!data.siape) miss.push("SIAPE");
      if (!data.nivelRsc) miss.push("nível");
      if (!comQtd) miss.push("quantidades");
      prog.textContent =
        `Pronto · catálogo ${data.itens.length} · ${comQtd} com qtd · fusão ${
          m.winner || "text/ocr"
        }` +
        (m.ocrConfidence != null
          ? ` · OCR ~${Math.round(m.ocrConfidence)}%`
          : "") +
        (m.fieldsConflict
          ? ` · ${m.fieldsConflict} campo(s) com discórdia resolvida`
          : "");
      if (miss.length) {
        toast(
          `Extração parcial — confira: ${miss.join(
            ", "
          )}. ${comQtd} critério(s) com quantidade no PDF.`,
          "err"
        );
      } else {
        toast(
          `Catálogo completo (${data.itens.length}) · ${comQtd} com pontuação declarada · RSC ${data.nivelRsc} · SIAPE ${data.siape}.`,
          "ok"
        );
      }
    } catch (e) {
      console.error(e);
      setProgress(null);
      prog.textContent = "";
      prog.classList.add("hidden");
      const bar = $("ocrBar");
      if (bar) bar.classList.add("hidden");
      toast(e.message || "Falha ao ler PDF", "err");
    }
  }

  function collectAssinantes() {
    const id = state.comissaoId;
    const membros = RSCComissoes.todosMembros(id);
    return membros.filter((m) => state.signerChecked[m.siape]);
  }

  function buildBaseCtx(av) {
    return {
      req: state.req,
      numeroProcesso: state.numeroProcesso.trim(),
      dataRequerimento: state.dataRequerimento || "—",
      prioridade: state.prioridade,
      diligencias: state.diligencias,
      dataEnvioDiligencia: state.dataEnvioDiligencia
        ? fmtDateBr(state.dataEnvioDiligencia)
        : "",
      dataRetornoDiligencia: state.dataRetornoDiligencia
        ? fmtDateBr(state.dataRetornoDiligencia)
        : "",
      vigencia: state.vigencia,
      comissao: RSCComissoes.getComissao(state.comissaoId),
      assinantes: collectAssinantes(),
      avaliacao: av,
      complexidadeDesc: av.nivel?.complexidadeDesc,
    };
  }

  async function gerarParecer() {
    if (!state.req) return toast("Carregue o requerimento.", "err");
    if (!state.comissaoId) return toast("Selecione o campus/Reitoria.", "err");
    if (!state.numeroProcesso.trim())
      return toast("Informe o número do processo SIPAC.", "err");
    if (state.diligencias) {
      if (!state.dataEnvioDiligencia || !state.dataRetornoDiligencia) {
        return toast(
          "Houve diligências: informe a data de envio ao servidor e a data de retorno à comissão.",
          "err"
        );
      }
    }

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
      ...buildBaseCtx(av),
      justificativa: just,
      hipotesesArt14: state.hipotesesSelecionadas,
    };

    try {
      toast("Gerando PDF do parecer…", "info");
      const bytes = await RSCParecerPdf.gerarParecerPdf(ctx);
      downloadBytes(
        bytes,
        `Parecer_RSC_${(state.req.siape || "servidor").replace(/\W/g, "")}_${state.numeroProcesso.replace(/\W/g, "_")}.pdf`
      );
      toast("Parecer PDF gerado.", "ok");
    } catch (e) {
      console.error(e);
      toast(e.message || "Erro ao gerar PDF", "err");
    }
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function gerarDiligencia() {
    if (!state.req) return toast("Carregue o requerimento.", "err");
    if (!state.comissaoId) return toast("Selecione o campus/Reitoria.", "err");
    if (!state.numeroProcesso.trim())
      return toast("Informe o número do processo SIPAC.", "err");

    const itensDil = (state.req.itens || []).filter(
      (i) => i.diligencia && i.diligencia.texto
    );
    if (!itensDil.length) {
      return toast(
        "Marque ao menos um critério com “Marcar para diligência” e salve o texto.",
        "err"
      );
    }

    // ao gerar diligência, garantir flag e pedir datas se ainda não houver
    state.diligencias = true;
    const chk = $("chkDiligencias");
    if (chk) chk.checked = true;
    syncDiligenciaDatasUI();
    if (!state.dataEnvioDiligencia) {
      return toast(
        "Informe a data de envio da diligência ao servidor (no passo 1).",
        "err"
      );
    }

    const av = RSCRegras.avaliar(state.req, itensParaAvaliacao());
    const ctx = {
      ...buildBaseCtx(av),
      itensDiligencia: itensDil.map((i) => ({
        criterionId: i.criterionId,
        grupo: i.grupo,
        descricao: i.descricao,
        unidade: i.unidade,
        pontosUnitario: i.pontosUnitario,
        qtdDeclarada: i.qtdDeclarada,
        qtdAceita: i.qtdAceita,
        texto: i.diligencia.texto,
      })),
    };

    try {
      toast("Gerando PDF de diligência…", "info");
      const bytes = await RSCParecerPdf.gerarDiligenciaPdf(ctx);
      downloadBytes(
        bytes,
        `Diligencia_RSC_${(state.req.siape || "servidor").replace(/\W/g, "")}_${state.numeroProcesso.replace(/\W/g, "_")}.pdf`
      );
      toast("PDF de diligência gerado.", "ok");
    } catch (e) {
      console.error(e);
      toast(e.message || "Erro ao gerar diligência", "err");
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
      syncDiligenciaDatasUI();
    });
    const envDil = $("dataEnvioDil");
    if (envDil) {
      envDil.addEventListener("change", (e) => {
        state.dataEnvioDiligencia = e.target.value;
      });
    }
    const retDil = $("dataRetornoDil");
    if (retDil) {
      retDil.addEventListener("change", (e) => {
        state.dataRetornoDiligencia = e.target.value;
      });
    }
    $("vigencia").addEventListener("change", (e) => {
      state.vigencia = e.target.value
        ? e.target.value.split("-").reverse().join("/")
        : "";
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

    $("btnHideZero").addEventListener("click", () => {
      state.hideZeroCriterios = !state.hideZeroCriterios;
      renderChecklist();
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
    const btnDil = $("btnGerarDiligencia");
    if (btnDil) btnDil.addEventListener("click", gerarDiligencia);
    syncDiligenciaDatasUI();

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
