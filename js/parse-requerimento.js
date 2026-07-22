/**
 * Extrai dados do PDF de Requerimento RSC (calculadora UFFS).
 * Usa ordenação espacial (pdf.js) — o texto vem sem rótulos fixos.
 */
(function (global) {
  "use strict";

  function parseNumberBR(s) {
    if (s == null || s === "") return null;
    const t = String(s).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function clean(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Agrupa itens de texto por linha (Y) e ordena.
   */
  async function extractPdfTextStructured(fileOrArrayBuffer) {
    if (!global.pdfjsLib) throw new Error("pdf.js não carregado");
    const data =
      fileOrArrayBuffer instanceof ArrayBuffer
        ? fileOrArrayBuffer
        : await fileOrArrayBuffer.arrayBuffer();
    const pdf = await global.pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    let flat = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str || !String(it.str).trim()) continue;
        const tr = it.transform || [1, 0, 0, 1, 0, 0];
        const x = tr[4];
        const y = Math.round(tr[5] * 2) / 2; // bucket Y
        const key = y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ x, str: it.str });
      }
      const ys = [...rows.keys()].sort((a, b) => b - a); // top to bottom
      const lines = ys.map((y) => {
        const parts = rows.get(y).sort((a, b) => a.x - b.x);
        return parts.map((p) => p.str).join(" ");
      });
      pages.push(lines);
      flat += lines.join("\n") + "\n";
    }
    return { flat: clean(flat.replace(/\n/g, " ")), lines: pages.flat().map(clean), raw: flat };
  }

  function inferGrupo(descricao) {
    const d = descricao.toLowerCase();
    if (/membro de n[uú]cleos|comiss[oõ]es ou comit|conselhos superiores|defensor dativo|exame de sele/i.test(d))
      return "I";
    if (
      /atividades t[eé]cnicas e\/ou especializadas em projetos|projetos institucionais|capacita[cç][aã]o, f[oó]rum|forma[cç][aã]o continuada|orienta[cç][aã]o, tutoria|coopera[cç][aã]o t[eé]cnica|oficina, workshop/i.test(
        d
      )
    )
      return "II";
    if (/premia[cç][aã]o/i.test(d)) return "III";
    if (/fiscaliza[cç][aã]o de contratos|termo de refer[eê]ncia|planejamento de contrata|licita[cç][aã]o|sistemas estruturantes|insalubridade|respons[aá]vel por setor/i.test(d))
      return "IV";
    if (/cargo de dire[cç][aã]o|fun[cç][aã]o gratificada|cd\s*-?\s*0|fg\s*-?\s*0/i.test(d))
      return "V";
    if (/patente|propriedade intelectual|transfer[eê]ncia de tecnologia|incentivo [aà] qualifica|grupo de pesquisa|capta[cç][aã]o de recursos|cap[ií]tulo de livro|congresso|difus[aã]o|coorienta|epidem|pandemia|obra art[ií]stica|material t[eé]cnico/i.test(d))
      return "VI";
    return null;
  }

  /**
   * Parse de linhas do tipo:
   * 1 Descrição ... Por designação 3,0 9,0
   */
  function parseItensFromFlat(flat) {
    const itens = [];
    // split before each "N Descrição" that ends with Por ... pts pts
    const re =
      /(\d{1,2})\s+((?:Participa[cç][aã]o|Exerc[ií]cio|Elabora[cç][aã]o|Atua[cç][aã]o|Apresenta[cç][aã]o|Coordena[cç][aã]o|Recebimento|Produ[cç][aã]o|Autoria|Conclus[aã]o|Desempenho|Publica[cç][aã]o|Avalia[cç][aã]o|Representa[cç][aã]o|Carta patente)[\s\S]*?)\s+(Por\s+.+?)\s+(\d{1,3}[.,]\d)\s+(\d{1,3}[.,]\d)/gi;

    let m;
    const seen = new Set();
    while ((m = re.exec(flat)) !== null) {
      let desc = clean(m[2]);
      // cut if glued next item number at end
      desc = desc.replace(/\s+\d{1,2}\s+(Participa|Exerc|Elabora|Atua|Apresenta|Coordena|Receb|Produ|Autoria|Conclus).*$/i, "");
      const unidade = clean(m[3]);
      const pu = parseNumberBR(m[4]);
      const po = parseNumberBR(m[5]);
      if (po == null || desc.length < 25) continue;
      // skip declaration junk
      if (/declaro|fatos apresentados|responsabilidade administrativa/i.test(desc)) continue;
      const key = desc.slice(0, 80) + "|" + po;
      if (seen.has(key)) continue;
      seen.add(key);
      let qtd = null;
      if (pu && pu > 0 && po != null) {
        qtd = Math.round((po / pu) * 1000) / 1000;
        // inteiro quando quase inteiro
        if (Math.abs(qtd - Math.round(qtd)) < 1e-6) qtd = Math.round(qtd);
      }
      itens.push({
        grupo: inferGrupo(desc),
        n: Number(m[1]),
        descricao: desc,
        unidade,
        pontosUnitario: pu,
        pontosObtidos: po,
        qtdDeclarada: qtd,
        qtdAceita: qtd, // comissão pode reduzir (parcial)
        aceito: "pend",
        obs: "",
      });
    }
    return itens;
  }

  function parseHeader(flat) {
    // Nome SIAPE Cargo data A B C D E Lotação email
    const m = flat.match(
      /^([A-Za-zÀ-ÿ' .\-]{5,80}?)\s+(\d{6,8})\s+([A-Za-zÀ-ÿ /]{3,60}?)\s+(\d{2}\/\d{2}\/\d{4})\s+A\s+B\s+C\s+D\s+E\s+(.+?)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i
    );
    if (m) {
      return {
        nome: clean(m[1]),
        siape: m[2],
        cargo: clean(m[3]),
        dataIngresso: m[4],
        lotacao: clean(m[5]),
        email: m[6],
        nivelClassificacao: "E",
      };
    }
    // fallback looser
    const siape = (flat.match(/\b(\d{6,8})\b/) || [])[1] || "";
    const email = (flat.match(/([a-z0-9._%+-]+@uffs\.edu\.br)/i) || [])[1] || "";
    const dataIngresso = (flat.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";
    const nome = clean((flat.match(/^([A-Za-zÀ-ÿ' .\-]{5,80}?)\s+\d{6,8}/) || [])[1] || "");
    return {
      nome,
      siape,
      cargo: "",
      dataIngresso,
      lotacao: "",
      email,
      nivelClassificacao: "E",
    };
  }

  function inferNivel(flat, pontTotal, qtdItens, grupos) {
    // explicit
    if (/n[ií]vel\s+RSC[\s\-]*PCCTAE\s*(I{1,3}|IV|V|VI)\b/i.test(flat)) {
      return flat.match(/n[ií]vel\s+RSC[\s\-]*PCCTAE\s*(I{1,3}|IV|V|VI)\b/i)[1].toUpperCase();
    }
    // from totals
    const min = parseNumberBR((flat.match(/m[ií]nima[^0-9]{0,20}(\d{1,3}(?:[.,]\d)?)/i) || [])[1]);
    if (min === 75 || min === 75.0) return "VI";
    if (min === 52) return "V";
    if (min === 30) return "IV";
    if (min === 25) return "III";
    if (min === 15) return "II";
    if (min === 10) return "I";
    // infer by complexity + points
    const g = new Set(grupos || []);
    const p = pontTotal || 0;
    if (g.has("VI") && p >= 75) return "VI";
    if ((g.has("IV") || g.has("V") || g.has("VI")) && p >= 52) return "V";
    if (p >= 75) return "VI";
    if (p >= 52) return "V";
    if (p >= 30) return "IV";
    if (p >= 25) return "III";
    if (p >= 15) return "II";
    if (p >= 10) return "I";
    return "";
  }

  function parseRequerimentoText(flatInput) {
    const flat = clean(flatInput);
    const header = parseHeader(flat);
    const itens = parseItensFromFlat(flat);
    const pontTotal =
      itens.reduce((s, i) => s + (Number(i.pontosObtidos) || 0), 0) ||
      parseNumberBR((flat.match(/totalizo\s+(\d{1,3}(?:[.,]\d)?)/i) || [])[1]);
    const pontMin = parseNumberBR(
      (flat.match(/m[ií]nima(?:\s+necess[aá]ria)?[^0-9]{0,15}(\d{1,3}(?:[.,]\d)?)/i) ||
        [])[1]
    );
    const qtd =
      itens.length ||
      parseNumberBR(
        (flat.match(/crit[eé]rios espec[ií]ficos utilizados[^0-9]{0,10}(\d{1,2})/i) ||
          [])[1]
      );
    const grupos = itens.map((i) => i.grupo).filter(Boolean);
    const nivelRsc = inferNivel(flat, pontTotal, qtd, grupos);
    const nivelObj = global.RSCRegras && global.RSCRegras.NIVEIS[nivelRsc];
    const minOficial = nivelObj ? nivelObj.minPontos : pontMin;
    const excedente =
      pontTotal != null && minOficial != null
        ? Math.round((pontTotal - minOficial) * 10) / 10
        : parseNumberBR((flat.match(/excedente[^0-9]{0,20}(\d{1,3}(?:[.,]\d)?)/i) || [])[1]);
    const saldoAnterior =
      parseNumberBR(
        (flat.match(/saldo de pontua[cç][aã]o[^0-9]{0,25}(\d{1,3}(?:[.,]\d)?)/i) ||
          [])[1]
      ) || 0;

    return {
      nome: header.nome,
      siape: header.siape,
      cargo: header.cargo,
      dataIngresso: header.dataIngresso,
      nivelClassificacao: header.nivelClassificacao,
      lotacao: header.lotacao,
      email: header.email,
      nivelRsc,
      pontuacaoMinimaDeclarada: minOficial ?? pontMin,
      pontuacaoTotalDeclarada: Math.round((pontTotal || 0) * 10) / 10,
      qtdCriteriosDeclarada: qtd,
      excedenteDeclarado: excedente,
      saldoAnterior,
      itens,
      rawPreview: flat.slice(0, 1200),
    };
  }

  async function parseRequerimentoPdf(file) {
    const structured = await extractPdfTextStructured(file);
    // Usar texto espacial (linhas) + flat único (evita duplicar itens)
    const data = parseRequerimentoText(structured.flat);
    if (!data.nome && structured.lines[0]) {
      const h2 = parseHeader(structured.lines.slice(0, 8).join(" "));
      Object.assign(data, Object.fromEntries(Object.entries(h2).filter(([, v]) => v)));
    }
    // reparse itens a partir de flat only already done
    data._textLength = structured.flat.length;
    data._sourceName = file.name || "requerimento.pdf";
    data._lineCount = structured.lines.length;
    return data;
  }

  global.RSCParseRequerimento = {
    parseRequerimentoPdf,
    parseRequerimentoText,
    extractPdfText: async (f) => (await extractPdfTextStructured(f)).flat,
  };
})(typeof window !== "undefined" ? window : globalThis);
