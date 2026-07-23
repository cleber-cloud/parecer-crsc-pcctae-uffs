/**
 * Gera PDF do parecer CRSC-PCCTAE e PDF de diligência.
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
    const words = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ");
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

  function makeDrawer(pdf, fonts, opts) {
    const { font, fontBold } = fonts;
    const { PDFDocument, rgb } = global.PDFLib;
    const W = 595.28;
    const H = 841.89;
    const margin = opts && opts.margin != null ? opts.margin : 48;
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
    function text(str, o) {
      o = o || {};
      const size = o.size || 10;
      const f = o.bold ? fontBold : font;
      const color = o.color || black;
      const align = o.align || "left";
      const lines = wrap(str, f, size, o.maxW || maxW);
      const lh = o.lh || size + 4;
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
    /** Rótulo normal + valor em negrito (respostas em destaque). */
    function kv(label, value, o) {
      o = o || {};
      const size = o.size || 10;
      const lh = o.lh || size + 4;
      const lab = String(label || "");
      const val = String(value == null || value === "" ? "—" : value);
      const labW = font.widthOfTextAtSize(lab, size);
      const avail = maxW - labW - 2;
      if (avail < 40) {
        text(lab, { size, bold: false });
        text(val, { size, bold: true, lh });
        return;
      }
      const valLines = wrap(val, fontBold, size, avail);
      ensure(lh * valLines.length);
      page.drawText(lab, {
        x: margin,
        y: y - size,
        size,
        font,
        color: black,
      });
      page.drawText(valLines[0], {
        x: margin + labW,
        y: y - size,
        size,
        font: fontBold,
        color: black,
      });
      y -= lh;
      for (let i = 1; i < valLines.length; i++) {
        ensure(lh);
        page.drawText(valLines[i], {
          x: margin + labW,
          y: y - size,
          size,
          font: fontBold,
          color: black,
        });
        y -= lh;
      }
    }

    return {
      W,
      H,
      margin,
      maxW,
      black,
      page: () => page,
      y: () => y,
      setY: (v) => {
        y = v;
      },
      newPage,
      ensure,
      gap,
      line,
      text,
      kv,
      font,
      fontBold,
      rgb,
    };
  }

  function assinantesOrdenados(ctx) {
    const signers = Array.isArray(ctx.assinantes) ? ctx.assinantes : [];
    const relatorSiape = ctx.relator && String(ctx.relator.siape || "");
    const relator = relatorSiape
      ? signers.find((s) => String(s.siape) === relatorSiape)
      : null;
    const restantes = relator
      ? signers.filter((s) => String(s.siape) !== relatorSiape)
      : signers;
    return relator
      ? [
          { membro: relator, isRelator: true },
          ...restantes.map((membro) => ({ membro, isRelator: false })),
        ]
      : restantes.map((membro) => ({ membro, isRelator: false }));
  }

  function linhaAssinante(item) {
    const s = item.membro;
    return `SIAPE ${s.siape} — ${s.segmento || ""} (${s.funcao || "Titular"})`;
  }

  async function gerarParecerPdf(ctx) {
    const { PDFDocument, rgb } = global.PDFLib;
    const pdf = await PDFDocument.create();
    const fonts = await loadFonts(pdf);
    const brasao = await loadBrasao(pdf);
    const d = makeDrawer(pdf, fonts);
    const { text, kv, gap, line, ensure, newPage } = d;

    const proc = ctx.numeroProcesso || "23205.XXXXXX/20XX-XX";
    const unidadeNome = (ctx.comissao && ctx.comissao.nome) || "—";
    const fav = !!(ctx.avaliacao && ctx.avaliacao.favoravel);

    if (brasao) {
      const bw = 72;
      const bh = (brasao.height / brasao.width) * bw;
      d.ensure(bh + 14);
      const page = d.page();
      page.drawImage(brasao, {
        x: (d.W - bw) / 2,
        y: d.y() - bh,
        width: bw,
        height: bh,
      });
      d.setY(d.y() - bh - 14);
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
    kv("Servidor(a): ", (ctx.req && ctx.req.nome) || "—");
    kv("Matrícula SIAPE: ", (ctx.req && ctx.req.siape) || "—");
    kv("Cargo: ", (ctx.req && ctx.req.cargo) || "—");
    kv("Lotação: ", (ctx.req && ctx.req.lotacao) || "—");
    kv(
      "Data de início do exercício no cargo atual: ",
      (ctx.req && ctx.req.dataIngresso) || "—"
    );
    kv(
      "Nível de RSC requerido: ",
      (ctx.avaliacao && ctx.avaliacao.nivel && ctx.avaliacao.nivel.nome) ||
        (ctx.req && ctx.req.nivelRsc) ||
        "—"
    );
    kv(
      "Percentual correspondente: ",
      ctx.avaliacao && ctx.avaliacao.percentual != null
        ? ctx.avaliacao.percentual + "%"
        : "—"
    );
    kv("Data do requerimento: ", ctx.dataRequerimento || "—");
    kv(
      "Se enquadra nos requisitos legais de prioridade: ",
      ctx.prioridade ? "Sim" : "Não"
    );
    gap(10);

    text("2. Análise da Comissão", { size: 12, bold: true });
    gap(4);
    text(
      "Solicitação de Reconhecimento de Saberes e Competências: Após análise da documentação constante do processo, a Comissão verificou o atendimento dos requisitos previstos no Decreto nº 13.048/2026 e no Regimento da Comissão de Reconhecimento de Saberes e Competências:",
      { size: 10, lh: 13 }
    );
    gap(6);
    kv(
      "Pontuação mínima exigida: ",
      ctx.avaliacao && ctx.avaliacao.minPontos != null
        ? String(ctx.avaliacao.minPontos)
        : "—"
    );
    kv(
      "Pontuação obtida: ",
      ctx.avaliacao && ctx.avaliacao.pontosObtidos != null
        ? String(ctx.avaliacao.pontosObtidos)
        : "—"
    );
    kv(
      "Quantidade mínima de critérios exigida: ",
      ctx.avaliacao && ctx.avaliacao.minItens != null
        ? String(ctx.avaliacao.minItens)
        : "—"
    );
    kv(
      "Quantidade de critérios comprovados: ",
      ctx.avaliacao && ctx.avaliacao.qtdCriterios != null
        ? String(ctx.avaliacao.qtdCriterios)
        : "—"
    );
    kv(
      "Saldo de pontuação para novos pedidos: ",
      ctx.avaliacao && ctx.avaliacao.saldoPontuacao != null
        ? String(ctx.avaliacao.saldoPontuacao)
        : "—"
    );
    kv("Houve diligências: ", ctx.diligencias ? "Sim" : "Não");
    if (ctx.diligencias) {
      kv(
        "Data de envio da diligência ao servidor: ",
        ctx.dataEnvioDiligencia || "____/____/________"
      );
      kv(
        "Data de retorno do processo à comissão: ",
        ctx.dataRetornoDiligencia || "____/____/________"
      );
    }
    if (ctx.complexidadeDesc) {
      kv(
        "Requisito de complexidade: ",
        ctx.complexidadeDesc +
          " — " +
          (ctx.avaliacao && ctx.avaliacao.complexidadeOk
            ? "atendido"
            : "não atendido")
      );
    }
    gap(10);

    text("3. Memorial", { size: 12, bold: true });
    gap(4);
    text("Análise do mérito do memorial apresentado.", { size: 10, lh: 13 });
    kv(
      "Resultado: ",
      ctx.memorialFavoravel === false ? "Não favorável" : "Favorável"
    );
    gap(10);

    text("4. Parecer CRSC", { size: 12, bold: true });
    gap(4);
    kv("Parecer: ", fav ? "Favorável" : "Não Favorável");
    gap(4);
    if (!fav) {
      text("Justificativa (caso Não Favorável):", { size: 10, bold: true });
      text(ctx.justificativa || "—", { size: 10, lh: 13 });
      gap(6);
      if (ctx.hipotesesArt14 && ctx.hipotesesArt14.length) {
        kv("Incisos do art. 14 aplicados: ", ctx.hipotesesArt14.join(", "));
        gap(4);
      }
    } else {
      kv("Justificativa (caso Não Favorável): ", "—");
      gap(2);
    }
    kv(
      "Nível concedido: ",
      fav
        ? (ctx.avaliacao && ctx.avaliacao.nivel && ctx.avaliacao.nivel.nome) ||
            "—"
        : "Não concedido"
    );
    kv(
      "Percentual correspondente: ",
      fav && ctx.avaliacao && ctx.avaliacao.percentual != null
        ? ctx.avaliacao.percentual + "%"
        : "—"
    );
    kv(
      "Vigência da Concessão a partir de: ",
      fav ? ctx.vigencia || "____/____/________" : "—"
    );
    gap(14);

    // 5. Assinaturas: título e unidade à esquerda; nomes centralizados
    text("5. Assinaturas da CRSC-PCCTAE", {
      size: 12,
      bold: true,
    });
    gap(4);
    text(
      `Unidade: ${unidadeNome} | Designação: Portaria nº ${
        (ctx.comissao && ctx.comissao.portariaDesignacao) || "—"
      }`,
      { size: 9 }
    );
    gap(12);

    assinantesOrdenados(ctx).forEach((item) => {
      const s = item.membro;
      ensure(48);
      text(`${s.nome}`, { size: 10, bold: true, align: "center" });
      text(linhaAssinante(item), {
        size: 9,
        align: "center",
      });
      if (item.isRelator) {
        text("Relator(a)", { size: 9, bold: true, align: "center" });
      }
      gap(22);
    });

    // ——— ANEXO: relatório auxiliar (nova página) ———
    newPage();
    text("ANEXO", {
      size: 14,
      bold: true,
      align: "center",
      lh: 18,
    });
    gap(4);
    text("Relatório auxiliar da análise por critério", {
      size: 12,
      bold: true,
      align: "center",
      lh: 15,
    });
    gap(4);
    text(`Processo: ${proc}`, {
      size: 10,
      bold: true,
      align: "center",
      lh: 13,
    });
    text(
      `Servidor(a): ${(ctx.req && ctx.req.nome) || "—"} · SIAPE ${
        (ctx.req && ctx.req.siape) || "—"
      }`,
      { size: 9, align: "center", lh: 12 }
    );
    gap(8);
    line();
    text(
      "Este anexo é material de apoio à comissão. Resume o que o(a) servidor(a) declarou, o que a comissão aceitou e eventuais ressalvas (observações ou diligências) por critério específico do RSC-PCCTAE, conforme legislação aplicável.",
      { size: 9, lh: 12 }
    );
    gap(10);

    const rel = ctx.itensRelatorio || [];
    if (!rel.length) {
      text(
        "Nenhum critério com quantidade, observação ou diligência para listar.",
        { size: 10 }
      );
    } else {
      const order = ["I", "II", "III", "IV", "V", "VI"];
      order.forEach((g) => {
        const items = rel.filter((it) => String(it.grupo) === g);
        if (!items.length) return;
        text(`Anexo ${g}`, { size: 11, bold: true });
        gap(4);
        items.forEach((it, idx) => {
          ensure(70);
          kv(
            `${idx + 1}. Item ${it.criterionId || "—"}: `,
            (it.descricao || "—").slice(0, 180) +
              ((it.descricao || "").length > 180 ? "…" : "")
          );
          text(
            `Unidade de medida: ${it.unidade || "—"} · Pontos por unidade: ${
              it.pontosUnitario != null ? it.pontosUnitario : "—"
            }`,
            { size: 9 }
          );
          kv("Quantidade declarada: ", String(it.qtdDeclarada ?? 0));
          kv("Quantidade aceita pela comissão: ", String(it.qtdAceita ?? 0));
          kv(
            "Pontos aceitos (qtd aceita × pts/unid.): ",
            String(it.pontosAceitos ?? 0)
          );
          if (it.observacao) {
            kv("Observação da comissão: ", it.observacao);
          }
          if (it.diligencia) {
            kv("Diligência registrada no item: ", it.diligencia);
          }
          gap(8);
        });
      });
      const somaAceita = rel.reduce(
        (s, it) => s + (Number(it.pontosAceitos) || 0),
        0
      );
      gap(2);
      kv(
        "Total de pontos aceitos neste relatório: ",
        String(Math.round(somaAceita * 10) / 10)
      );
    }
    gap(10);
    text(
      "Fim do anexo — relatório auxiliar.",
      { size: 8, color: rgb(0.4, 0.4, 0.4) }
    );

    const bytes = await pdf.save({ useObjectStreams: false });
    return new Uint8Array(bytes);
  }

  /**
   * PDF de diligência: data = dia da geração; sem data de retorno.
   * Independente do checkbox "Houve diligências" (usado só no parecer final).
   */
  async function gerarDiligenciaPdf(ctx) {
    const { PDFDocument, rgb } = global.PDFLib;
    const pdf = await PDFDocument.create();
    const fonts = await loadFonts(pdf);
    const brasao = await loadBrasao(pdf);
    const d = makeDrawer(pdf, fonts);
    const { text, kv, gap, line, ensure } = d;

    const proc = ctx.numeroProcesso || "—";
    const unidadeNome = (ctx.comissao && ctx.comissao.nome) || "—";
    // data da diligência = informada pelo app (padrão: hoje)
    const dataDil =
      ctx.dataEnvioDiligencia ||
      new Date().toLocaleDateString("pt-BR");

    if (brasao) {
      const bw = 72;
      const bh = (brasao.height / brasao.width) * bw;
      d.ensure(bh + 14);
      const page = d.page();
      page.drawImage(brasao, {
        x: (d.W - bw) / 2,
        y: d.y() - bh,
        width: bw,
        height: bh,
      });
      d.setY(d.y() - bh - 14);
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
    kv("Servidor(a): ", (ctx.req && ctx.req.nome) || "—");
    kv("Matrícula SIAPE: ", (ctx.req && ctx.req.siape) || "—");
    kv("Cargo: ", (ctx.req && ctx.req.cargo) || "—");
    kv("Lotação: ", (ctx.req && ctx.req.lotacao) || "—");
    kv("Nível de RSC requerido: ", (ctx.req && ctx.req.nivelRsc) || "—");
    kv("Data do requerimento: ", ctx.dataRequerimento || "—");
    kv("Data da diligência: ", dataDil);
    gap(12);

    const itens = ctx.itensDiligencia || [];
    const dilGeral = (ctx.diligenciaGeral || "").trim();
    let sec = 2;

    if (itens.length) {
      text(`${sec}. Critérios objeto da diligência`, { size: 12, bold: true });
      gap(4);
      text(
        "A Comissão solicita o esclarecimento e/ou a complementação documental dos critérios específicos abaixo, no prazo e forma estabelecidos no regimento da CRSC-PCCTAE e na legislação aplicável.",
        { size: 10, lh: 13 }
      );
      gap(8);
      itens.forEach((it, i) => {
        ensure(90);
        text(
          `${i + 1}) Item ${it.criterionId || "—"} (Anexo ${
            it.grupo || "—"
          })`,
          { size: 10, bold: true }
        );
        text(it.descricao || "—", { size: 9, lh: 12 });
        text(
          `Unidade: ${it.unidade || "—"} · Pts/unid.: ${
            it.pontosUnitario != null ? it.pontosUnitario : "—"
          } · Qtd declarada: ${
            it.qtdDeclarada != null ? it.qtdDeclarada : "—"
          }`,
          { size: 9 }
        );
        text("Diligência solicitada:", { size: 9, bold: true });
        text(it.texto || "—", { size: 10, lh: 13, bold: true });
        gap(10);
      });
      sec++;
      gap(6);
    }

    if (dilGeral) {
      text(`${sec}. Diligência geral`, {
        size: 12,
        bold: true,
      });
      gap(4);
      text(
        "A Comissão solicita o seguinte esclarecimento ou complementação, de natureza geral, sem vinculação direta a um critério específico do RSC-PCCTAE:",
        { size: 10, lh: 13 }
      );
      gap(6);
      text(dilGeral, { size: 10, lh: 13, bold: true });
      sec++;
      gap(10);
    }

    if (!itens.length && !dilGeral) {
      text("2. Conteúdo da diligência", { size: 12, bold: true });
      gap(4);
      text("Nenhuma diligência registrada.", { size: 10 });
      sec = 3;
      gap(6);
    }

    text(`${sec}. Encaminhamento`, { size: 12, bold: true });
    gap(4);
    text(
      "Devolve-se o processo ao(à) servidor(a) interessado(a) para cumprimento da diligência, com posterior retorno à CRSC-PCCTAE para continuidade da análise do requerimento de RSC-PCCTAE.",
      { size: 10, lh: 13 }
    );
    gap(14);

    sec++;
    text(`${sec}. Assinaturas da CRSC-PCCTAE`, { size: 12, bold: true });
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
    assinantesOrdenados(ctx).forEach((item) => {
      const s = item.membro;
      ensure(48);
      text(`${s.nome}`, { size: 10, bold: true, align: "center" });
      text(linhaAssinante(item), {
        size: 9,
        align: "center",
      });
      if (item.isRelator) {
        text("Relator(a)", { size: 9, bold: true, align: "center" });
      }
      gap(22);
    });

    const bytes = await pdf.save({ useObjectStreams: false });
    return new Uint8Array(bytes);
  }

  global.RSCParecerPdf = { gerarParecerPdf, gerarDiligenciaPdf };
})(typeof window !== "undefined" ? window : globalThis);
