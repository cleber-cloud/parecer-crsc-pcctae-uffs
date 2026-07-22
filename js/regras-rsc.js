/**
 * Regras RSC-PCCTAE (Decreto 13.048/2026 + tabela usada na calculadora UFFS).
 */
(function (global) {
  "use strict";

  const NIVEIS = {
    I: {
      id: "I",
      nome: "RSC-PCCTAE I",
      percentual: 10,
      minPontos: 10,
      minItens: 1,
      complexidade: null,
      complexidadeDesc: "—",
    },
    II: {
      id: "II",
      nome: "RSC-PCCTAE II",
      percentual: 15,
      minPontos: 15,
      minItens: 2,
      complexidade: null,
      complexidadeDesc: "—",
    },
    III: {
      id: "III",
      nome: "RSC-PCCTAE III",
      percentual: 25,
      minPontos: 25,
      minItens: 2,
      complexidade: null,
      complexidadeDesc: "—",
    },
    IV: {
      id: "IV",
      nome: "RSC-PCCTAE IV",
      percentual: 30,
      minPontos: 30,
      minItens: 3,
      complexidade: ["II", "IV", "V", "VI"],
      complexidadeDesc: "Mínimo 1 item dos grupos II, IV, V ou VI",
    },
    V: {
      id: "V",
      nome: "RSC-PCCTAE V",
      percentual: 52,
      minPontos: 52,
      minItens: 5,
      complexidade: ["IV", "V", "VI"],
      complexidadeDesc: "Mínimo 1 item dos grupos IV, V ou VI",
    },
    VI: {
      id: "VI",
      nome: "RSC-PCCTAE VI",
      percentual: 75,
      minPontos: 75,
      minItens: 7,
      complexidade: ["VI"],
      complexidadeDesc: "Mínimo 1 item do grupo VI",
    },
  };

  /** Hipóteses objetivas de indeferimento (catálogo) */
  const HIPOTESES = {
    PONTUACAO: {
      codigo: "PONTUACAO_INSUFICIENTE",
      texto:
        "Pontuação obtida inferior à pontuação mínima exigida para o nível de RSC-PCCTAE requerido, nos termos do Decreto nº 13.048/2026.",
    },
    ITENS: {
      codigo: "CRITERIOS_INSUFICIENTES",
      texto:
        "Quantidade de critérios específicos comprovados inferior ao mínimo exigido para o nível de RSC-PCCTAE requerido, nos termos do Decreto nº 13.048/2026.",
    },
    COMPLEXIDADE: {
      codigo: "COMPLEXIDADE_AUSENTE",
      texto:
        "Não comprovado o requisito de complexidade do nível pretendido (item pertencente ao(s) grupo(s) exigido(s) pelo Decreto nº 13.048/2026).",
    },
    DOCUMENTACAO: {
      codigo: "DOCUMENTACAO_INSUFICIENTE",
      texto:
        "Documentação comprobatória insuficiente ou inadequada para demonstrar os saberes e competências declarados (art. 13, III, do Decreto nº 13.048/2026).",
    },
    INSTRUCAO: {
      codigo: "INSTRUCAO_INCOMPLETA",
      texto:
        "Processo com instrução incompleta (requerimento, memorial ou comprovantes), devendo ser sanado mediante diligência antes do julgamento de mérito, nos termos do Regimento da CRSC-PCCTAE/UFFS.",
    },
  };

  function grupoDoCriterio(textoOuId) {
    const s = String(textoOuId || "");
    // "Critério I - ..." or "I.3" or starts with roman in description context
    const m1 = s.match(/Crit[eé]rio\s+(I{1,3}|IV|V|VI)\b/i);
    if (m1) return m1[1].toUpperCase();
    const m2 = s.match(/\b(I{1,3}|IV|V|VI)\.\d/);
    if (m2) return m2[1].toUpperCase();
    return null;
  }

  /**
   * Avalia com base nos itens aceitos pela comissão.
   * @param {object} req dados extraídos do requerimento
   * @param {Array} itensAceitos [{descricao, pontosObtidos, grupo, aceito:boolean}]
   */
  function avaliar(req, itensAceitos) {
    const nivelId = (req.nivelRsc || "").replace(/RSC-PCCTAE\s*/i, "").trim().toUpperCase();
    const nivel = NIVEIS[nivelId] || null;
    const aceitos = (itensAceitos || []).filter((i) => i.aceito !== false && i.aceito !== "no");
    const pontos = aceitos.reduce((s, i) => s + (Number(i.pontosObtidos) || 0), 0);
    const qtd = aceitos.length;
    const grupos = new Set(
      aceitos.map((i) => i.grupo || grupoDoCriterio(i.requisito || i.descricao)).filter(Boolean)
    );

    const hipoteses = [];
    let complexidadeOk = true;
    if (nivel && nivel.complexidade && nivel.complexidade.length) {
      complexidadeOk = nivel.complexidade.some((g) => grupos.has(g));
      if (!complexidadeOk) hipoteses.push(HIPOTESES.COMPLEXIDADE);
    }
    if (nivel) {
      if (pontos + 1e-9 < nivel.minPontos) hipoteses.push(HIPOTESES.PONTUACAO);
      if (qtd < nivel.minItens) hipoteses.push(HIPOTESES.ITENS);
    }

    // se algum item marcado como recusado por documentação e não há outra hipótese
    const docFail = (itensAceitos || []).some((i) => i.aceito === "no");
    if (docFail && hipoteses.length === 0) {
      // pode ainda passar matematicamente; não força indeferimento automático
    }
    if (docFail && (pontos + 1e-9 < (nivel?.minPontos || 0) || qtd < (nivel?.minItens || 0))) {
      if (!hipoteses.find((h) => h.codigo === HIPOTESES.DOCUMENTACAO.codigo)) {
        hipoteses.push(HIPOTESES.DOCUMENTACAO);
      }
    }

    const favoravel = nivel && hipoteses.length === 0;
    const saldo = nivel ? Math.max(0, pontos - nivel.minPontos) : 0;

    return {
      nivelId,
      nivel,
      pontosObtidos: Math.round(pontos * 10) / 10,
      qtdCriterios: qtd,
      grupos: [...grupos],
      complexidadeOk,
      favoravel,
      hipoteses,
      saldoPontuacao: Math.round(saldo * 10) / 10,
      minPontos: nivel ? nivel.minPontos : null,
      minItens: nivel ? nivel.minItens : null,
      percentual: nivel ? nivel.percentual : null,
    };
  }

  global.RSCRegras = { NIVEIS, HIPOTESES, avaliar, grupoDoCriterio };
})(typeof window !== "undefined" ? window : globalThis);
