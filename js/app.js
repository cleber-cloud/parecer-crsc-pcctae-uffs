/**
 * CRSC Parecer RSC — app principal (GitHub Pages)
 */
(function () {
  "use strict";

  /** Persistência contínua (estilo calculadora): IndexedDB + fallback localStorage. */
  const IDB_NAME = "crsc-parecer-rsc-uffs";
  const IDB_STORE = "keyval";
  const IDB_KEY = "session";
  const IDB_META_KEY = "session-meta";
  const LS_KEY = "crsc-parecer-rsc-uffs-session-v1"; // migração
  const LS_META_KEY = "crsc-parecer-rsc-uffs-session-meta-v1";
  const SNAPSHOT_VERSION = 1;

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
    /** permitir editar quantidades declaradas no catálogo */
    editQtdDeclarada: false,
    /** painel comparação texto×OCR aberto */
    compareOpen: false,
    /** libera todos os campos de identificação para edição manual */
    editIdentFields: false,
    /** campos cuja discórdia texto×OCR o usuário já confirmou/editou */
    confirmedFields: {},
    /** índice do item com caixa de diligência aberta */
    diligenciaOpenIdx: null,
    /** índice do item com caixa de observação aberta */
    obsOpenIdx: null,
    /** painéis recolhidos */
    signersPanelHidden: false,
    hipotesesPanelHidden: false,
  };

  let autosaveTimer = null;
  let suppressAutosave = false;

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

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

  function closeMsgModal() {
    const modal = $("msgModal");
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  /**
   * Popup central com OK (erros e avisos que exigem leitura).
   * Não rola a página; trava o scroll do body enquanto aberto.
   */
  function showMsgModal(msg, type) {
    const modal = $("msgModal");
    const text = $("msgModalText");
    const title = $("msgModalTitle");
    const icon = $("msgModalIcon");
    if (!modal || !text) {
      // fallback
      window.alert(msg);
      return;
    }
    const t = type || "err";
    modal.classList.remove("msg-err", "msg-warn", "msg-info", "msg-ok");
    modal.classList.add(
      t === "err"
        ? "msg-err"
        : t === "warn"
          ? "msg-warn"
          : t === "ok"
            ? "msg-ok"
            : "msg-info"
    );
    if (title) {
      title.textContent =
        t === "err"
          ? "Ops!"
          : t === "warn"
            ? "Atenção"
            : t === "ok"
              ? "Tudo certo"
              : "Aviso";
    }
    if (icon) {
      icon.textContent =
        t === "err" ? "!" : t === "warn" ? "!" : t === "ok" ? "✓" : "i";
    }
    text.textContent = String(msg || "");
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    const ok = $("msgModalOk");
    if (ok) {
      ok.focus();
    }
  }

  function toast(msg, type) {
    const t = type || "info";
    // erros e alertas importantes → popup central com OK
    if (t === "err" || t === "warn") {
      showMsgModal(msg, t);
      return;
    }
    const el = $("toast");
    if (!el) {
      showMsgModal(msg, t);
      return;
    }
    el.textContent = msg;
    el.className = "alert alert-" + t;
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
        "). Atenção para não constar como assinante.";
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
    const btn = $("btnToggleCompare");
    if (!box) return;
    const r = state.req;
    if (btn) {
      btn.disabled = !r || !r._fields;
      btn.textContent = state.compareOpen
        ? "Ocultar comparação texto × OCR"
        : "Comparação texto × OCR";
    }
    if (!r || !r._fields || !state.compareOpen) {
      box.classList.add("hidden");
      box.innerHTML = "";
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
      <div class="compare-panel">
        <p style="margin:0 0 .4rem">
          <strong>Comparação texto nativo × OCR</strong>
          <span class="muted small" style="margin-left:.5rem">
            scores texto ${m.scoreText ?? "—"} / OCR ${m.scoreOcr ?? "—"} ·
            ${m.fieldsAgree ?? 0} em acordo · ${m.fieldsConflict ?? 0} conflito(s)
          </span>
        </p>
        <p class="muted small" style="margin:.35rem 0">${ocrNote}</p>
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
      </div>`;
  }

  function syncEditIdentBtn() {
    const btn = $("btnEditIdent");
    if (!btn) return;
    btn.disabled = !state.req;
    btn.textContent = state.editIdentFields
      ? "Concluir edição dos campos"
      : "Editar campos";
    btn.classList.toggle("btn-primary", state.editIdentFields);
    btn.classList.toggle("btn-secondary", !state.editIdentFields);
  }

  function renderIdent() {
    const r = state.req;
    if (!r) return;
    $("identBox").classList.remove("hidden");
    const unlock = !!state.editIdentFields;

    const fieldsHtml = IDENT_FIELDS.map((meta) => {
      const key = meta.key;
      const pending = isFieldConfirmPending(key);
      const f = (r._fields && r._fields[key]) || null;
      const val = r[key] != null ? r[key] : "";
      const editable = unlock || pending;
      const cls =
        "ident-field" +
        (pending ? " needs-confirm" : "") +
        (unlock && !pending ? " unlocked" : "");
      const hint = pending
        ? `<span class="confirm-hint">Confirme esta informação</span>`
        : unlock
          ? `<span class="confirm-hint unlock-hint">Editável</span>`
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
        // mínima segue o nível (canônica); só exibe
        control = `<input type="text" data-field="${key}" class="ident-inp" value="${esc(
          min != null ? min : "—"
        )}" readonly title="Valor fixo do Decreto conforme o nível RSC (mude o nível para alterar)" />`;
      } else {
        const ro = editable ? "" : "readonly";
        control = `<input type="${
          meta.type === "number" ? "number" : meta.type === "email" ? "email" : "text"
        }" data-field="${key}" class="ident-inp" value="${esc(
          val
        )}" step="any" ${ro} />`;
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
        Campos em <strong style="color:#b45309">amarelo</strong> sem concordância texto × OCR.
        Use <strong>Editar campos</strong> para liberar todos os valores manualmente.
        ${
          unlock
            ? ' <span style="color:#0a7a3a;font-weight:700">Modo edição ativo.</span>'
            : ""
        }
      </p>
      <div class="ident-form">${fieldsHtml}</div>`;

    $("identBox").querySelectorAll(".ident-inp").forEach((el) => {
      const key0 = el.getAttribute("data-field");
      if (key0 === "pontuacaoMinimaDeclarada") return; // sempre canônico pelo nível
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
          if (h && !unlock) h.remove();
        }
        updateAvaliacao();
        scheduleAutosave();
      };
      el.addEventListener("change", apply);
      el.addEventListener("blur", apply);
    });
    syncEditIdentBtn();
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

  function syncEditQtdBtn() {
    const btn = $("btnEditQtdDecl");
    if (!btn) return;
    btn.textContent = state.editQtdDeclarada
      ? "Concluir edição das quantidades declaradas"
      : "Editar quantidade declarada";
    btn.classList.toggle("btn-primary", state.editQtdDeclarada);
    btn.classList.toggle("btn-secondary", !state.editQtdDeclarada);
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
        `Total de critérios específicos/itens: <strong>${r.itens.length}</strong> · ` +
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
    syncEditQtdBtn();

    const cats = (window.RSCCriterios && window.RSCCriterios.getCategorias()) ||
      window.RSC_CATEGORIAS || {
        I: "Anexo I",
        II: "Anexo II",
        III: "Anexo III",
        IV: "Anexo IV",
        V: "Anexo V",
        VI: "Anexo VI",
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
        <span class="grupo-badge">Anexo ${esc(g)}</span>
        <span class="grupo-title">${esc(cats[g] || "Anexo " + g)}</span>
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
        const hasObs = !!(it.observacao && String(it.observacao).trim());
        const openDil = state.diligenciaOpenIdx === idx;
        const openObs = state.obsOpenIdx === idx;
        const card = document.createElement("article");
        card.className = "crit-card " + st;
        card.setAttribute("data-idx", String(idx));
        const qDeclHtml = state.editQtdDeclarada
          ? `<input type="number" min="0" step="any" class="qtd-decl" data-idx="${idx}" value="${qDecl}" />`
          : `<span class="val">${qDecl}</span>`;
        card.innerHTML = `
          <div class="crit-main">
            <span class="crit-id">Item ${esc(it.criterionId || "—")}</span>
            <div class="crit-desc">${esc(it.descricao)}</div>
            <div class="crit-meta">${esc(it.unidade)} · ${
              it.pontosUnitario != null ? it.pontosUnitario : "—"
            } pts/unid.</div>
            ${
              hasDil && !openDil
                ? `<div class="diligencia-saved"><strong>Diligência:</strong> ${esc(
                    it.diligencia.texto
                  )}</div>`
                : ""
            }
            ${
              hasObs && !openObs
                ? `<div class="obs-saved"><strong>Observação:</strong> ${esc(
                    it.observacao
                  )}</div>`
                : ""
            }
          </div>
          <div class="crit-side">
            <div class="qty-row">
              <div class="qty-pill${state.editQtdDeclarada ? " editing-decl editable-decl" : ""}">
                <label>Qtd decl.</label>
                ${qDeclHtml}
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
            <div class="crit-actions">
              <button type="button" class="chip-btn chip-dil ${
                hasDil ? "active" : ""
              }" data-idx="${idx}" title="${
                hasDil ? "Editar diligência" : "Marcar para diligência"
              }">
                <span class="chip-ico" aria-hidden="true">${
                  hasDil ? "✎" : "⚑"
                }</span>
                <span>Diligência</span>
              </button>
              <button type="button" class="chip-btn chip-obs ${
                hasObs ? "active" : ""
              }" data-idx="${idx}" title="${
                hasObs ? "Editar observação" : "Adicionar observação"
              }">
                <span class="chip-ico" aria-hidden="true">${
                  hasObs ? "✎" : "💬"
                }</span>
                <span>Observação</span>
              </button>
            </div>
          </div>
          ${
            openDil
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
          }
          ${
            openObs
              ? `<div class="obs-box" data-obs-box="${idx}">
                  <label for="obsTxt${idx}">Observação da comissão:</label>
                  <textarea id="obsTxt${idx}" placeholder="Anotação interna ou ressalva sobre este critério…">${esc(
                    it.observacao || ""
                  )}</textarea>
                  <div class="btn-row">
                    <button type="button" class="btn btn-primary btn-save-obs" data-idx="${idx}">Salvar observação</button>
                    <button type="button" class="btn btn-secondary btn-cancel-obs" data-idx="${idx}">Cancelar</button>
                    ${
                      hasObs
                        ? `<button type="button" class="btn btn-secondary btn-clear-obs" data-idx="${idx}">Remover</button>`
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

    function refreshItemPts(i) {
      const it = state.req.itens[i];
      const pu = Number(it.pontosUnitario) || 0;
      const q = Number(it.qtdAceita) || 0;
      it.pontosObtidos =
        Math.round((Number(it.qtdDeclarada) || 0) * pu * 10) / 10;
      const pts = Math.round(q * pu * 10) / 10;
      const cell = box.querySelector(`.pts-aceitos[data-idx="${i}"]`);
      if (cell) cell.textContent = String(pts);
      const card = box.querySelector(`.crit-card[data-idx="${i}"]`);
      const qd = Number(it.qtdDeclarada) || 0;
      if (card) {
        card.className =
          "crit-card " +
          (q <= 0 ? (qd > 0 ? "no" : "zero") : q < qd ? "pend" : "ok");
      }
      updateAvaliacao();
      scheduleAutosave();
    }

    box.querySelectorAll(".qtd-decl").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-idx"));
        let v = Number(el.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        state.req.itens[i].qtdDeclarada = v;
        // se aceita era igual à antiga declarada ou maior que a nova, alinha
        const qa = Number(state.req.itens[i].qtdAceita);
        if (!Number.isFinite(qa) || qa > v) {
          state.req.itens[i].qtdAceita = v;
          const ace = box.querySelector(`.qtd-aceita[data-idx="${i}"]`);
          if (ace) ace.value = String(v);
        }
        state.req.itens[i].aceito =
          Number(state.req.itens[i].qtdAceita) > 0 ? "ok" : "no";
        refreshItemPts(i);
      });
    });

    box.querySelectorAll(".qtd-aceita").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.getAttribute("data-idx"));
        let v = Number(el.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        const max = Number(state.req.itens[i].qtdDeclarada);
        if (Number.isFinite(max) && max >= 0 && v > max) v = max;
        state.req.itens[i].qtdAceita = v;
        state.req.itens[i].aceito = v <= 0 ? "no" : "ok";
        refreshItemPts(i);
      });
    });

    box.querySelectorAll(".chip-dil").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        state.obsOpenIdx = null;
        state.diligenciaOpenIdx =
          state.diligenciaOpenIdx === i ? null : i;
        renderChecklist();
      });
    });
    box.querySelectorAll(".chip-obs").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        state.diligenciaOpenIdx = null;
        state.obsOpenIdx = state.obsOpenIdx === i ? null : i;
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
        state.diligenciaOpenIdx = null;
        // NÃO marca o checkbox "Houve diligências" (isso é só no parecer final)
        renderChecklist();
        updateDiligenciaBtn();
        scheduleAutosave();
        toast(
          "Diligência salva no item " +
            (state.req.itens[i].criterionId || i) +
            ". Use “Gerar diligência (PDF)” quando quiser.",
          "ok"
        );
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
        state.diligenciaOpenIdx = null;
        renderChecklist();
        updateDiligenciaBtn();
      });
    });
    box.querySelectorAll(".btn-save-obs").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        const ta = document.getElementById("obsTxt" + i);
        const txt = (ta && ta.value.trim()) || "";
        if (!txt) {
          toast("Digite a observação antes de salvar.", "err");
          return;
        }
        state.req.itens[i].observacao = txt;
        state.obsOpenIdx = null;
        renderChecklist();
        scheduleAutosave();
        toast("Observação salva.", "ok");
      });
    });
    box.querySelectorAll(".btn-cancel-obs").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.obsOpenIdx = null;
        renderChecklist();
      });
    });
    box.querySelectorAll(".btn-clear-obs").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-idx"));
        state.req.itens[i].observacao = "";
        state.obsOpenIdx = null;
        renderChecklist();
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

    const cx =
      av.nivel && av.nivel.complexidade && av.nivel.complexidade.length
        ? av.complexidadeOk
          ? "OK"
          : "Não"
        : "—";
    $("metricsBox").innerHTML = `
      <div class="metric"><div class="k">Mín. pontos (art. 5º)</div><div class="v">${av.minPontos ?? "—"}</div></div>
      <div class="metric"><div class="k">Pontos aceitos</div><div class="v">${av.pontosObtidos}</div></div>
      <div class="metric"><div class="k">Mín. itens</div><div class="v">${av.minItens ?? "—"}</div></div>
      <div class="metric"><div class="k">Itens com qtd &gt; 0</div><div class="v">${av.qtdCriterios}</div></div>
      <div class="metric"><div class="k">Complexidade</div><div class="v" style="font-size:1rem">${cx}</div></div>
      <div class="metric"><div class="k">Saldo</div><div class="v">${av.saldoPontuacao}</div></div>
      <div class="metric"><div class="k">Prévia art. 5º</div><div class="v" style="font-size:1rem">${
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
      state.obsOpenIdx = null;
      state.compareOpen = false;
      state.editIdentFields = false;
      state.editQtdDeclarada = false;
      applyCanonicalMinFromNivel();
      renderIdent();
      renderChecklist();
      renderCompare();
      renderHipotesesDropdown();
      $("step2").classList.remove("hidden");
      $("step3").classList.remove("hidden");
      updateAvaliacao();
      checkImpedimento();
      updateDiligenciaBtn();
      const btnCmp = $("btnToggleCompare");
      if (btnCmp) btnCmp.disabled = false;
      syncEditIdentBtn();
      scheduleAutosave();
      persistSession();
      const m = data._merge || {};
      const cat = data._catalogMeta || {};
      const comQtd =
        cat.comPontuacao != null
          ? cat.comPontuacao
          : (data.itens || []).filter((i) => (Number(i.qtdDeclarada) || 0) > 0)
              .length;
      const textLines = m.textLines != null ? m.textLines : data._lineCount || 0;
      const scanOnly = textLines === 0 && (m.ocrLines || 0) > 0;
      const miss = [];
      if (!data.nome) miss.push("nome");
      if (!data.siape) miss.push("SIAPE");
      if (!data.nivelRsc) miss.push("nível");
      if (!comQtd) miss.push("quantidades");
      prog.textContent =
        `Pronto · ${comQtd} item(ns) com qtd` +
        (scanOnly
          ? " · PDF só imagem (OCR)"
          : ` · fusão ${m.winner || "text/ocr"}`) +
        (m.ocrConfidence != null
          ? ` · OCR ~${Math.round(m.ocrConfidence)}%`
          : "");
      if (scanOnly && comQtd) {
        toast(
          `Este PDF não tem texto selecionável (scan/imagem). A leitura veio do OCR (~${Math.round(
            m.ocrConfidence || 0
          )}%). Confira quantidades e campos em amarelo — SIAPE ${data.siape || "—"}, RSC ${data.nivelRsc || "—"}, ${comQtd} item(ns).`,
          "warn"
        );
      } else if (miss.length) {
        toast(
          (scanOnly
            ? "PDF só imagem e o OCR não recuperou o suficiente. "
            : "Extração parcial — confira: ") +
            miss.join(", ") +
            `. ${comQtd} item(ns) com quantidade.`,
          "err"
        );
      } else {
        toast(
          `${comQtd} item(ns) com pontuação · RSC ${data.nivelRsc} · SIAPE ${data.siape}.`,
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
      vigencia: state.vigencia || fmtDateBr(todayISO()),
      comissao: RSCComissoes.getComissao(state.comissaoId),
      assinantes: collectAssinantes(),
      avaliacao: av,
      complexidadeDesc: av.nivel?.complexidadeDesc,
      itensRelatorio: (state.req.itens || [])
        .filter(
          (i) =>
            (Number(i.qtdDeclarada) || 0) > 0 ||
            (Number(i.qtdAceita) || 0) > 0 ||
            (i.diligencia && i.diligencia.texto) ||
            (i.observacao && String(i.observacao).trim())
        )
        .map((i) => ({
          criterionId: i.criterionId,
          grupo: i.grupo,
          descricao: i.descricao,
          unidade: i.unidade,
          pontosUnitario: i.pontosUnitario,
          qtdDeclarada: i.qtdDeclarada,
          qtdAceita: i.qtdAceita,
          pontosAceitos: pontosItem(i),
          observacao: i.observacao || "",
          diligencia: (i.diligencia && i.diligencia.texto) || "",
        })),
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
          "No parecer final com diligência já devolvida: informe data de envio e data de retorno à comissão.",
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

    // Data da diligência = hoje (não usa o checkbox nem a data de retorno)
    const dataDil = fmtDateBr(todayISO());

    const av = RSCRegras.avaliar(state.req, itensParaAvaliacao());
    const ctx = {
      req: state.req,
      numeroProcesso: state.numeroProcesso.trim(),
      dataRequerimento: state.dataRequerimento || "—",
      dataEnvioDiligencia: dataDil,
      comissao: RSCComissoes.getComissao(state.comissaoId),
      assinantes: collectAssinantes(),
      avaliacao: av,
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
      toast("PDF de diligência gerado (data de hoje).", "ok");
    } catch (e) {
      console.error(e);
      toast(e.message || "Erro ao gerar diligência", "err");
    }
  }

  /** Deep-clone JSON-safe (sem perder estrutura da sessão). */
  function cloneJson(obj) {
    return JSON.parse(JSON.stringify(obj === undefined ? null : obj));
  }

  function brToIsoDate(br) {
    if (!br) return "";
    const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + "-" + m[2] + "-" + m[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(br)) return br;
    return "";
  }

  /**
   * Snapshot completo da sessão — backup não deve perder informação.
   */
  function buildSnapshot() {
    const justEl = $("justificativa");
    return {
      version: SNAPSHOT_VERSION,
      app: "crsc-parecer-rsc-uffs",
      savedAt: new Date().toISOString(),
      savedAtLabel: new Date().toLocaleString("pt-BR"),
      state: {
        req: state.req ? cloneJson(state.req) : null,
        comissaoId: state.comissaoId,
        numeroProcesso: state.numeroProcesso,
        dataRequerimento: state.dataRequerimento,
        prioridade: state.prioridade,
        diligencias: state.diligencias,
        dataEnvioDiligencia: state.dataEnvioDiligencia,
        dataRetornoDiligencia: state.dataRetornoDiligencia,
        vigencia: state.vigencia,
        hipotesesSelecionadas: cloneJson(state.hipotesesSelecionadas || []),
        signerChecked: cloneJson(state.signerChecked || {}),
        hideZeroCriterios: !!state.hideZeroCriterios,
        editQtdDeclarada: !!state.editQtdDeclarada,
        compareOpen: !!state.compareOpen,
        confirmedFields: cloneJson(state.confirmedFields || {}),
        diligenciaOpenIdx: null,
        obsOpenIdx: null,
        signersPanelHidden: !!state.signersPanelHidden,
        hipotesesPanelHidden: !!state.hipotesesPanelHidden,
        _avaliacao: state._avaliacao ? cloneJson(state._avaliacao) : null,
      },
      forms: {
        justificativa: justEl ? justEl.value : "",
        numProcesso: ($("numProcesso") && $("numProcesso").value) || state.numeroProcesso,
        dataReqIso: ($("dataReq") && $("dataReq").value) || brToIsoDate(state.dataRequerimento),
        vigenciaIso: ($("vigencia") && $("vigencia").value) || brToIsoDate(state.vigencia),
        dataEnvioDil: ($("dataEnvioDil") && $("dataEnvioDil").value) || state.dataEnvioDiligencia,
        dataRetornoDil:
          ($("dataRetornoDil") && $("dataRetornoDil").value) ||
          state.dataRetornoDiligencia,
        chkPrioridade: !!(
          $("chkPrioridade") && $("chkPrioridade").checked
        ),
        chkDiligencias: !!(
          $("chkDiligencias") && $("chkDiligencias").checked
        ),
        selUnidade: ($("selUnidade") && $("selUnidade").value) || state.comissaoId,
      },
      ui: {
        step2Visible: !$("step2") || !$("step2").classList.contains("hidden"),
        step3Visible: !$("step3") || !$("step3").classList.contains("hidden"),
        fileName: ($("fileName") && $("fileName").textContent) || "",
      },
    };
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB indisponível"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("Falha ao abrir IndexedDB"));
    });
  }

  function idbGet(key) {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, "readonly");
          const g = tx.objectStore(IDB_STORE).get(key);
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        })
    );
  }

  function idbSet(key, value) {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function idbDel(key) {
    return openIdb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function updateSessionStatus(snapOrMeta) {
    const el = $("sessionStatus");
    if (!el) return;
    const m = snapOrMeta || null;
    if (!m) {
      el.textContent = "Sessão salva automaticamente neste navegador.";
      return;
    }
    const label = m.savedAtLabel || m.savedAt || "";
    const siape =
      m.siape ||
      (m.state && m.state.req && m.state.req.siape) ||
      "";
    const proc =
      m.processo ||
      (m.state && m.state.numeroProcesso) ||
      (m.forms && m.forms.numProcesso) ||
      "";
    el.textContent =
      "Sessão automática" +
      (label ? ": " + label : "") +
      (siape ? " · SIAPE " + siape : "") +
      (proc ? " · Processo " + proc : "");
  }

  /** Sempre grava no IndexedDB (silencioso). */
  async function persistSession() {
    if (suppressAutosave) return false;
    try {
      const snap = buildSnapshot();
      const meta = {
        savedAt: snap.savedAt,
        savedAtLabel: snap.savedAtLabel,
        siape: snap.state.req && snap.state.req.siape,
        processo: snap.state.numeroProcesso,
        version: snap.version,
      };
      try {
        await idbSet(IDB_KEY, snap);
        await idbSet(IDB_META_KEY, meta);
      } catch (idbErr) {
        // fallback localStorage (sessões menores)
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(snap));
          localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
        } catch (lsErr) {
          console.warn("[sessão] falha IDB e localStorage", idbErr, lsErr);
          return false;
        }
      }
      // limpa LS legado se IDB ok (evita duplicar)
      try {
        if (window.indexedDB) {
          /* keep LS only as emergency; optional clear after successful IDB */
        }
      } catch (_) {}
      updateSessionStatus(meta);
      return true;
    } catch (e) {
      console.warn("[sessão] persistência falhou", e);
      return false;
    }
  }

  function scheduleAutosave() {
    if (suppressAutosave) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      persistSession();
    }, 600);
  }

  function downloadBackup() {
    try {
      const snap = buildSnapshot();
      const json = JSON.stringify(snap, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const safe = (
        (snap.state.req && snap.state.req.siape) ||
        "sessao"
      ).replace(/\W/g, "");
      a.href = URL.createObjectURL(blob);
      a.download = `Backup_CRSC_Parecer_${safe}_${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      persistSession();
      toast("Backup completo baixado (JSON com toda a sessão).", "ok");
    } catch (e) {
      console.error(e);
      toast("Falha ao gerar backup: " + ((e && e.message) || e), "err");
    }
  }

  /** Carrega a sessão do IndexedDB (ou LS legado). Sempre na abertura. */
  async function loadPersistedSession() {
    let snap = null;
    try {
      snap = await idbGet(IDB_KEY);
    } catch (_) {
      snap = null;
    }
    if (!snap) {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          snap = JSON.parse(raw);
          // migra para IDB
          try {
            await idbSet(IDB_KEY, snap);
            if (snap.savedAt) {
              await idbSet(IDB_META_KEY, {
                savedAt: snap.savedAt,
                savedAtLabel: snap.savedAtLabel,
                siape: snap.state && snap.state.req && snap.state.req.siape,
                processo: snap.state && snap.state.numeroProcesso,
                version: snap.version,
              });
            }
          } catch (_) {}
        }
      } catch (_) {
        snap = null;
      }
    }
    if (!snap || !snap.state) {
      updateSessionStatus(null);
      return false;
    }
    const hasContent =
      snap.state.req ||
      snap.state.numeroProcesso ||
      snap.state.comissaoId ||
      (snap.state.hipotesesSelecionadas &&
        snap.state.hipotesesSelecionadas.length);
    if (!hasContent) {
      updateSessionStatus(snap);
      return false;
    }
    applySnapshot(snap, { toast: false });
    updateSessionStatus(snap);
    return true;
  }

  function applySnapshot(snap, opts) {
    opts = opts || {};
    if (!snap || !snap.state) {
      toast("Arquivo de sessão inválido ou incompleto.", "err");
      return false;
    }
    suppressAutosave = true;
    try {
      const s = snap.state;
      const f = snap.forms || {};
      const ui = snap.ui || {};

      state.req = s.req ? cloneJson(s.req) : null;
      state.comissaoId = s.comissaoId || f.selUnidade || "";
      state.numeroProcesso = s.numeroProcesso || f.numProcesso || "";
      state.dataRequerimento = s.dataRequerimento || "";
      state.prioridade =
        s.prioridade != null ? !!s.prioridade : !!f.chkPrioridade;
      state.diligencias =
        s.diligencias != null ? !!s.diligencias : !!f.chkDiligencias;
      state.dataEnvioDiligencia =
        s.dataEnvioDiligencia || f.dataEnvioDil || "";
      state.dataRetornoDiligencia =
        s.dataRetornoDiligencia || f.dataRetornoDil || "";
      state.vigencia = s.vigencia || "";
      state.hipotesesSelecionadas = cloneJson(
        s.hipotesesSelecionadas || []
      );
      state.signerChecked = cloneJson(s.signerChecked || {});
      state.hideZeroCriterios =
        s.hideZeroCriterios != null ? !!s.hideZeroCriterios : true;
      state.editQtdDeclarada = !!s.editQtdDeclarada;
      state.compareOpen = !!s.compareOpen;
      state.confirmedFields = cloneJson(s.confirmedFields || {});
      state.diligenciaOpenIdx = null;
      state.obsOpenIdx = null;
      state.signersPanelHidden = !!s.signersPanelHidden;
      state.hipotesesPanelHidden = !!s.hipotesesPanelHidden;
      state._avaliacao = s._avaliacao ? cloneJson(s._avaliacao) : null;

      // formulários
      if ($("numProcesso"))
        $("numProcesso").value = state.numeroProcesso || "";
      if ($("selUnidade")) $("selUnidade").value = state.comissaoId || "";
      if ($("dataReq")) {
        $("dataReq").value =
          f.dataReqIso || brToIsoDate(state.dataRequerimento) || "";
      }
      if ($("vigencia")) {
        $("vigencia").value =
          f.vigenciaIso || brToIsoDate(state.vigencia) || todayISO();
        if (!state.vigencia) state.vigencia = fmtDateBr($("vigencia").value);
      }
      if ($("chkPrioridade"))
        $("chkPrioridade").checked = state.prioridade;
      if ($("chkDiligencias"))
        $("chkDiligencias").checked = state.diligencias;
      if ($("dataEnvioDil"))
        $("dataEnvioDil").value = state.dataEnvioDiligencia || "";
      if ($("dataRetornoDil"))
        $("dataRetornoDil").value = state.dataRetornoDiligencia || "";
      if ($("justificativa"))
        $("justificativa").value = f.justificativa || "";
      if ($("fileName"))
        $("fileName").textContent =
          ui.fileName ||
          (state.req && state.req._sourceName) ||
          (state.req ? "Sessão restaurada" : "");

      syncDiligenciaDatasUI();
      renderSigners();
      const sigPanel = $("signersPanel");
      const toggleSig = $("toggleSigners");
      if (sigPanel) {
        if (state.signersPanelHidden) sigPanel.classList.add("hidden");
        else sigPanel.classList.remove("hidden");
      }
      if (toggleSig) {
        toggleSig.textContent = state.signersPanelHidden
          ? "Mostrar assinantes"
          : "Ocultar assinantes";
      }

      renderHipotesesDropdown();
      const hipPanel = $("hipotesesPanel");
      if (hipPanel) {
        if (state.hipotesesPanelHidden) hipPanel.classList.add("hidden");
        else hipPanel.classList.remove("hidden");
      }

      if (state.req) {
        $("step2").classList.remove("hidden");
        $("step3").classList.remove("hidden");
        const btnCmp = $("btnToggleCompare");
        if (btnCmp) btnCmp.disabled = false;
        renderIdent();
        renderChecklist();
        renderCompare();
        updateAvaliacao();
        checkImpedimento();
        updateDiligenciaBtn();
      } else {
        $("step2").classList.add("hidden");
        $("step3").classList.add("hidden");
        if ($("identBox")) {
          $("identBox").classList.add("hidden");
          $("identBox").innerHTML = "";
        }
        if ($("compareBox")) {
          $("compareBox").classList.add("hidden");
          $("compareBox").innerHTML = "";
        }
        if ($("checklistBody")) $("checklistBody").innerHTML = "";
        if ($("metricsBox")) $("metricsBox").innerHTML = "";
      }

      updateSessionStatus(snap);
      if (opts.toast !== false) {
        toast(
          "Sessão restaurada" +
            (snap.savedAtLabel ? " (" + snap.savedAtLabel + ")" : "") +
            ".",
          "ok"
        );
      }
      return true;
    } catch (e) {
      console.error(e);
      toast("Falha ao restaurar sessão: " + ((e && e.message) || e), "err");
      return false;
    } finally {
      suppressAutosave = false;
    }
  }

  async function clearLocalData() {
    const ok = window.confirm(
      "Limpar todos os dados locais deste navegador e reiniciar a tela?\n\nIsso não apaga arquivos de backup que você já baixou."
    );
    if (!ok) return;
    suppressAutosave = true;
    try {
      await idbDel(IDB_KEY);
      await idbDel(IDB_META_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_META_KEY);
    } catch (_) {}

    // reset state
    state.req = null;
    state.comissaoId = "";
    state.numeroProcesso = "";
    state.dataRequerimento = "";
    state.prioridade = false;
    state.diligencias = false;
    state.dataEnvioDiligencia = "";
    state.dataRetornoDiligencia = "";
    state.vigencia = fmtDateBr(todayISO());
    state.hipotesesSelecionadas = [];
    state.signerChecked = {};
    state.hideZeroCriterios = true;
    state.editQtdDeclarada = false;
    state.compareOpen = false;
    state.confirmedFields = {};
    state.diligenciaOpenIdx = null;
    state.obsOpenIdx = null;
    state.signersPanelHidden = false;
    state.hipotesesPanelHidden = false;
    state._avaliacao = null;

    if ($("numProcesso")) $("numProcesso").value = "";
    if ($("selUnidade")) $("selUnidade").value = "";
    if ($("dataReq")) $("dataReq").value = "";
    if ($("vigencia")) $("vigencia").value = todayISO();
    if ($("chkPrioridade")) $("chkPrioridade").checked = false;
    if ($("chkDiligencias")) $("chkDiligencias").checked = false;
    if ($("dataEnvioDil")) $("dataEnvioDil").value = "";
    if ($("dataRetornoDil")) $("dataRetornoDil").value = "";
    if ($("justificativa")) $("justificativa").value = "";
    if ($("fileName")) $("fileName").textContent = "";
    if ($("ocrProgress")) {
      $("ocrProgress").textContent = "";
      $("ocrProgress").classList.add("hidden");
    }
    if ($("ocrBar")) $("ocrBar").classList.add("hidden");
    if ($("identBox")) {
      $("identBox").classList.add("hidden");
      $("identBox").innerHTML = "";
    }
    if ($("compareBox")) {
      $("compareBox").classList.add("hidden");
      $("compareBox").innerHTML = "";
    }
    if ($("step2")) $("step2").classList.add("hidden");
    if ($("step3")) $("step3").classList.add("hidden");
    if ($("checklistBody")) $("checklistBody").innerHTML = "";
    if ($("metricsBox")) $("metricsBox").innerHTML = "";
    if ($("hipotesesBox")) $("hipotesesBox").classList.add("hidden");
    if ($("btnParecer")) $("btnParecer").disabled = true;
    if ($("btnToggleCompare")) $("btnToggleCompare").disabled = true;
    if ($("fileInput")) $("fileInput").value = "";

    syncDiligenciaDatasUI();
    renderSigners();
    renderHipotesesDropdown();
    updateDiligenciaBtn();
    updateSessionStatus(null);
    suppressAutosave = false;
    toast("Dados locais apagados. Sessão reiniciada.", "ok");
  }

  async function restoreFromBackupFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const snap = JSON.parse(text);
      if (!snap.state && !snap.version) {
        toast("JSON não parece um backup desta ferramenta.", "err");
        return;
      }
      if (applySnapshot(snap)) {
        persistSession();
      }
    } catch (e) {
      console.error(e);
      toast("Não foi possível ler o arquivo de backup.", "err");
    }
  }

  function bind() {
    fillUnidades();
    renderHipotesesDropdown();
    updateSessionStatus(null);

    const msgOk = $("msgModalOk");
    if (msgOk) msgOk.addEventListener("click", closeMsgModal);
    const msgBack = $("msgModalBackdrop");
    if (msgBack) msgBack.addEventListener("click", closeMsgModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMsgModal();
    });

    // Backup / limpar (sessão é automática via IndexedDB)
    if ($("btnBackup"))
      $("btnBackup").addEventListener("click", downloadBackup);
    if ($("btnClearLocal"))
      $("btnClearLocal").addEventListener("click", () => {
        clearLocalData();
      });
    if ($("btnRestoreBackup")) {
      $("btnRestoreBackup").addEventListener("click", () => {
        const inp = $("backupFileInput");
        if (inp) inp.click();
      });
    }
    if ($("backupFileInput")) {
      $("backupFileInput").addEventListener("change", () => {
        const f = $("backupFileInput").files && $("backupFileInput").files[0];
        if (f) restoreFromBackupFile(f);
        $("backupFileInput").value = "";
      });
    }

    $("selUnidade").addEventListener("change", (e) => {
      state.comissaoId = e.target.value;
      state.signerChecked = {};
      renderSigners();
      scheduleAutosave();
    });
    $("numProcesso").addEventListener("input", (e) => {
      state.numeroProcesso = e.target.value;
      scheduleAutosave();
    });
    $("dataReq").addEventListener("change", (e) => {
      state.dataRequerimento = e.target.value
        ? e.target.value.split("-").reverse().join("/")
        : "";
      scheduleAutosave();
    });
    $("chkPrioridade").addEventListener("change", (e) => {
      state.prioridade = e.target.checked;
      scheduleAutosave();
    });
    $("chkDiligencias").addEventListener("change", (e) => {
      state.diligencias = e.target.checked;
      syncDiligenciaDatasUI();
      scheduleAutosave();
    });
    const envDil = $("dataEnvioDil");
    if (envDil) {
      envDil.addEventListener("change", (e) => {
        state.dataEnvioDiligencia = e.target.value;
        scheduleAutosave();
      });
    }
    const retDil = $("dataRetornoDil");
    if (retDil) {
      retDil.addEventListener("change", (e) => {
        state.dataRetornoDiligencia = e.target.value;
        scheduleAutosave();
      });
    }
    $("vigencia").addEventListener("change", (e) => {
      state.vigencia = e.target.value
        ? e.target.value.split("-").reverse().join("/")
        : "";
      scheduleAutosave();
    });
    if ($("justificativa")) {
      $("justificativa").addEventListener("input", () => scheduleAutosave());
    }
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
    const btnEditQ = $("btnEditQtdDecl");
    if (btnEditQ) {
      btnEditQ.addEventListener("click", () => {
        state.editQtdDeclarada = !state.editQtdDeclarada;
        renderChecklist();
        toast(
          state.editQtdDeclarada
            ? "Quantidades declaradas editáveis (destaque amarelo)."
            : "Edição das quantidades declaradas concluída.",
          "info"
        );
      });
    }
    const btnCmp = $("btnToggleCompare");
    if (btnCmp) {
      btnCmp.addEventListener("click", () => {
        if (!state.req) return;
        state.compareOpen = !state.compareOpen;
        renderCompare();
      });
    }
    const btnEditIdent = $("btnEditIdent");
    if (btnEditIdent) {
      btnEditIdent.addEventListener("click", () => {
        if (!state.req) return;
        state.editIdentFields = !state.editIdentFields;
        renderIdent();
        toast(
          state.editIdentFields
            ? "Campos liberados para edição manual."
            : "Edição dos campos concluída.",
          "info"
        );
        scheduleAutosave();
      });
    }
    $("btnParecer").addEventListener("click", gerarParecer);
    const btnDil = $("btnGerarDiligencia");
    if (btnDil) btnDil.addEventListener("click", gerarDiligencia);
    syncDiligenciaDatasUI();

    // vigência padrão = hoje
    const vig = $("vigencia");
    if (vig && !vig.value) {
      vig.value = todayISO();
      state.vigencia = fmtDateBr(todayISO());
    }

    // toggle painel hipóteses
    const toggle = $("toggleHipoteses");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const panel = $("hipotesesPanel");
        if (!panel) return;
        panel.classList.toggle("hidden");
        state.hipotesesPanelHidden = panel.classList.contains("hidden");
        scheduleAutosave();
      });
    }
    // toggle painel assinantes
    const toggleSig = $("toggleSigners");
    if (toggleSig) {
      toggleSig.addEventListener("click", () => {
        const panel = $("signersPanel");
        if (!panel) return;
        panel.classList.toggle("hidden");
        state.signersPanelHidden = panel.classList.contains("hidden");
        toggleSig.textContent = state.signersPanelHidden
          ? "Mostrar assinantes"
          : "Ocultar assinantes";
        scheduleAutosave();
      });
    }

    // Sempre puxa a sessão do IndexedDB (até limpar dados)
    loadPersistedSession()
      .then((restored) => {
        if (restored) {
          toast("Sessão restaurada automaticamente do navegador.", "info");
        }
      })
      .catch((e) => console.warn("[sessão] restore", e));
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
