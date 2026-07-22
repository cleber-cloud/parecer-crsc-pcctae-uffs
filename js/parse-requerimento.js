/**
 * Extrai dados do PDF de Requerimento RSC gerado pela calculadora UFFS.
 */
(function (global) {
  "use strict";

  function normalize(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function parseNumberBR(s) {
    if (s == null || s === "") return null;
    const t = String(s).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function afterLabel(text, label) {
    const re = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:]?\\s*([^\\n]+)",
      "i"
    );
    const m = text.match(re);
    return m ? m[1].trim() : "";
  }

  /**
   * @param {string} fullText
   */
  function parseRequerimentoText(fullText) {
    const text = normalize(fullText);
    const flat = text.replace(/\n/g, " ");

    const nome =
      afterLabel(text, "Nome") ||
      (flat.match(/Nome:\s*([A-Za-zÀ-ú' .\-]+?)\s+SIAPE/i) || [])[1] ||
      "";
    const siape =
      afterLabel(text, "SIAPE") ||
      (flat.match(/SIAPE:\s*(\d{5,8})/i) || [])[1] ||
      "";
    const cargo =
      afterLabel(text, "Cargo") ||
      (flat.match(/Cargo:\s*([^\n]+?)(?:Data de ingresso|N[ií]vel)/i) || [])[1] ||
      "";
    const ingresso =
      afterLabel(text, "Data de ingresso em IFE") ||
      afterLabel(text, "Data de ingresso") ||
      (flat.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] ||
      "";
    const lotacao =
      afterLabel(text, "Lota[cç][aã]o".replace(/\\/g, "")) ||
      afterLabel(text, "Lotação") ||
      (flat.match(/Lota[cç][aã]o:\s*(.+?)\s+(?:Fun[cç][aã]o|E-mail)/i) ||
        [])[1] ||
      "";
    const email =
      afterLabel(text, "E-mail") ||
      (flat.match(/([a-z0-9._%+-]+@uffs\.edu\.br)/i) || [])[1] ||
      "";

    // Nível de classificação A-E
    let nivelClassificacao = "";
    if (/N[ií]vel de Classifica[cç][aã]o:[\s\S]{0,40}\bE\b/i.test(text) && /\[\s*[xX]\s*\]\s*E|E\s*[xX]/i.test(text)) {
      // heuristic
    }
    const classMatch = text.match(/N[ií]vel de Classifica[cç][aã]o:[\s\S]{0,80}?([A-E])\s*(?:\[?\s*[xX])/i)
      || text.match(/\b([A-E])\s*\[?\s*[xX]\s*\]?\s*(?:\n|Fun|E-mail|2\.)/i);
    // From sample: E is checked
    if (/N[ií]vel de Classifica[cç][aã]o[\s\S]{0,30}E/i.test(text)) {
      // try find X near E
      if (/E\s*\[?\s*[xX]|\[\s*[xX]\s*\]\s*E|E\s*[xX]/i.test(text) || /Classifica[cç][aã]o:[\s\S]{0,50}E/i.test(text)) {
        nivelClassificacao = "E";
      }
    }

    // Nível RSC pretendido
    let nivelRsc = "";
    const niveis = ["VI", "V", "IV", "III", "II", "I"];
    for (const n of niveis) {
      const re = new RegExp(
        "(?:\\[\\s*[xX]\\s*\\]|[xX])\\s*RSC-PCCTAE\\s*" + n + "\\b|RSC-PCCTAE\\s*" + n + "\\s*(?:\\[\\s*[xX]\\s*\\]|[xX])",
        "i"
      );
      if (re.test(text) || new RegExp("RSC-PCCTAE\\s*" + n + "[\\s\\S]{0,15}[xX]", "i").test(text)) {
        // weaker: if "Nível de RSC pretendido" section has X next to VI
        nivelRsc = n;
        break;
      }
    }
    // fallback from "nível RSC-PCCTAE VI"
    if (!nivelRsc) {
      const m = text.match(/n[ií]vel\s+RSC-PCCTAE\s+(I{1,3}|IV|V|VI)\b/i);
      if (m) nivelRsc = m[1].toUpperCase();
    }
    // sample PDF has X RSC-PCCTAE VI
    if (!nivelRsc && /RSC-PCCTAE\s+VI/i.test(text) && /pretendido/i.test(text)) {
      nivelRsc = "VI";
    }

    const pontMin =
      parseNumberBR(
        (text.match(/Pontua[cç][aã]o m[ií]nima necess[aá]ria:\s*([\d.,]+)/i) ||
          [])[1]
      ) || null;
    const pontTotal =
      parseNumberBR(
        (text.match(/Pontua[cç][aã]o total apresentada:\s*([\d.,]+)/i) || [])[1]
      ) || null;
    const qtdCriterios =
      parseNumberBR(
        (text.match(
          /Quantidade de crit[eé]rios espec[ií]ficos utilizados:\s*([\d.,]+)/i
        ) || [])[1]
      ) || null;
    const excedente =
      parseNumberBR(
        (text.match(
          /Pontua[cç][aã]o total excedente[^:]*:\s*([\d.,]+)/i
        ) || [])[1]
      ) || 0;
    const saldoAnterior =
      parseNumberBR(
        (text.match(
          /Saldo de pontua[cç][aã]o de concess[aã]o anterior:\s*([\d.,]+)/i
        ) || [])[1]
      ) || 0;

    // Itens: linhas com pontuação obtida — extrair blocos por "Critério X -"
    const itens = [];
    const critBlocks = text.split(/Crit[eé]rio\s+(I{1,3}|IV|V|VI)\s*[-–—]/i);
    // split gives [before, g1, after, g2, after...]
    for (let i = 1; i < critBlocks.length; i += 2) {
      const grupo = String(critBlocks[i]).toUpperCase();
      const body = critBlocks[i + 1] || "";
      const end = body.search(/Crit[eé]rio\s+(I{1,3}|IV|V|VI)\s*[-–—]|TOTAL\s*\(|4\.\s*DECLARA/i);
      const chunk = end >= 0 ? body.slice(0, end) : body;

      // find numeric rows: description ... unit points unit points obtained
      // Pattern: number then description then "Por ..." then two numbers
      const rowRe =
        /(\d+)\s+([\s\S]+?)\s+(Por [^\d\n]+?)\s+([\d]+[.,][\d]+|[\d]+)\s+([\d]+[.,][\d]+|[\d]+)/gi;
      let m;
      const seen = new Set();
      while ((m = rowRe.exec(chunk)) !== null) {
        const desc = m[2].replace(/\s+/g, " ").trim();
        if (/^Subtotal/i.test(desc) || desc.length < 20) continue;
        const key = grupo + "|" + desc.slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        const pontosUnit = parseNumberBR(m[4]);
        const pontosObtidos = parseNumberBR(m[5]);
        // skip subtotal lines where "pontos" are huge headers
        if (pontosObtidos == null) continue;
        itens.push({
          grupo,
          n: Number(m[1]),
          descricao: desc,
          unidade: m[3].replace(/\s+/g, " ").trim(),
          pontosUnitario: pontosUnit,
          pontosObtidos,
          aceito: "pend", // pend | ok | no
          obs: "",
        });
      }
    }

    // fallback simpler extraction if no items
    if (!itens.length) {
      const simple = [
        ...text.matchAll(
          /(Participa[cç][aã]o|Exerc[ií]cio|Elabora[cç][aã]o|Atua[cç][aã]o|Apresenta[cç][aã]o|Coordena[cç][aã]o|Recebimento|Produ[cç][aã]o|Autoria|Conclus[aã]o)[^\n]{20,220}/gi
        ),
      ];
      simple.forEach((m, idx) => {
        itens.push({
          grupo: null,
          n: idx + 1,
          descricao: m[0].replace(/\s+/g, " ").trim(),
          unidade: "",
          pontosUnitario: null,
          pontosObtidos: null,
          aceito: "pend",
          obs: "",
        });
      });
    }

    return {
      nome: nome.replace(/\s+SIAPE.*$/i, "").trim(),
      siape: String(siape).replace(/\D/g, ""),
      cargo: cargo.replace(/\s+Data.*$/i, "").trim(),
      dataIngresso: ingresso,
      nivelClassificacao: nivelClassificacao || "E",
      lotacao: lotacao.replace(/\s+Fun[cç].*$/i, "").trim(),
      email: email.trim(),
      nivelRsc: nivelRsc,
      pontuacaoMinimaDeclarada: pontMin,
      pontuacaoTotalDeclarada: pontTotal,
      qtdCriteriosDeclarada: qtdCriterios,
      excedenteDeclarado: excedente,
      saldoAnterior,
      itens,
      rawPreview: text.slice(0, 1500),
    };
  }

  async function extractPdfText(fileOrArrayBuffer) {
    if (!global.pdfjsLib) throw new Error("pdf.js não carregado");
    const data =
      fileOrArrayBuffer instanceof ArrayBuffer
        ? fileOrArrayBuffer
        : await fileOrArrayBuffer.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data }).promise;
    let full = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((it) => it.str);
      full += strings.join(" ") + "\n";
    }
    return full;
  }

  async function parseRequerimentoPdf(file) {
    const text = await extractPdfText(file);
    const data = parseRequerimentoText(text);
    data._textLength = text.length;
    data._sourceName = file.name || "requerimento.pdf";
    return data;
  }

  global.RSCParseRequerimento = {
    parseRequerimentoPdf,
    parseRequerimentoText,
    extractPdfText,
  };
})(typeof window !== "undefined" ? window : globalThis);
