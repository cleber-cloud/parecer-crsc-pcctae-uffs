/**
 * Gera PDF do parecer CRSC-PCCTAE.
 */
(function (global) {
  "use strict";

  let fontCache = null;
  let brasaoCache = null;

  async function loadFonts(pdf) {
    if (!global.PDFLib) throw new Error("PDFLib não carregado");
    const fk = global.fontkit;
    if (fk && typeof pdf.registerFontkit === "function") pdf.registerFontkit(fk);
    else if (global.PDFLib.PDFDocument.registerFontkit && fk) {
      global.PDFLib.PDFDocument.registerFontkit(fk);
    }
    if (!fontCache) {
      const [r, b] = await Promise.all([
        fetch("./vendor/fonts/NotoSans-Regular.ttf").then((x) => x.arrayBuffer()),
        fetch("./vendor/fonts/NotoSans-Bold.ttf").then((x) => x.arrayBuffer()),
      ]);
      fontCache = { r: new Uint8Array(r), b: new Uint8Array(b) };
    }
    const font = await pdf.embedFont(fontCache.r, { subset: true });
    const fontBold = await pdf.embedFont(fontCache.b, { subset: true });
    return { font, fontBold };
  }

  async function loadBrasao(pdf) {
    if (!brasaoCache) {
      try {
        const res = await fetch("./brasaodarepublica.png");
        if (res.ok) brasaoCache = new Uint8Array(await res.arrayBuffer());
      } catch (_) {}
    }
    if (!brasaoCache) return null;
    try {
      return await pdf.embedPng(brasaoCache);
    } catch (_) {
      try {
        return await pdf.embedJpg(brasaoCache);
      } catch (_) {
        return null;
      }
    }
  }

  function wrap(text, font, size, maxW) {
    const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) line = t;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  async function gerarParecerPdf(ctx) {
    const { PDFDocument, rgb } = global.PDFLib;
    const pdf = await PDFDocument.create();
    const { font, fontBold } = await loadFonts(pdf);
    const brasao = await loadBrasao(pdf);
    const W = 595.28;
    const H = 841.89;
    const margin = 48;
    const maxW = W - margin * 2;
    const black = rgb(0.08, 0.08, 0.08);
    const green = rgb(0, 0.5, 0.22);

    let page = pdf.addPage([W, H]);
    let y = H - 36;

    function newPage() {
      page = pdf.addPage([W, H]);
      y = H - margin;
    }
    function ensure(h) {
      if (y - h < margin) newPage();
    }
    function text(str, opts) {
      const size = opts.size || 10;
      const f = opts.bold ? fontBold : font;
      const color = opts.color || black;
      const align = opts.align || "left";
      const lines = wrap(str, f, size, opts.maxW || maxW);
      const lh = opts.lh || size + 4;
      for (const ln of lines) {
        ensure(lh);
        let x = margin;
        if (align === "center") {
          x = (W - f.widthOfTextAtSize(ln, size)) / 2;
        }
        page.drawText(ln, { x, y: y - size, size, font: f, color });
        y -= lh;
      }
    }
    function gap(n) {
      y -= n || 8;
    }
    function line() {
      ensure(10);
      page.drawLine({
        start: { x: margin, y },
        end: { x: W - margin, y },
        thickness: 0.6,
        color: rgb(0.7, 0.7, 0.7),
      });
      y -= 12;
    }

    const proc = ctx.numeroProcesso || "23205.XXXXXX/20XX-XX";
    const unidadeNome = ctx.comissao?.nome || "—";

    // Cabeçalho: brasão + textos centralizados
    if (brasao) {
      const bw = 72;
      const bh = (brasao.height / brasao.width) * bw;
      page.drawImage(brasao, {
        x: (W - bw) / 2,
        y: y - bh,
        width: bw,
        height: bh,
      });
      y -= bh + 14;
    } else {
      gap(8);
    }

    text("UNIVERSIDADE FEDERAL DA FRONTEIRA SUL — CRSC-PCCTAE", {
      size: 11,
      bold: true,
      align: "center",
      lh: 15,
    });
    text(unidadeNome, {
      size: 11,
      bold: true,
      align: "center",
      lh: 15,
    });
    gap(8);
    text(
      "Parecer sobre Requerimento de Reconhecimento de Saberes e Competências",
      { size: 11, bold: true, align: "center", lh: 14 }
    );
    gap(4);
    text(`Processo: ${proc}`, {
      size: 11,
      bold: true,
      align: "center",
      lh: 14,
    });
    gap(12);
    line();

    text("1. Identificação", { size: 12, bold: true });
    gap(4);
    const idLines = [
      `Servidor: ${ctx.req.nome || "—"}`,
      `Matrícula SIAPE: ${ctx.req.siape || "—"}`,
      `Cargo: ${ctx.req.cargo || "—"}`,
      `Lotação: ${ctx.req.lotacao || "—"}`,
      `Data de início do exercício no cargo atual: ${ctx.req.dataIngresso || "—"}`,
      `Nível de RSC requerido: ${ctx.avaliacao.nivel?.nome || ctx.req.nivelRsc || "—"}`,
      `Percentual correspondente: ${ctx.avaliacao.percentual != null ? ctx.avaliacao.percentual + "%" : "—"}`,
      `Data do requerimento: ${ctx.dataRequerimento || "—"}`,
      `Se enquadra nos requisitos legais de prioridade: ${ctx.prioridade ? "[X] Sim  [ ] Não" : "[ ] Sim  [X] Não"}`,
    ];
    idLines.forEach((l) => text(l, { size: 10 }));
    gap(10);

    text("2. Análise da Comissão", { size: 12, bold: true });
    gap(4);
    text(
      "Solicitação de Reconhecimento de Saberes e Competências: Após análise da documentação constante do processo, a Comissão verificou o atendimento dos requisitos previstos no Decreto nº 13.048/2026 e no Regimento da Comissão de Reconhecimento de Saberes e Competências:",
      { size: 10, lh: 13 }
    );
    gap(6);
    text(`Pontuação mínima exigida: ${ctx.avaliacao.minPontos ?? "—"}`, { size: 10 });
    text(`Pontuação obtida: ${ctx.avaliacao.pontosObtidos ?? "—"}`, { size: 10 });
    text(`Quantidade mínima de critérios exigida: ${ctx.avaliacao.minItens ?? "—"}`, { size: 10 });
    text(`Quantidade de critérios comprovados: ${ctx.avaliacao.qtdCriterios ?? "—"}`, { size: 10 });
    text(
      `Saldo de pontuação para novos pedidos: ${ctx.avaliacao.saldoPontuacao ?? "—"}`,
      { size: 10 }
    );
    text(
      `Houve diligências: ${ctx.diligencias ? "[X] Sim   [ ] Não" : "[ ] Sim   [X] Não"}`,
      { size: 10 }
    );
    if (ctx.diligencias) {
      text(
        `Data de envio da diligência ao servidor: ${ctx.dataEnvioDiligencia || "____/____/________"}`,
        { size: 10 }
      );
      text(
        `Data de retorno do processo à comissão: ${ctx.dataRetornoDiligencia || "____/____/________"}`,
        { size: 10 }
      );
    }
    if (ctx.complexidadeDesc) {
      text(`Requisito de complexidade: ${ctx.complexidadeDesc} — ${ctx.avaliacao.complexidadeOk ? "atendido" : "não atendido"}`, { size: 10 });
    }
    gap(10);

    text("3. Parecer CRSC", { size: 12, bold: true });
    gap(4);
    const fav = !!ctx.avaliacao.favoravel;
    text(
      `Parecer: ${fav ? "[X] Favorável  [ ] Não Favorável" : "[ ] Favorável  [X] Não Favorável"}`,
      { size: 10, bold: true }
    );
    gap(4);
    if (!fav) {
      text("Justificativa (caso Não Favorável):", { size: 10, bold: true });
      const just = ctx.justificativa || "—";
      text(just, { size: 10, lh: 13 });
      gap(6);
      if (ctx.hipotesesArt14 && ctx.hipotesesArt14.length) {
        text(
          "Incisos do art. 14 aplicados: " + ctx.hipotesesArt14.join(", ") + ".",
          { size: 9 }
        );
        gap(4);
      }
    } else {
      text("Justificativa (caso Não Favorável): —", { size: 10 });
      gap(4);
    }
    text(
      `Nível concedido: ${fav ? ctx.avaliacao.nivel?.nome || "—" : "Não concedido"}`,
      { size: 10 }
    );
    text(
      `Percentual correspondente: ${fav && ctx.avaliacao.percentual != null ? ctx.avaliacao.percentual + "%" : "—"}`,
      { size: 10 }
    );
    text(
      `Vigência da Concessão a partir de: ${fav ? ctx.vigencia || "____/____/________" : "—"}`,
      { size: 10 }
    );
    gap(14);

    text("4. Assinaturas da CRSC-PCCTAE", { size: 12, bold: true });
    gap(4);
    text(
      `Unidade: ${ctx.comissao?.nome || "—"} | Designação: Portaria nº ${ctx.comissao?.portariaDesignacao || "—"}`,
      { size: 9 }
    );
    gap(10);

    const signers = ctx.assinantes || [];
    signers.forEach((s) => {
      ensure(50);
      text(`${s.nome}`, { size: 10, bold: true });
      text(`SIAPE ${s.siape} — ${s.segmento || ""} (${s.funcao || "Titular"})`, {
        size: 9,
      });
      text("_________________________________", { size: 10 });
      gap(12);
    });

    gap(8);
    text(
      `Documento gerado em ${new Date().toLocaleString("pt-BR")} — ferramenta CRSC Parecer RSC-UFFS (teste). A deliberação formal permanece com a comissão.`,
      { size: 8, color: rgb(0.4, 0.4, 0.4) }
    );

    const bytes = await pdf.save({ useObjectStreams: false });
    return new Uint8Array(bytes);
  }

  /**
   * PDF de diligência: dados do processo, itens diligenciados, textos e assinaturas.
   */
  async function gerarDiligenciaPdf(ctx) {
    const { PDFDocument, rgb } = global.PDFLib;
    const pdf = await PDFDocument.create();
    const { font, fontBold } = await loadFonts(pdf);
    const brasao = await loadBrasao(pdf);
    const W = 595.28;
    const H = 841.89;
    const margin = 48;
    const maxW = W - margin * 2;
    const black = rgb(0.08, 0.08, 0.08);

    let page = pdf.addPage([W, H]);
    let y = H - 36;

    function newPage() {
      page = pdf.addPage([W, H]);
      y = H - margin;
    }
    function ensure(h) {
      if (y - h < margin) newPage();
    }
    function text(str, opts) {
      const size = (opts && opts.size) || 10;
      const f = opts && opts.bold ? fontBold : font;
      const color = (opts && opts.color) || black;
      const align = (opts && opts.align) || "left";
      const lines = wrap(str, f, size, (opts && opts.maxW) || maxW);
      const lh = (opts && opts.lh) || size + 4;
      for (const ln of lines) {
        ensure(lh);
        let x = margin;
        if (align === "center") {
          x = (W - f.widthOfTextAtSize(ln, size)) / 2;
        }
        page.drawText(ln, { x, y: y - size, size, font: f, color });
        y -= lh;
      }
    }
    function gap(n) {
      y -= n || 8;
    }
    function line() {
      ensure(10);
      page.drawLine({
        start: { x: margin, y },
        end: { x: W - margin, y },
        thickness: 0.6,
        color: rgb(0.7, 0.7, 0.7),
      });
      y -= 12;
    }

    const proc = ctx.numeroProcesso || "—";
    const unidadeNome = (ctx.comissao && ctx.comissao.nome) || "—";

    if (brasao) {
      const bw = 72;
      const bh = (brasao.height / brasao.width) * bw;
      page.drawImage(brasao, {
        x: (W - bw) / 2,
        y: y - bh,
        width: bw,
        height: bh,
      });
      y -= bh + 14;
    } else {
      gap(8);
    }

    text("UNIVERSIDADE FEDERAL DA FRONTEIRA SUL — CRSC-PCCTAE", {
      size: 11,
      bold: true,
      align: "center",
      lh: 15,
    });
    text(unidadeNome, { size: 11, bold: true, align: "center", lh: 15 });
    gap(8);
    text("Diligência — Requerimento de RSC-PCCTAE", {
      size: 12,
      bold: true,
      align: "center",
      lh: 15,
    });
    gap(4);
    text(`Processo: ${proc}`, {
      size: 11,
      bold: true,
      align: "center",
      lh: 14,
    });
    gap(12);
    line();

    text("1. Dados do processo e do(a) servidor(a)", { size: 12, bold: true });
    gap(4);
    [
      `Servidor(a): ${(ctx.req && ctx.req.nome) || "—"}`,
      `Matrícula SIAPE: ${(ctx.req && ctx.req.siape) || "—"}`,
      `Cargo: ${(ctx.req && ctx.req.cargo) || "—"}`,
      `Lotação: ${(ctx.req && ctx.req.lotacao) || "—"}`,
      `Nível de RSC requerido: ${(ctx.req && ctx.req.nivelRsc) || "—"}`,
      `Data do requerimento: ${ctx.dataRequerimento || "—"}`,
      `Data de envio da diligência ao servidor: ${
        ctx.dataEnvioDiligencia || "____/____/________"
      }`,
      `Data de retorno do processo à comissão (se houver): ${
        ctx.dataRetornoDiligencia || "____/____/________"
      }`,
    ].forEach((l) => text(l, { size: 10 }));
    gap(12);

    text("2. Critérios objeto da diligência", { size: 12, bold: true });
    gap(4);
    text(
      "A Comissão solicita o esclarecimento e/ou a complementação documental dos critérios específicos abaixo, no prazo e forma estabelecidos no regimento da CRSC-PCCTAE e na legislação aplicável.",
      { size: 10, lh: 13 }
    );
    gap(8);

    const itens = ctx.itensDiligencia || [];
    if (!itens.length) {
      text("Nenhum item marcado para diligência.", { size: 10 });
    } else {
      itens.forEach((it, i) => {
        ensure(90);
        text(
          `${i + 1}) Critério ${it.criterionId || "—"} (Grupo ${it.grupo || "—"})`,
          { size: 10, bold: true }
        );
        text(it.descricao || "—", { size: 9, lh: 12 });
        text(
          `Unidade: ${it.unidade || "—"} · Pts/unid.: ${
            it.pontosUnitario != null ? it.pontosUnitario : "—"
          } · Qtd declarada: ${
            it.qtdDeclarada != null ? it.qtdDeclarada : "—"
          } · Qtd aceita (parcial): ${
            it.qtdAceita != null ? it.qtdAceita : "—"
          }`,
          { size: 9 }
        );
        text("Diligência solicitada:", { size: 9, bold: true });
        text(it.texto || "—", { size: 10, lh: 13 });
        gap(10);
      });
    }

    gap(6);
    text("3. Encaminhamento", { size: 12, bold: true });
    gap(4);
    text(
      "Devolve-se o processo ao(à) servidor(a) interessado(a) para cumprimento da diligência, com posterior retorno à CRSC-PCCTAE para continuidade da análise do requerimento de RSC-PCCTAE.",
      { size: 10, lh: 13 }
    );
    gap(14);

    text("4. Assinaturas da CRSC-PCCTAE", { size: 12, bold: true });
    gap(4);
    text(
      `Unidade: ${unidadeNome} | Designação: Portaria nº ${
        (ctx.comissao && ctx.comissao.portariaDesignacao) || "—"
      }`,
      { size: 9 }
    );
    gap(10);

    const signers = ctx.assinantes || [];
    if (!signers.length) {
      text(
        "(Nenhum assinante selecionado na ferramenta — inclua os membros da comissão antes de gerar.)",
        { size: 9, color: rgb(0.5, 0.2, 0.1) }
      );
    }
    signers.forEach((s) => {
      ensure(50);
      text(`${s.nome}`, { size: 10, bold: true });
      text(`SIAPE ${s.siape} — ${s.segmento || ""} (${s.funcao || "Titular"})`, {
        size: 9,
      });
      text("_________________________________", { size: 10 });
      gap(12);
    });

    gap(8);
    text(
      `Documento gerado em ${new Date().toLocaleString(
        "pt-BR"
      )} — ferramenta CRSC Parecer RSC-UFFS (teste).`,
      { size: 8, color: rgb(0.4, 0.4, 0.4) }
    );

    const bytes = await pdf.save({ useObjectStreams: false });
    return new Uint8Array(bytes);
  }

  global.RSCParecerPdf = { gerarParecerPdf, gerarDiligenciaPdf };
})(typeof window !== "undefined" ? window : globalThis);
