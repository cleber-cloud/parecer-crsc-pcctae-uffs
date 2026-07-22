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
    const nivelRsc = inferNivel(lines, flat, itens, {
      ...totais,
      pontTotal,
    });
    const nivelObj = global.RSCRegras && global.RSCRegras.NIVEIS[nivelRsc];
    const pontMin =
      totais.pontMin != null
        ? totais.pontMin
        : nivelObj
          ? nivelObj.minPontos
          : null;
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
      pontuacaoTotalDeclarada: pontTotal,
      qtdCriteriosDeclarada: totais.qtd != null ? totais.qtd : itens.length,
      excedenteDeclarado: excedente,
      saldoAnterior: totais.saldoAnterior != null ? totais.saldoAnterior : 0,
      itens,
      rawPreview: flat.slice(0, 1500),
    };
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

  async function parseRequerimentoPdf(file) {
    const ab = await toArrayBuffer(file);
    const { lines, rawJoin, numPages } = await extractPdfLines(ab);
    const data = parseRequerimentoFromLines(lines, rawJoin);
    data._sourceName = (file && file.name) || "requerimento.pdf";
    data._lineCount = lines.length;
    data._numPages = numPages;
    data._linesSample = lines.slice(0, 40);
    return data;
  }

  global.RSCParseRequerimento = {
    parseRequerimentoPdf,
    parseRequerimentoText,
    extractPdfText: async (f) => {
      const { lines } = await extractPdfLines(f);
      return lines.join("\n");
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
