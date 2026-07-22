/**
 * Regras RSC-PCCTAE (Decreto nº 13.048/2026).
 * Hipóteses de indeferimento = texto literal do art. 14.
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

  /**
   * Art. 14 do Decreto nº 13.048/2026 — critérios objetivos de indeferimento (texto literal).
   * Prefixo comum do caput + cada inciso.
   */
  const CAPUT_ART14 =
    "O RSC-PCCTAE poderá ser indeferido, ainda que atendidos os requisitos estabelecidos no art. 3º, com base na verificação do atendimento dos seguintes critérios objetivos:";

  const HIPOTESES_ART14 = [
    {
      id: "I",
      inciso: "I",
      texto:
        "I - obtenção da pontuação e atendimento da quantidade de critérios específicos e dos requisitos previstos no art. 5º, caput e § 1º;",
    },
    {
      id: "II",
      inciso: "II",
      texto:
        "II - utilização única de cada atividade ou experiência relativa ao critério específico apresentado, conforme o disposto no art. 5º, § 3º;",
    },
    {
      id: "III",
      inciso: "III",
      texto: "III - comprovação documental, conforme o disposto no art. 4º;",
    },
    {
      id: "IV",
      inciso: "IV",
      texto:
        "IV - cumprimento do interstício de três anos, contado da data da última concessão, conforme o disposto no art. 11;",
    },
    {
      id: "V",
      inciso: "V",
      texto:
        "V - cumprimento do estágio probatório, conforme o disposto no art. 12;",
    },
    {
      id: "VI",
      inciso: "VI",
      texto:
        "VI - realização de atividades e experiências exclusivamente no exercício do cargo ocupado, conforme o disposto no art. 12, parágrafo único;",
    },
    {
      id: "VII",
      inciso: "VII",
      texto:
        "VII - instrução do requerimento, conforme a documentação prevista no art. 13;",
    },
    {
      id: "VIII",
      inciso: "VIII",
      texto:
        "VIII - apresentação do memorial, conforme o disposto no art. 13, caput, inciso II;",
    },
    {
      id: "IX",
      inciso: "IX",
      texto:
        "IX - demonstração de desenvolvimento de saberes, competências, inovação, ampliação de responsabilidades ou obtenção de resultados institucionais relevantes, conforme o disposto no art. 15; e",
    },
    {
      id: "X",
      inciso: "X",
      texto:
        "X - observância do percentual máximo de concessão e da disponibilidade orçamentária estabelecidos no art. 12-C, § 1º, da Lei nº 11.091, de 12 de janeiro de 2005.",
    },
  ];

  function grupoDoCriterio(textoOuId) {
    const s = String(textoOuId || "");
    const m1 = s.match(/Crit[eé]rio\s+(I{1,3}|IV|V|VI)\b/i);
    if (m1) return m1[1].toUpperCase();
    const m2 = s.match(/\b(I{1,3}|IV|V|VI)\.\d/);
    if (m2) return m2[1].toUpperCase();
    return null;
  }

  /**
   * @param {object} req
   * @param {Array} itens [{grupo, pontosAceitos, qtdAceita, aceito}]
   *   pontosAceitos = quantidade aceita × pontos por unidade
   *   critério conta se qtdAceita > 0
   */
  function avaliar(req, itens) {
    const nivelId = (req.nivelRsc || "").replace(/RSC-PCCTAE\s*/i, "").trim().toUpperCase();
    const nivel = NIVEIS[nivelId] || null;

    const comPontos = (itens || []).filter((i) => (Number(i.pontosAceitos) || 0) > 0);
    const pontos = comPontos.reduce((s, i) => s + (Number(i.pontosAceitos) || 0), 0);
    const qtd = comPontos.length;
    const grupos = new Set(
      comPontos.map((i) => i.grupo || grupoDoCriterio(i.descricao)).filter(Boolean)
    );

    /** Sugestões automáticas de incisos do art. 14 (ids) */
    const sugestoes = [];
    let complexidadeOk = true;
    if (nivel && nivel.complexidade && nivel.complexidade.length) {
      complexidadeOk = nivel.complexidade.some((g) => grupos.has(g));
      if (!complexidadeOk) sugestoes.push("I"); // art. 5º requisitos
    }
    if (nivel) {
      if (pontos + 1e-9 < nivel.minPontos) sugestoes.push("I");
      if (qtd < nivel.minItens) sugestoes.push("I");
    }
    // se algum item com 0 pontos por recusa documental
    if ((itens || []).some((i) => i.aceito === "no" || (Number(i.qtdAceita) || 0) === 0 && (Number(i.qtdDeclarada) || 0) > 0)) {
      sugestoes.push("III");
    }

    const uniqueSug = [...new Set(sugestoes)];
    const favoravel =
      nivel &&
      pontos + 1e-9 >= nivel.minPontos &&
      qtd >= nivel.minItens &&
      complexidadeOk;

    const saldo = nivel ? Math.max(0, pontos - nivel.minPontos) : 0;

    return {
      nivelId,
      nivel,
      pontosObtidos: Math.round(pontos * 10) / 10,
      qtdCriterios: qtd,
      grupos: [...grupos],
      complexidadeOk,
      favoravel,
      sugestoesArt14: uniqueSug,
      saldoPontuacao: Math.round(saldo * 10) / 10,
      minPontos: nivel ? nivel.minPontos : null,
      minItens: nivel ? nivel.minItens : null,
      percentual: nivel ? nivel.percentual : null,
    };
  }

  function textoJustificativa(incisosIds) {
    const ids = incisosIds || [];
    if (!ids.length) return "";
    const partes = HIPOTESES_ART14.filter((h) => ids.includes(h.id)).map((h) => h.texto);
    return CAPUT_ART14 + " " + partes.join(" ");
  }

  global.RSCRegras = {
    NIVEIS,
    CAPUT_ART14,
    HIPOTESES_ART14,
    avaliar,
    grupoDoCriterio,
    textoJustificativa,
  };
})(typeof window !== "undefined" ? window : globalThis);
