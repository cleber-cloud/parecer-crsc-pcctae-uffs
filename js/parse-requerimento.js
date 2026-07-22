/**
 * Extrai dados do PDF de Requerimento RSC (calculadora UFFS).
 * Estratégia: linhas espaciais (pdf.js) + merge de critérios multilinha.
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
      .replace(/[�]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Normaliza PDF impresso do HTML (espaços em e-mail, rótulos "Nome :", RSC - PCCTAE). */
  function normalizeLine(s) {
    let t = clean(s);
    t = t.replace(/\bfi\s*le:\/\//gi, "file://");
    t = t.replace(/\bRSC\s*-\s*PCCTAE\b/gi, "RSC-PCCTAE");
    t = t.replace(/\bE\s*-\s*mail\b/gi, "E-mail");
    t = t.replace(/\bPró\s*-\s*reitoria\b/gi, "Pró-reitoria");
    t = t.replace(/\bCD\s*-\s*0/gi, "CD-0");
    t = t.replace(/\bFG\s*-\s*0/gi, "FG-0");
    // e-mail com espaços: ricardo . conceicao @ uffs . edu . br
    t = t.replace(
      /([a-z0-9._%+-]+(?:\s*\.\s*[a-z0-9._%+-]+)*)\s*@\s*([a-z0-9.-]+(?:\s*\.\s*[a-z0-9.-]+)+)/gi,
      (_, u, d) => u.replace(/\s+/g, "") + "@" + d.replace(/\s+/g, "")
    );
    // "Nome : valor" -> "Nome: valor"
    t = t.replace(
      /^(Nome|SIAPE|Cargo|Data de ingresso(?: em IFE)?|Lota[cç][aã]o|E-mail|Fun[cç][aã]o[^:]*)\s*:\s*/i,
      (_, lab) => lab.replace(/\s+/g, " ").trim() + ": "
    );
    t = t.replace(/\s*:\s*/g, (m, offset, str) => {
      // keep single colon spacing only for mid-line labels already handled
      return m;
    });
    t = t.replace(/:\s+/g, ": ");
    return clean(t);
  }

  function isNoiseLine(ln) {
    const s = clean(ln);
    if (!s) return true;
    if (/^\d+\s+of\s+\d+/i.test(s)) return true;
    if (/\d+\/\d+$/i.test(s) && /file:/i.test(s)) return true;
    if (/^file:\/\//i.test(s)) return true;
    if (/Requerimento de RSC/i.test(s) && (/file:/i.test(s) || /^\d{2}\/\d{2}\/\d{4}/.test(s)))
      return true;
    if (/Organize os itens de acordo/i.test(s)) return true;
    if (/conforme os requisitos do art/i.test(s)) return true;
    if (/^MINIST[EÉ]RIO DA EDUCA/i.test(s)) return true;
    if (/^UNIVERSIDADE FEDERAL/i.test(s)) return true;
    if (/^PR[OÓ]-REITORIA/i.test(s)) return true;
    if (/^REQUERIMENTO DE/i.test(s)) return true;
    if (/^\d+\.\s*IDENTIFICA/i.test(s)) return true;
    if (/^\d+\.\s*INFORMA/i.test(s)) return true;
    if (/^\d+\.\s*DESCRI/i.test(s)) return true;
    if (/^\d+\.\s*DECLARA/i.test(s)) return true;
    if (/^Crit[eé]rio\s+(I{1,3}|IV|V|VI)\b/i.test(s)) return true;
    if (/^Subtotal/i.test(s)) return true;
    if (/^TOTAL\s*\(/i.test(s)) return true;
    if (/^N[ºo°]\s+CRIT/i.test(s)) return true;
    if (/^UNIDADE DE MEDIDA/i.test(s)) return true;
    if (/^PONTUA/i.test(s) && /OBTIDA/i.test(s)) return true;
    if (/^Gerado em/i.test(s)) return true;
    if (/^Declaração de conformidade/i.test(s)) return true;
    if (/^Declaro,/i.test(s)) return true;
    if (/^[IVX]+\s*-\s*Todos os fatos/i.test(s)) return true;
    if (/^[IVX]+\s*-\s*Nenhuma atividade/i.test(s)) return true;
    if (/^[IVX]+\s*-\s*Toda a documenta/i.test(s)) return true;
    if (/^[IVX]+\s*-\s*Tenho ci[eê]ncia/i.test(s)) return true;
    if (/^-\s*Todos os fatos/i.test(s)) return true;
    if (/^-\s*Nenhuma atividade/i.test(s)) return true;
    if (/^-\s*Toda a documenta/i.test(s)) return true;
    if (/^-\s*Tenho ci[eê]ncia/i.test(s)) return true;
    if (/^À vista das informa/i.test(s)) return true;
    if (/^Nome:\s*$/i.test(s) || /^SIAPE:\s*$/i.test(s)) return true;
    return false;
  }

  async function extractPdfLines(fileOrArrayBuffer) {
    if (!global.pdfjsLib) throw new Error("pdf.js não carregado");
    const data = await toArrayBuffer(fileOrArrayBuffer);
    const pdf = await global.pdfjsLib.getDocument({ data }).promise;
    const allLines = [];
    const allItems = [];
    let rawJoin = "";

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const it of content.items) {
        const str = String(it.str || "");
        if (!str) continue;
        rawJoin += str + " ";
        if (!str.trim()) continue;
        const tr = it.transform || [1, 0, 0, 1, 0, 0];
        const x = tr[4];
        const y = Math.round(tr[5] * 4) / 4;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x, str, width: it.width || 0 });
        allItems.push({ page: p, x, y, str });
      }
      const ys = [...rows.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        const parts = rows.get(y).sort((a, b) => a.x - b.x);
        const line = clean(parts.map((p) => p.str).join(" "));
        if (line) allLines.push(line);
      }
    }
    return {
      lines: allLines,
      items: allItems,
      rawJoin: clean(rawJoin),
      numPages: pdf.numPages,
    };
  }

  function inferGrupo(descricao) {
    const d = descricao.toLowerCase();
    if (
      /coordena[cç][aã]o ou presid[eê]ncia|membro de n[uú]cleos|representa[cç][aã]o legal da institui|conselhos superiores|defensor dativo|exame de sele|comiss[oõ]es ou comit/i.test(
        d
      )
    )
      return "I";
    if (
      /atividades t[eé]cnicas e\/ou especializadas em projetos|produ[cç][aã]o ou reformula[cç][aã]o de material|forma[cç][aã]o continuada|capacita[cç][aã]o, f[oó]rum|oficina, workshop|orienta[cç][aã]o, tutoria|coopera[cç][aã]o t[eé]cnica|projetos institucionais/i.test(
        d
      )
    )
      return "II";
    if (/premia[cç][aã]o/i.test(d)) return "III";
    if (
      /fiscaliza[cç][aã]o de contratos|termo de refer[eê]ncia|planejamento de contrata|licita[cç][aã]o|sistemas estruturantes|tecnicamente qualificada na opera|insalubridade|respons[aá]vel por setor/i.test(
        d
      )
    )
      return "IV";
    if (
      /cargo de dire[cç][aã]o|fun[cç][aã]o gratificada|cd\s*-?\s*0|fg\s*-?\s*0/i.test(d)
    )
      return "V";
    if (
      /patente|propriedade intelectual|transfer[eê]ncia de tecnologia|educa[cç][aã]o formal superior|incentivo [aà] qualifica|grupo de pesquisa|capta[cç][aã]o de recursos|publica[cç][aã]o ou organiza[cç][aã]o de livro|cap[ií]tulo de livro|congresso|difus[aã]o|instrutor|palestrante|coorienta|epidem|pandemia|obra art[ií]stica|material t[eé]cnico/i.test(
        d
      )
    )
      return "VI";
    return null;
  }

  const ITEM_START =
    /Coordena|Participa|Exerc[ií]cio|Elabora|Atua|Apresenta|Recebimento|Produ|Autoria|Conclus|Desempenho|Publica|Avalia|Representa|Carta patente|Coopera/i;

  const UNIT =
    "Por\\s+(?:designa[cç][aã]o|projeto|produto|evento|sistema|curso|publica[cç][aã]o|patente|capacita[cç][aã]o|mandato|ano ou fra[cç][aã]o(?:\\s+acima de seis meses)?)";
  const SCORE_TAIL = new RegExp(
    "(" + UNIT + ")\\s+(\\d{1,3}[.,]\\d)\\s+(\\d{1,3}[.,]\\d)",
    "gi"
  );

  function pushItem(itens, seen, n, desc, unidade, pu, po) {
    desc = clean(desc);
    unidade = clean(unidade);
    if (/^Por ano ou fra/i.test(unidade) && !/seis meses/i.test(unidade)) {
      unidade = "Por ano ou fração acima de seis meses";
    }
    if (po == null || !pu || desc.length < 15) return;
    if (/declaro|fatos apresentados|responsabilidade administrativa/i.test(desc))
      return;
    const key = desc.slice(0, 90) + "|" + po + "|" + pu;
    if (seen.has(key)) return;
    seen.add(key);
    let qtd = Math.round((po / pu) * 1000) / 1000;
    if (Math.abs(qtd - Math.round(qtd)) < 1e-6) qtd = Math.round(qtd);
    itens.push({
      grupo: inferGrupo(desc),
      n: n,
      descricao: desc,
      unidade,
      pontosUnitario: pu,
      pontosObtidos: po,
      qtdDeclarada: qtd,
      qtdAceita: qtd,
      aceito: "pend",
      obs: "",
    });
  }

  /**
   * Extrai itens:
   * - linha completa: "N desc Por unidade X,X Y,Y"
   * - descrição multilinha: pontos na 1ª linha; continuações logo abaixo
   * - vários itens colados na mesma linha (alguns PDFs da calculadora)
   */
  function parseItensFromLines(lines) {
    const usable = lines.filter((l) => !isNoiseLine(l));
    const itens = [];
    const seen = new Set();

    let pending = null; // { n, desc, unidade, pu, po }

    function flushPending() {
      if (!pending) return;
      // reopen = item já gravado; só servia para anexar continuação de descrição
      if (!pending.reopen) {
        pushItem(
          itens,
          seen,
          pending.n,
          pending.desc,
          pending.unidade,
          pending.pu,
          pending.po
        );
      }
      pending = null;
    }

    function extractFromText(text, defaultN) {
      const t = clean(text);
      SCORE_TAIL.lastIndex = 0;
      let m;
      let found = 0;
      // global: vários itens na mesma string
      const re = new RegExp(
        "(\\d{1,2})?\\s*((?:Coordena|Participa|Exerc[ií]cio|Elabora|Atua|Apresenta|Recebimento|Produ|Autoria|Conclus|Desempenho|Publica|Avalia|Representa|Carta patente|Coopera)[\\s\\S]*?)\\s+(" +
          UNIT +
          ")\\s+(\\d{1,3}[.,]\\d)\\s+(\\d{1,3}[.,]\\d)",
        "gi"
      );
      while ((m = re.exec(t)) !== null) {
        found++;
        const n = m[1] ? Number(m[1]) : defaultN || found;
        pushItem(itens, seen, n, m[2], m[3], parseNumberBR(m[4]), parseNumberBR(m[5]));
      }
      return found;
    }

    for (let i = 0; i < usable.length; i++) {
      const ln = usable[i];

      // Caso A: linha com número + scores no fim (item completo ou início com scores)
      const full = ln.match(
        /^(\d{1,2})\s+(.+?)\s+(Por\s+.+?)\s+(\d{1,3}[.,]\d)\s+(\d{1,3}[.,]\d)\s*$/i
      );
      if (full && ITEM_START.test(full[2])) {
        flushPending();
        // pode haver vários itens colados: tenta extract global na linha
        const before = itens.length;
        extractFromText(ln, Number(full[1]));
        if (itens.length > before) {
          // último item pode receber continuações de descrição
          pending = {
            n: itens[itens.length - 1].n,
            desc: itens[itens.length - 1].descricao,
            unidade: itens[itens.length - 1].unidade,
            pu: itens[itens.length - 1].pontosUnitario,
            po: itens[itens.length - 1].pontosObtidos,
            // reabrir para append desc
            reopen: true,
            index: itens.length - 1,
          };
          continue;
        }
        pending = {
          n: Number(full[1]),
          desc: full[2],
          unidade: full[3],
          pu: parseNumberBR(full[4]),
          po: parseNumberBR(full[5]),
          reopen: false,
        };
        continue;
      }

      // Caso B: início de item sem scores (raro)
      const startOnly = ln.match(/^(\d{1,2})\s+(.+)$/);
      if (startOnly && ITEM_START.test(startOnly[2]) && !/Por\s+/i.test(ln)) {
        flushPending();
        pending = {
          n: Number(startOnly[1]),
          desc: startOnly[2],
          unidade: "",
          pu: null,
          po: null,
          reopen: false,
          waitingScores: true,
        };
        continue;
      }

      // Continuação: "acima de seis meses" ou resto da descrição
      if (pending) {
        if (/^acima de seis meses/i.test(ln)) {
          if (pending.unidade && !/seis meses/i.test(pending.unidade)) {
            pending.unidade = clean(pending.unidade + " " + ln);
          } else if (pending.reopen && pending.index != null) {
            // already scored; ignore unit fragment if already full
            if (!/seis meses/i.test(itens[pending.index].unidade)) {
              itens[pending.index].unidade = clean(
                itens[pending.index].unidade + " " + ln
              );
            }
          } else {
            pending.desc = clean(pending.desc + " " + ln);
          }
          continue;
        }
        if (!/^\d{1,2}\s+/.test(ln) && !/^RSC/i.test(ln)) {
          // append description continuation
          if (pending.reopen && pending.index != null) {
            itens[pending.index].descricao = clean(
              itens[pending.index].descricao + " " + ln
            );
            // re-infer group with full text
            itens[pending.index].grupo = inferGrupo(itens[pending.index].descricao);
          } else {
            pending.desc = clean(pending.desc + " " + ln);
            // maybe scores appear only after merge
            const scored = clean(pending.desc).match(
              /^(.+?)\s+(Por\s+.+?)\s+(\d{1,3}[.,]\d)\s+(\d{1,3}[.,]\d)\s*$/i
            );
            if (scored) {
              pending.desc = scored[1];
              pending.unidade = scored[2];
              pending.pu = parseNumberBR(scored[3]);
              pending.po = parseNumberBR(scored[4]);
              flushPending();
            }
          }
          continue;
        }
      }

      // Fallback: linha com vários itens colados sem ter batido no full
      if (ITEM_START.test(ln) && /Por\s+/.test(ln) && /\d[.,]\d/.test(ln)) {
        flushPending();
        extractFromText(ln, 1);
      }
    }
    flushPending();

    // Fallback global no texto inteiro (PDFs "achatados")
    if (itens.length < 3) {
      extractFromText(usable.join(" "), 1);
    }

    return itens;
  }

  function parseHeaderFromLines(lines) {
    const out = {
      nome: "",
      siape: "",
      cargo: "",
      dataIngresso: "",
      nivelClassificacao: "",
      lotacao: "",
      email: "",
    };

    // Preferir linhas com rótulos ("Nome:" ou "Nome :")
    for (const raw of lines) {
      const ln = normalizeLine(raw);
      let m;
      if ((m = ln.match(/^Nome:\s*(.+)$/i))) out.nome = clean(m[1]);
      else if ((m = ln.match(/^SIAPE:\s*(\d{5,8})/i))) out.siape = m[1];
      else if ((m = ln.match(/^Cargo:\s*(.+)$/i))) out.cargo = clean(m[1]);
      else if (
        (m = ln.match(
          /^Data de ingresso(?: em IFE)?:\s*(\d{2}\/\d{2}\/\d{4})/i
        ))
      )
        out.dataIngresso = m[1];
      else if ((m = ln.match(/^Lota[cç][aã]o:\s*(.+)$/i))) out.lotacao = clean(m[1]);
      else if ((m = ln.match(/^E-?mail:\s*(.+)$/i))) {
        out.email = clean(m[1]).replace(/\s+/g, "");
      } else if ((m = ln.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i))) {
        if (!out.email) out.email = m[1];
      }
      // Função/Encargo
      else if ((m = ln.match(/^Fun[cç][aã]o[^:]*:\s*(.+)$/i))) {
        // opcional — não bloqueia
        out.funcao = clean(m[1]);
      }
    }

    // Layout calculadora: valores em linhas isoladas após o título
    if (!out.nome || !out.siape) {
      const usable = lines.filter((l) => !isNoiseLine(l) && !/^RSC/i.test(l));
      // achar SIAPE isolado
      let siapeIdx = -1;
      for (let i = 0; i < usable.length; i++) {
        if (/^\d{6,8}$/.test(usable[i])) {
          siapeIdx = i;
          break;
        }
      }
      if (siapeIdx >= 1) {
        if (!out.siape) out.siape = usable[siapeIdx];
        // nome: linha anterior se parecer nome
        if (!out.nome && /^[A-ZÀ-Ÿa-zà-ÿ' .\-]{5,90}$/.test(usable[siapeIdx - 1])) {
          out.nome = clean(usable[siapeIdx - 1]);
        }
        // cargo
        if (!out.cargo && usable[siapeIdx + 1] && !/\d{2}\/\d{2}\/\d{4}/.test(usable[siapeIdx + 1])) {
          if (!/@/.test(usable[siapeIdx + 1]) && !/^A\s+B\s+C/.test(usable[siapeIdx + 1])) {
            out.cargo = clean(usable[siapeIdx + 1]);
          }
        }
        // data
        for (let j = siapeIdx; j < Math.min(siapeIdx + 5, usable.length); j++) {
          const dm = usable[j].match(/^(\d{2}\/\d{2}\/\d{4})$/);
          if (dm) {
            out.dataIngresso = dm[1];
            // lotação após A B C D E
            for (let k = j + 1; k < Math.min(j + 5, usable.length); k++) {
              if (/^A\s+B\s+C\s+D\s+E$/i.test(usable[k])) {
                if (usable[k + 1] && !/@/.test(usable[k + 1])) {
                  out.lotacao = clean(usable[k + 1]);
                }
                if (usable[k + 2] && /@/.test(usable[k + 2])) {
                  out.email = clean(usable[k + 2]);
                }
                break;
              }
              if (!out.lotacao && usable[k] && !/@/.test(usable[k]) && !/^RSC/i.test(usable[k])) {
                // skip
              }
            }
            break;
          }
        }
      }
      // email em qualquer linha
      if (!out.email) {
        for (const ln of usable) {
          const em = ln.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
          if (em) {
            out.email = em[0];
            break;
          }
        }
      }
    }

    // Nível de classificação E (padrão se A B C D E aparece)
    if (lines.some((l) => /^A\s+B\s+C\s+D\s+E$/i.test(clean(l)))) {
      out.nivelClassificacao = "E";
    }

    return out;
  }

  function parseTotais(lines, flat) {
    const text = clean(flat || lines.join(" "));
    const pontMin = parseNumberBR(
      (text.match(
        /Pontua[cç][aã]o m[ií]nima necess[aá]ria\s*:\s*([\d.,]+)/i
      ) ||
        text.match(/m[ií]nima necess[aá]ria\s*[:\s]+([\d.,]+)/i) ||
        [])[1]
    );
    const pontTotal = parseNumberBR(
      (text.match(
        /Pontua[cç][aã]o total apresentada\s*:\s*([\d.,]+)/i
      ) ||
        text.match(/totalizo\s+([\d.,]+)\s*pontos/i) ||
        text.match(/=\s*([\d.,]+)\s*pontos/i) ||
        [])[1]
    );
    const qtd = parseNumberBR(
      (text.match(
        /Quantidade de crit[eé]rios espec[ií]ficos utilizados\s*:\s*([\d.,]+)/i
      ) || [])[1]
    );
    const excedente = parseNumberBR(
      (text.match(/excedente[^0-9]{0,50}([\d.,]+)/i) || [])[1]
    );
    const saldoAnterior = parseNumberBR(
      (text.match(
        /Saldo de pontua[cç][aã]o de concess[aã]o anterior\s*:\s*([\d.,]+)/i
      ) || [])[1]
    );
    return { pontMin, pontTotal, qtd, excedente, saldoAnterior };
  }

  /**
   * Detecta nível pretendido (ordem de prioridade):
   * 1) "nível RSC-PCCTAE X" no fechamento
   * 2) marcação X junto ao RSC-PCCTAE N
   * 3) pontuação mínima 10/15/25/30/52/75
   * 4) se total e mín. batem com um nível (ex.: total 190 e min implícito)
   * 5) fallback: maior nível atendível
   */
  function inferNivel(lines, flat, itens, totais) {
    const text = flat || lines.join(" ");

    // fechamento
    let m = text.match(
      /n[ií]vel\s+RSC[\s\-–—]*PCCTAE\s*(I{1,3}|IV|V|VI)\b/i
    );
    if (m) return m[1].toUpperCase();
    m = text.match(
      /para o n[ií]vel\s+(I{1,3}|IV|V|VI)\b/i
    );
    if (m) return m[1].toUpperCase();

    // lista com X na mesma linha ou na linha anterior (layout impresso HTML)
    const niveis = ["VI", "V", "IV", "III", "II", "I"];
    for (const n of niveis) {
      const re = new RegExp(
        "(?:\\[\\s*[xX✓]\\s*\\]|\\b[xX]\\b)\\s*RSC[\\s\\-–—]*PCCTAE\\s*" +
          n +
          "\\b|RSC[\\s\\-–—]*PCCTAE\\s*" +
          n +
          "\\s*(?:\\[\\s*[xX✓]\\s*\\]|\\b[xX]\\b)",
        "i"
      );
      if (re.test(text)) return n;
    }
    // linhas: "X" isolado seguido de "RSC-PCCTAE VI"
    for (let i = 0; i < lines.length - 1; i++) {
      const a = normalizeLine(lines[i]);
      const b = normalizeLine(lines[i + 1]);
      if (/^x$/i.test(a) || /^\[\s*x\s*\]$/i.test(a)) {
        const nm = b.match(/^RSC-PCCTAE\s*(I{1,3}|IV|V|VI)\b/i);
        if (nm) return nm[1].toUpperCase();
      }
      const same = a.match(
        /^x\s+RSC-PCCTAE\s*(I{1,3}|IV|V|VI)\b/i
      );
      if (same) return same[1].toUpperCase();
    }
    // "Nível de RSC pretendido: ... X RSC-PCCTAE VI"
    m = text.match(
      /N[ií]vel de RSC pretendido[\s\S]{0,200}?\bX\s+RSC-PCCTAE\s*(I{1,3}|IV|V|VI)\b/i
    );
    if (m) return m[1].toUpperCase();

    // por pontuação mínima declarada
    const minMap = {
      10: "I",
      15: "II",
      25: "III",
      30: "IV",
      52: "V",
      75: "VI",
    };
    if (totais.pontMin != null && minMap[Math.round(totais.pontMin)]) {
      return minMap[Math.round(totais.pontMin)];
    }

    // Se o PDF não trouxe o "X" nem o mínimo, mas o total bate com
    // um nível e há "RSC-PCCTAE N" listado, preferir o nível cuja
    // mínima é a maior ainda ≤ total e que aparece no texto de fechamento
    // "atendo ... nível". Sem isso, usar maior nível atendível.
    const pts =
      totais.pontTotal != null
        ? totais.pontTotal
        : itens.reduce((s, i) => s + (Number(i.pontosObtidos) || 0), 0);
    const qtd = itens.length;
    const grupos = new Set(itens.map((i) => i.grupo).filter(Boolean));
    const order = ["VI", "V", "IV", "III", "II", "I"];
    const N = global.RSCRegras && global.RSCRegras.NIVEIS;

    // Heurística: se pontuação total e qtd atendem V e VI, mas o
    // usuário pediu V com frequência (mín. 52 não extraído), não
    // forçar VI só porque há item do grupo VI — o grupo VI também
    // serve à complexidade de V. Preferir o nível se "RSC-PCCTAE V"
    // aparecer isolado com contexto de pretendido.
    // Melhor heurística disponível sem checkbox: se extrairmos
    // "190,5" e "138,5" (excedente) → min = total - excedente = 52 → V
    if (totais.excedente != null && pts != null) {
      const impliedMin = Math.round((pts - totais.excedente) * 10) / 10;
      if (minMap[Math.round(impliedMin)]) return minMap[Math.round(impliedMin)];
    }

    if (N) {
      for (const id of order) {
        const nv = N[id];
        if (!nv) continue;
        if (pts + 1e-9 < nv.minPontos) continue;
        if (qtd < nv.minItens) continue;
        if (nv.complexidade && nv.complexidade.length) {
          if (!nv.complexidade.some((g) => grupos.has(g))) continue;
        }
        return id;
      }
    }
    return "";
  }

  function parseRequerimentoFromLines(lines, rawJoin) {
    const normLines = (lines || []).map(normalizeLine).filter(Boolean);
    const flat = clean(normLines.join(" ") + " " + normalizeLine(rawJoin || ""));
    const header = parseHeaderFromLines(normLines);
    const itens = parseItensFromLines(normLines);
    // totais: tenta linhas + rawJoin (números às vezes só no stream bruto)
    const totais = parseTotais(lines, flat);
    if (totais.pontMin == null && rawJoin) {
      const t2 = parseTotais([], clean(rawJoin));
      if (t2.pontMin != null) totais.pontMin = t2.pontMin;
      if (t2.pontTotal != null) totais.pontTotal = t2.pontTotal;
      if (t2.qtd != null) totais.qtd = t2.qtd;
      if (t2.excedente != null) totais.excedente = t2.excedente;
      if (t2.saldoAnterior != null) totais.saldoAnterior = t2.saldoAnterior;
    }

    const sumItens =
      Math.round(
        itens.reduce((s, i) => s + (Number(i.pontosObtidos) || 0), 0) * 10
      ) / 10;

    const pontTotal =
      totais.pontTotal != null ? totais.pontTotal : sumItens || null;
    // pontuação mínima extraída do PDF só auxilia a inferir o nível;
    // o valor final é sempre o canônico do Decreto / calculadora.
    const nivelRsc = inferNivel(lines, flat, itens, {
      ...totais,
      pontTotal,
    });
    const pontMin = canonicalMinPontos(nivelRsc);
    const excedente =
      pontTotal != null && pontMin != null
        ? Math.round((pontTotal - pontMin) * 10) / 10
        : totais.excedente;

    return {
      nome: header.nome,
      siape: header.siape,
      cargo: header.cargo,
      dataIngresso: header.dataIngresso,
      nivelClassificacao: header.nivelClassificacao || "E",
      lotacao: header.lotacao,
      email: header.email,
      nivelRsc,
      pontuacaoMinimaDeclarada: pontMin,
      pontuacaoMinimaExtraida: totais.pontMin,
      pontuacaoTotalDeclarada: pontTotal,
      qtdCriteriosDeclarada: totais.qtd != null ? totais.qtd : itens.length,
      excedenteDeclarado: excedente,
      saldoAnterior: totais.saldoAnterior != null ? totais.saldoAnterior : 0,
      itens,
      rawPreview: flat.slice(0, 1500),
    };
  }

  /** Tabela canônica (Decreto 13.048/2026 / calculadora): min pts por nível. */
  function canonicalMinPontos(nivelId) {
    const id = String(nivelId || "")
      .replace(/RSC-PCCTAE\s*/i, "")
      .trim()
      .toUpperCase();
    const N = global.RSCRegras && global.RSCRegras.NIVEIS;
    if (N && N[id] && N[id].minPontos != null) return N[id].minPontos;
    const FALLBACK = { I: 10, II: 15, III: 25, IV: 30, V: 52, VI: 75 };
    return FALLBACK[id] != null ? FALLBACK[id] : null;
  }

  function canonicalMinItens(nivelId) {
    const id = String(nivelId || "")
      .replace(/RSC-PCCTAE\s*/i, "")
      .trim()
      .toUpperCase();
    const N = global.RSCRegras && global.RSCRegras.NIVEIS;
    if (N && N[id] && N[id].minItens != null) return N[id].minItens;
    const FALLBACK = { I: 1, II: 2, III: 2, IV: 3, V: 5, VI: 7 };
    return FALLBACK[id] != null ? FALLBACK[id] : null;
  }

  /** Compat: texto flat antigo */
  function parseRequerimentoText(flatOrLines) {
    if (Array.isArray(flatOrLines)) return parseRequerimentoFromLines(flatOrLines);
    // re-split roughly
    const lines = String(flatOrLines || "")
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
    if (lines.length > 3) return parseRequerimentoFromLines(lines);
    // single long line: synthetic split by criterion starts
    const flat = clean(flatOrLines);
    const synthetic = [flat];
    return parseRequerimentoFromLines(synthetic);
  }

  async function toArrayBuffer(file) {
    if (!file) throw new Error("Arquivo PDF não informado");
    if (file instanceof ArrayBuffer) {
      if (!file.byteLength) throw new Error("PDF vazio (ArrayBuffer 0 bytes)");
      return file;
    }
    if (ArrayBuffer.isView(file)) {
      const v = file;
      return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    }
    if (typeof file.arrayBuffer === "function") {
      const ab = await file.arrayBuffer();
      if (!ab || !ab.byteLength) {
        // fallback: FileReader
        const ab2 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error || new Error("FileReader falhou"));
          fr.readAsArrayBuffer(file);
        });
        if (!ab2 || !ab2.byteLength) throw new Error("PDF vazio ou ilegível");
        return ab2;
      }
      return ab;
    }
    throw new Error("Tipo de arquivo PDF não suportado");
  }

  function scoreParse(d) {
    if (!d) return -1;
    let s = 0;
    if (d.nome && d.nome.length > 4 && !/\d{5,}/.test(d.nome)) s += 3;
    if (/^\d{6,8}$/.test(String(d.siape || ""))) s += 5;
    if (d.cargo && d.cargo.length > 2 && !/^Nome/i.test(d.cargo)) s += 2;
    if (d.lotacao && d.lotacao.length > 2) s += 2;
    if (d.email && /@/.test(d.email) && !/\s/.test(d.email)) s += 3;
    if (d.dataIngresso && /\d{2}\/\d{2}\/\d{4}/.test(d.dataIngresso)) s += 2;
    if (d.nivelRsc && /^(I{1,3}|IV|V|VI)$/i.test(d.nivelRsc)) s += 4;
    if (d.pontuacaoMinimaDeclarada != null) s += 3;
    if (d.pontuacaoTotalDeclarada != null) s += 2;
    const itens = d.itens || [];
    s += Math.min(itens.length, 20);
    const sum = itens.reduce((a, i) => a + (Number(i.pontosObtidos) || 0), 0);
    if (d.pontuacaoTotalDeclarada != null && itens.length) {
      const diff = Math.abs(sum - d.pontuacaoTotalDeclarada);
      if (diff < 0.2) s += 12;
      else if (diff < 2) s += 6;
      else if (diff < 10) s += 2;
      else s -= 4;
    } else if (sum > 0) s += 2;
    const gok = itens.filter((i) => i.grupo).length;
    s += Math.min(gok, 12);
    // unidades completas
    s += Math.min(
      itens.filter((i) => /Por\s+/i.test(i.unidade || "")).length,
      8
    );
    return s;
  }

  /**
   * Escolhe melhor valor entre texto nativo (a) e OCR (b).
   * Retorna { value, source, agree }.
   */
  function pickFieldDetail(a, b, kind) {
    const va = a == null || a === "" ? "" : String(a).trim();
    const vb = b == null || b === "" ? "" : String(b).trim();
    const empty = { value: "", source: "none", agree: true };

    if (!va && !vb) return empty;
    if (!va && vb) return { value: vb, source: "ocr", agree: false };
    if (va && !vb) return { value: va, source: "text", agree: false };

    const norm = (x) =>
      clean(x)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const same =
      norm(va) === norm(vb) ||
      (kind === "email" &&
        norm(va).replace(/\s/g, "") === norm(vb).replace(/\s/g, "")) ||
      (kind === "number" &&
        Math.abs((parseNumberBR(va) || 0) - (parseNumberBR(vb) || 0)) < 0.05);

    if (same) {
      // preferir texto nativo quando iguais (mais fiel a acentos)
      return { value: va || vb, source: "both", agree: true };
    }

    if (kind === "siape") {
      const okA = /^\d{6,8}$/.test(va);
      const okB = /^\d{6,8}$/.test(vb);
      if (okA && !okB) return { value: va, source: "text", agree: false };
      if (okB && !okA) return { value: vb, source: "ocr", agree: false };
      return { value: va, source: "text", agree: false };
    }
    if (kind === "email") {
      const score = (e) => {
        let s = 0;
        if (/@/.test(e)) s += 2;
        if (!/\s/.test(e)) s += 2;
        if (/@uffs\.edu\.br$/i.test(e)) s += 3;
        if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e)) s += 2;
        return s;
      };
      const sa = score(va);
      const sb = score(vb);
      if (sb > sa) return { value: vb, source: "ocr", agree: false };
      return { value: va, source: "text", agree: false };
    }
    if (kind === "nome") {
      // rejeitar se parece lixo OCR (muitos dígitos / muito curto)
      const quality = (n) => {
        let s = n.length;
        if (/\d{4,}/.test(n)) s -= 20;
        if (/^nome/i.test(n)) s -= 30;
        if ((n.match(/[A-Za-zÀ-ÿ]/g) || []).length < 5) s -= 15;
        // preferir nome com sobrenome
        s += (n.trim().split(/\s+/).length - 1) * 3;
        return s;
      };
      if (quality(vb) > quality(va) + 2)
        return { value: vb, source: "ocr", agree: false };
      return { value: va, source: "text", agree: false };
    }
    if (kind === "date") {
      const ok = (d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d);
      if (ok(va) && !ok(vb)) return { value: va, source: "text", agree: false };
      if (ok(vb) && !ok(va)) return { value: vb, source: "ocr", agree: false };
      return { value: va, source: "text", agree: false };
    }
    if (kind === "nivel") {
      const ok = (n) => /^(I{1,3}|IV|V|VI)$/i.test(n);
      if (ok(va) && !ok(vb)) return { value: va.toUpperCase(), source: "text", agree: false };
      if (ok(vb) && !ok(va)) return { value: vb.toUpperCase(), source: "ocr", agree: false };
      // ambos ok mas discordam — resolver depois com pontuação mínima
      return { value: va.toUpperCase(), source: "text", agree: false, conflict: true, alt: vb.toUpperCase() };
    }
    if (kind === "number") {
      const na = parseNumberBR(va);
      const nb = parseNumberBR(vb);
      if (na != null && nb == null)
        return { value: na, source: "text", agree: false };
      if (nb != null && na == null)
        return { value: nb, source: "ocr", agree: false };
      // ambos: preferir texto (números nativos costumam ser exatos)
      return { value: na, source: "text", agree: false, conflict: true, alt: nb };
    }
    if (kind === "lotacao" || kind === "cargo") {
      if (vb.length > va.length + 8 && !/\d{5,}/.test(vb))
        return { value: vb, source: "ocr", agree: false };
      return { value: va, source: "text", agree: false };
    }
    return { value: va, source: "text", agree: false };
  }

  function pickField(a, b, kind) {
    return pickFieldDetail(a, b, kind).value;
  }

  function itemKey(it) {
    const desc = clean(it.descricao || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 55);
    const po = Number(it.pontosObtidos);
    const pu = Number(it.pontosUnitario);
    return (
      (it.grupo || "?") +
      "|" +
      (Number.isFinite(po) ? po : "?") +
      "|" +
      (Number.isFinite(pu) ? pu : "?") +
      "|" +
      desc
    );
  }

  function listScore(list, declaredTotal) {
    if (!list || !list.length) return -1;
    let s = list.length * 2;
    const sum = list.reduce((x, i) => x + (Number(i.pontosObtidos) || 0), 0);
    if (declaredTotal != null) {
      const d = Math.abs(sum - declaredTotal);
      if (d < 0.2) s += 25;
      else if (d < 2) s += 12;
      else if (d < 15) s += 3;
      else s -= 8;
    }
    s += list.filter((i) => i.grupo).length;
    s += list.filter((i) => (i.descricao || "").length > 40).length;
    s += list.filter((i) => /Por\s+/i.test(i.unidade || "")).length;
    // penalizar descrições lixo
    s -= list.filter((i) => /declaro|fatos apresentados/i.test(i.descricao || "")).length * 5;
    return s;
  }

  function mergeItens(aList, bList, declaredTotal) {
    const a = aList || [];
    const b = bList || [];
    const sa = listScore(a, declaredTotal);
    const sb = listScore(b, declaredTotal);
    let best;
    let strategy;

    if (!a.length && b.length) {
      best = b;
      strategy = "ocr-only";
    } else if (a.length && !b.length) {
      best = a;
      strategy = "text-only";
    } else if (a.length >= 3 && b.length >= 3) {
      // união por chave semântica (grupo + pts + início descrição)
      const map = new Map();
      function add(it, src) {
        const key = itemKey(it);
        const prev = map.get(key);
        if (!prev) {
          map.set(key, { ...it, _src: src });
          return;
        }
        // manter descrição mais completa e unidade melhor
        const next = { ...prev };
        if ((it.descricao || "").length > (prev.descricao || "").length) {
          next.descricao = it.descricao;
          next.grupo = it.grupo || prev.grupo;
        }
        if (
          (it.unidade || "").length > (prev.unidade || "").length ||
          (/seis meses/i.test(it.unidade || "") &&
            !/seis meses/i.test(prev.unidade || ""))
        ) {
          next.unidade = it.unidade;
        }
        if (!next.grupo && it.grupo) next.grupo = it.grupo;
        next._src = "both";
        map.set(key, next);
      }
      a.forEach((it) => add(it, "text"));
      b.forEach((it) => add(it, "ocr"));
      const merged = [...map.values()].map(({ _src, ...rest }) => rest);
      const sm = listScore(merged, declaredTotal);
      // se merge inflou demais ou piorou score, usa melhor lista isolada
      if (
        merged.length > Math.max(a.length, b.length) + 2 ||
        sm < Math.max(sa, sb) - 5
      ) {
        best = sa >= sb ? a : b;
        strategy = sa >= sb ? "text-better" : "ocr-better";
      } else {
        best = merged;
        strategy = "union";
      }
    } else {
      best = sa >= sb ? a : b;
      strategy = sa >= sb ? "text-better" : "ocr-better";
    }

    return {
      itens: best.map((it) => {
        let qtd =
          it.qtdDeclarada != null
            ? it.qtdDeclarada
            : it.pontosUnitario
              ? Math.round(
                  (Number(it.pontosObtidos) / Number(it.pontosUnitario)) * 1000
                ) / 1000
              : null;
        if (qtd != null && Math.abs(qtd - Math.round(qtd)) < 1e-6)
          qtd = Math.round(qtd);
        return {
          ...it,
          grupo: it.grupo || inferGrupo(it.descricao || ""),
          qtdDeclarada: qtd,
          qtdAceita: it.qtdAceita != null ? it.qtdAceita : qtd,
        };
      }),
      strategy,
      scoreText: sa,
      scoreOcr: sb,
    };
  }

  const MIN_MAP = { 10: "I", 15: "II", 25: "III", 30: "IV", 52: "V", 75: "VI" };

  /**
   * Cruza parse por texto nativo + OCR com rastreio campo a campo.
   */
  function mergeParses(textData, ocrData, meta) {
    const t = textData || parseRequerimentoFromLines([]);
    const o = ocrData || parseRequerimentoFromLines([]);
    const st = scoreParse(t);
    const so = scoreParse(o);

    const fields = {};
    function take(key, kind, ta, oa) {
      const d = pickFieldDetail(ta, oa, kind);
      fields[key] = {
        value: d.value,
        text: ta == null || ta === "" ? null : ta,
        ocr: oa == null || oa === "" ? null : oa,
        source: d.source,
        agree: d.agree,
        conflict: !!d.conflict,
        alt: d.alt,
      };
      return d.value;
    }

    // totais numéricos com preferência pelo que fecha com soma de itens
    const sumT = (t.itens || []).reduce(
      (s, i) => s + (Number(i.pontosObtidos) || 0),
      0
    );
    const sumO = (o.itens || []).reduce(
      (s, i) => s + (Number(i.pontosObtidos) || 0),
      0
    );

    function pickNumber(key, tv, ov, preferNear) {
      const hasT = tv != null && Number.isFinite(Number(tv));
      const hasO = ov != null && Number.isFinite(Number(ov));
      if (!hasT && !hasO) {
        fields[key] = {
          value: null,
          text: null,
          ocr: null,
          source: "none",
          agree: true,
        };
        return null;
      }
      if (hasT && !hasO) {
        fields[key] = {
          value: tv,
          text: tv,
          ocr: null,
          source: "text",
          agree: false,
        };
        return tv;
      }
      if (!hasT && hasO) {
        fields[key] = {
          value: ov,
          text: null,
          ocr: ov,
          source: "ocr",
          agree: false,
        };
        return ov;
      }
      const agree = Math.abs(Number(tv) - Number(ov)) < 0.15;
      if (agree) {
        fields[key] = {
          value: tv,
          text: tv,
          ocr: ov,
          source: "both",
          agree: true,
        };
        return tv;
      }
      // discorda: preferir o mais próximo de preferNear (soma itens)
      let chosen = tv;
      let src = "text";
      if (preferNear != null) {
        const dt = Math.abs(Number(tv) - preferNear);
        const dO = Math.abs(Number(ov) - preferNear);
        if (dO + 0.05 < dt) {
          chosen = ov;
          src = "ocr";
        }
      }
      fields[key] = {
        value: chosen,
        text: tv,
        ocr: ov,
        source: src,
        agree: false,
        conflict: true,
      };
      return chosen;
    }

    // pré-total para orientar itens
    let declaredHint =
      t.pontuacaoTotalDeclarada != null
        ? t.pontuacaoTotalDeclarada
        : o.pontuacaoTotalDeclarada;
    if (
      t.pontuacaoTotalDeclarada != null &&
      o.pontuacaoTotalDeclarada != null
    ) {
      // se um fecha com a soma da própria lista, usar
      if (Math.abs(sumT - t.pontuacaoTotalDeclarada) < 0.3)
        declaredHint = t.pontuacaoTotalDeclarada;
      else if (Math.abs(sumO - o.pontuacaoTotalDeclarada) < 0.3)
        declaredHint = o.pontuacaoTotalDeclarada;
    }

    const itensMerge = mergeItens(t.itens, o.itens, declaredHint);
    const sumMerged =
      Math.round(
        itensMerge.itens.reduce(
          (s, i) => s + (Number(i.pontosObtidos) || 0),
          0
        ) * 10
      ) / 10;

    const merged = {
      nome: take("nome", "nome", t.nome, o.nome),
      siape: take("siape", "siape", t.siape, o.siape),
      cargo: take("cargo", "cargo", t.cargo, o.cargo),
      dataIngresso: take(
        "dataIngresso",
        "date",
        t.dataIngresso,
        o.dataIngresso
      ),
      nivelClassificacao:
        take(
          "nivelClassificacao",
          "nivel",
          t.nivelClassificacao,
          o.nivelClassificacao
        ) || "E",
      lotacao: take("lotacao", "lotacao", t.lotacao, o.lotacao),
      email: take("email", "email", t.email, o.email),
      nivelRsc: "",
      pontuacaoMinimaDeclarada: null,
      pontuacaoTotalDeclarada: pickNumber(
        "pontuacaoTotalDeclarada",
        t.pontuacaoTotalDeclarada,
        o.pontuacaoTotalDeclarada,
        sumMerged || Math.max(sumT, sumO)
      ),
      qtdCriteriosDeclarada: pickNumber(
        "qtdCriteriosDeclarada",
        t.qtdCriteriosDeclarada,
        o.qtdCriteriosDeclarada,
        itensMerge.itens.length
      ),
      excedenteDeclarado: null,
      saldoAnterior: pickNumber(
        "saldoAnterior",
        t.saldoAnterior,
        o.saldoAnterior,
        0
      ),
      itens: itensMerge.itens,
      rawPreview:
        (t.rawPreview || "").slice(0, 800) +
        "\n---OCR---\n" +
        (o.rawPreview || "").slice(0, 800),
    };

    if (merged.pontuacaoTotalDeclarada == null && sumMerged > 0) {
      merged.pontuacaoTotalDeclarada = sumMerged;
      fields.pontuacaoTotalDeclarada = {
        value: sumMerged,
        text: t.pontuacaoTotalDeclarada,
        ocr: o.pontuacaoTotalDeclarada,
        source: "itens-sum",
        agree: false,
      };
    }

    // Nível RSC: prioridade
    // 1) pontuação mínima *extraída do PDF* (pista, se houver)
    // 2) acordo texto+OCR do nível marcado
    // 3) texto / OCR
    // 4) total − excedente
    const nivelDetail = pickFieldDetail(t.nivelRsc, o.nivelRsc, "nivel");
    let nivel = nivelDetail.value || "";
    let nivelSrc = nivelDetail.source;
    const minExtraida =
      t.pontuacaoMinimaExtraida != null
        ? t.pontuacaoMinimaExtraida
        : o.pontuacaoMinimaExtraida != null
          ? o.pontuacaoMinimaExtraida
          : t.pontuacaoMinimaDeclarada != null &&
              // se o parse antigo já tinha min (antes do canônico), ainda serve de pista
              t.pontuacaoMinimaDeclarada
            ? t.pontuacaoMinimaDeclarada
            : o.pontuacaoMinimaDeclarada;
    if (minExtraida != null) {
      const byMin = MIN_MAP[Math.round(minExtraida)];
      if (byMin) {
        if (!nivel || nivel !== byMin) {
          // só sobrescreve se o PDF trouxe mínimo explícito e o nível divergiu
          if (
            t.pontuacaoMinimaExtraida != null ||
            o.pontuacaoMinimaExtraida != null
          ) {
            nivel = byMin;
            nivelSrc = "pont-min-extraida";
          }
        }
      }
    }
    if (!nivel) {
      nivel = t.nivelRsc || o.nivelRsc || "";
      nivelSrc = t.nivelRsc ? "text" : o.nivelRsc ? "ocr" : "none";
    }
    if (
      nivelDetail.conflict &&
      merged.pontuacaoTotalDeclarada != null &&
      (t.excedenteDeclarado != null || o.excedenteDeclarado != null)
    ) {
      const exc =
        t.excedenteDeclarado != null
          ? t.excedenteDeclarado
          : o.excedenteDeclarado;
      const implied = Math.round(merged.pontuacaoTotalDeclarada - exc);
      if (MIN_MAP[implied]) {
        nivel = MIN_MAP[implied];
        nivelSrc = "total-excedente";
      }
    }
    merged.nivelRsc = String(nivel || "").toUpperCase();
    fields.nivelRsc = {
      value: merged.nivelRsc,
      text: t.nivelRsc || null,
      ocr: o.nivelRsc || null,
      source: nivelSrc,
      agree:
        !!t.nivelRsc &&
        !!o.nivelRsc &&
        String(t.nivelRsc).toUpperCase() === String(o.nivelRsc).toUpperCase(),
      conflict: !!nivelDetail.conflict && !String(nivelSrc).includes("pont-min"),
    };

    // Pontuação mínima SEMPRE canônica pelo nível (não depende de texto/OCR)
    const pontMinCanon = canonicalMinPontos(merged.nivelRsc);
    merged.pontuacaoMinimaDeclarada = pontMinCanon;
    merged.minItensExigidos = canonicalMinItens(merged.nivelRsc);
    fields.pontuacaoMinimaDeclarada = {
      value: pontMinCanon,
      text: t.pontuacaoMinimaExtraida != null ? t.pontuacaoMinimaExtraida : null,
      ocr: o.pontuacaoMinimaExtraida != null ? o.pontuacaoMinimaExtraida : null,
      source: "catalogo",
      agree: true,
      conflict: false,
      canonical: true,
    };

    if (merged.qtdCriteriosDeclarada == null) {
      merged.qtdCriteriosDeclarada = merged.itens.length;
    }
    if (
      merged.pontuacaoTotalDeclarada != null &&
      merged.pontuacaoMinimaDeclarada != null
    ) {
      merged.excedenteDeclarado =
        Math.round(
          (merged.pontuacaoTotalDeclarada - merged.pontuacaoMinimaDeclarada) *
            10
        ) / 10;
    } else {
      merged.excedenteDeclarado =
        t.excedenteDeclarado != null
          ? t.excedenteDeclarado
          : o.excedenteDeclarado;
    }

    // contagem de acordo entre fontes
    const fieldKeys = Object.keys(fields);
    const agreeN = fieldKeys.filter((k) => fields[k].agree).length;
    const conflictN = fieldKeys.filter((k) => fields[k].conflict).length;
    const filledFromOcr = fieldKeys.filter(
      (k) => fields[k].source === "ocr"
    ).length;

    merged._fields = fields;
    merged._merge = {
      scoreText: st,
      scoreOcr: so,
      winner: st >= so ? "text+ocr-fill" : "ocr+text-fill",
      itensStrategy: itensMerge.strategy,
      itensScoreText: itensMerge.scoreText,
      itensScoreOcr: itensMerge.scoreOcr,
      ocrConfidence: meta && meta.ocrConfidence,
      textLines: meta && meta.textLines,
      ocrLines: meta && meta.ocrLines,
      fieldsAgree: agreeN,
      fieldsConflict: conflictN,
      fieldsFromOcr: filledFromOcr,
      fieldCount: fieldKeys.length,
    };
    return merged;
  }

  /**
   * Normaliza linhas vindas do OCR antes do mesmo parser de texto.
   */
  function prepareOcrLines(lines, rawText) {
    const normFn =
      global.RSCOCR && global.RSCOCR.normalizeOcrText
        ? global.RSCOCR.normalizeOcrText
        : (s) => s;
    const cleaned = (lines || [])
      .map((l) => normalizeLine(normFn(l)))
      .filter(Boolean);
    const raw = normFn(rawText || cleaned.join(" "));
    return { lines: cleaned, raw };
  }

  /**
   * @param {File|Blob|ArrayBuffer} file
   * @param {{onProgress?: function, useOcr?: boolean}} options
   */
  async function parseRequerimentoPdf(file, options) {
    const opts = options || {};
    const useOcr = opts.useOcr !== false; // default ON
    const onProgress = opts.onProgress || null;

    const ab = await toArrayBuffer(file);
    // cópias independentes: pdf.js pode transferir/detach o buffer
    const abText = ab.slice(0);
    const abOcr = ab.slice(0);

    if (onProgress) onProgress({ phase: "text", progress: 0.05 });

    const { lines, rawJoin, numPages } = await extractPdfLines(abText);
    const textData = parseRequerimentoFromLines(lines, rawJoin);
    if (onProgress)
      onProgress({ phase: "text-done", progress: 0.2, numPages });

    let ocrData = parseRequerimentoFromLines([]);
    let ocrMeta = { confidence: 0, lines: 0, error: null };
    if (useOcr && global.RSCOCR) {
      try {
        const ocr = await global.RSCOCR.ocrPdfArrayBuffer(abOcr, (p) => {
          if (!onProgress) return;
          if (p.phase === "ocr-init") {
            onProgress({
              phase: "ocr-init",
              status: p.status,
              progress: 0.2 + 0.05 * (p.progress || 0),
            });
            return;
          }
          const page = p.page || 1;
          const total = p.total || numPages || 1;
          const pageProg =
            p.progress != null ? p.progress : (page - 1) / total;
          onProgress({
            phase: "ocr",
            page,
            total,
            progress: 0.25 + 0.7 * pageProg,
          });
        });
        const prepared = prepareOcrLines(ocr.lines, ocr.text);
        ocrData = parseRequerimentoFromLines(prepared.lines, prepared.raw);
        ocrMeta = {
          confidence: ocr.confidence,
          lines: prepared.lines.length,
          error: null,
        };
      } catch (e) {
        console.warn("[RSC Parse] OCR falhou, usando só texto nativo:", e);
        ocrMeta.error = (e && e.message) || String(e);
        ocrData = parseRequerimentoFromLines([]);
      }
    }

    if (onProgress) onProgress({ phase: "merge", progress: 0.96 });

    const data = mergeParses(textData, ocrData, {
      ocrConfidence: ocrMeta.confidence,
      textLines: lines.length,
      ocrLines: ocrMeta.lines,
    });

    // Catálogo canônico (calculadora/decreto): grupo, descrição, unidade e pts/unid.
    // Do PDF só entram as quantidades declaradas.
    data._itensRaw = data.itens || [];
    if (global.RSCCriterios && global.RSCCriterios.expandItensToCatalog) {
      const exp = global.RSCCriterios.expandItensToCatalog(data._itensRaw);
      data.itens = exp.itens;
      data._catalogMatches = exp.matches;
      data._catalogUnmatched = exp.unmatched;
      const sumCat =
        Math.round(
          exp.itens.reduce((s, i) => s + (Number(i.pontosObtidos) || 0), 0) * 10
        ) / 10;
      data._catalogSum = sumCat;
      // se o total declarado no PDF não veio, usar soma do catálogo
      if (data.pontuacaoTotalDeclarada == null && sumCat > 0) {
        data.pontuacaoTotalDeclarada = sumCat;
      }
      // qtd de critérios com declaração > 0
      const qtdPos = exp.itens.filter((i) => (Number(i.qtdDeclarada) || 0) > 0)
        .length;
      if (data.qtdCriteriosDeclarada == null || data.qtdCriteriosDeclarada === 0) {
        data.qtdCriteriosDeclarada = qtdPos;
      }
      data._catalogMeta = {
        total: exp.itens.length,
        comPontuacao: qtdPos,
        unmatched: (exp.unmatched || []).length,
      };
    }

    data._sourceName = (file && file.name) || "requerimento.pdf";
    data._lineCount = lines.length;
    data._numPages = numPages;
    data._linesSample = lines.slice(0, 40);
    data._textOnly = textData;
    data._ocrOnly = ocrData;
    data._ocrError = ocrMeta.error;
    data._dualCapture = {
      textScore: scoreParse(textData),
      ocrScore: scoreParse(ocrData),
      ocrConfidence: ocrMeta.confidence,
      ocrLines: ocrMeta.lines,
      textLines: lines.length,
      ocrFailed: !!ocrMeta.error,
    };
    if (onProgress) onProgress({ phase: "done", progress: 1 });
    return data;
  }

  global.RSCParseRequerimento = {
    parseRequerimentoPdf,
    parseRequerimentoText,
    parseRequerimentoFromLines,
    mergeParses,
    scoreParse,
    pickFieldDetail,
    canonicalMinPontos,
    canonicalMinItens,
    extractPdfLines,
    extractPdfText: async (f) => {
      const { lines } = await extractPdfLines(f);
      return lines.join("\n");
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
