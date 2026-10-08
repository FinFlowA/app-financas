// Auditoria dos números do relatório num cenário com tudo o que costuma dar
// diferença: cartão com parcelas futuras, fatura vencida e fatura paga,
// transferências (entre contas, para conta arquivada e no formato antigo, em
// duas linhas), objetivos, atrasados de antes do período e dados do ano
// anterior. Os valores esperados foram calculados à mão a partir das regras
// das outras telas (Início, Fluxo de caixa, Contas e Cartões).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { totaisDoCartao } from "../cartoes-resumo";
import { lancamentosDoFluxo } from "../fluxo-atrasados";
import { montarRelatorio, SECOES_RELATORIO, tabelasDoRelatorio, type BlocoRelatorio, type DadosRelatorio, type OpcoesRelatorio, type TabelaRelatorio } from "../relatorio";
import { criarContexto, evolucaoMensal, porcentagensQueFecham, projecaoDoSaldo } from "../relatorio-analise";
import { abasDoExcel } from "../relatorio-arquivos";
import { calcularSaldoProjetadoPorMes } from "../saldo-projetado";
import { calcularSaldosPorConta, transacoesNoEscopo } from "../transacoes";
import { cenario } from "./fixtures/cenario-relatorio";

const todas = SECOES_RELATORIO.map((secao) => secao.id);
const ano: OpcoesRelatorio = { inicio: "2026-01-01", fim: "2026-12-31", contaIds: [], secoes: todas };
const tabela = (blocos: BlocoRelatorio[], titulo: string) => tabelasDoRelatorio(blocos).find((t) => t.titulo === titulo || t.titulo.startsWith(titulo)) as TabelaRelatorio;
const indicadores = (blocos: BlocoRelatorio[]) => {
  const bloco = blocos.find((b) => b.tipo === "indicadores" && b.secao === "resumo");
  return new Map(bloco && bloco.tipo === "indicadores" ? bloco.itens.map((i) => [i.rotulo, i.valor]) : []);
};
const coluna = (t: TabelaRelatorio, titulo: string) => t.colunas.findIndex((c) => c.titulo === titulo);
const soma = (valores: (number | string | null)[]) => Math.round(valores.reduce<number>((total, valor) => total + (typeof valor === "number" ? valor : 0), 0) * 100) / 100;

describe("auditoria: saldos", () => {
  const relatorio = montarRelatorio(cenario, ano);
  const resumo = indicadores(relatorio);

  it("saldo inicial, saldo atual e o saldo das contas são o mesmo dinheiro", () => {
    expect(resumo.get("Saldo inicial do período")).toBe(5000);
    const contasAtivas = cenario.contas.filter((conta) => !conta.arquivado);
    const real = [...calcularSaldosPorConta(contasAtivas, cenario.transacoes).values()].reduce((a, b) => a + b, 0);
    expect(resumo.get("Saldo atual")).toBe(real);
    expect(real).toBe(13550);
    expect(tabela(relatorio, "Saldo por conta").total?.at(-1)).toBe(13550);
  });

  it("evolução: cada mês fecha, o fim de um mês é o início do seguinte e o último é o saldo atual", () => {
    const linhas = evolucaoMensal(criarContexto(cenario, ano));
    expect(linhas).toHaveLength(10);
    linhas.forEach((linha, indice) => {
      expect(linha.saldoInicio + linha.resultado + linha.objetivosETransferencias + linha.ajusteCartao).toBeCloseTo(linha.saldoFim, 2);
      if (indice > 0) expect(linha.saldoInicio).toBe(linhas[indice - 1].saldoFim);
    });
    expect(linhas[8]).toMatchObject({ receitas: 5000, despesas: 150, resultado: 4850, ajusteCartao: 150, saldoFim: 10000 });
    expect(linhas[9]).toMatchObject({ receitas: 5000, despesas: 900, resultado: 4100, objetivosETransferencias: -550, ajusteCartao: 0, saldoFim: 13550 });
  });

  it("com contas escolhidas, a transferência antiga (duas linhas) não some do saldo", () => {
    const soCorrenteEInvestimentos = montarRelatorio(cenario, { ...ano, contaIds: [1, 4] });
    const real = [...calcularSaldosPorConta(cenario.contas.filter((c) => c.id === 1 || c.id === 4), cenario.transacoes).values()].reduce((a, b) => a + b, 0);
    expect(real).toBe(12450);
    expect(indicadores(soCorrenteEInvestimentos).get("Saldo atual")).toBe(real);
    const evolucao = tabela(soCorrenteEInvestimentos, "Evolução mensal");
    expect(evolucao.total?.at(-1)).toBe(real);
    expect(projecaoDoSaldo(criarContexto(cenario, { ...ano, contaIds: [1, 4] }))?.saldoAtual).toBe(real);
  });
});

describe("auditoria: resultado e cartão", () => {
  const relatorio = montarRelatorio(cenario, ano);
  const resumo = indicadores(relatorio);

  it("o resultado é só receitas menos despesas realizadas, sem meses futuros", () => {
    expect(resumo.get("Receitas realizadas")).toBe(10000);
    // Mercado 300 + compras das faturas de setembro (150) e outubro (600). As parcelas de novembro e dezembro ainda não aconteceram.
    expect(resumo.get("Despesas realizadas")).toBe(1050);
    expect(resumo.get("Resultado realizado")).toBe(8950);
  });

  it("a soma da evolução mês a mês é o total do resumo", () => {
    const evolucao = tabela(relatorio, "Evolução mensal");
    expect(evolucao.total?.[coluna(evolucao, "Receitas")]).toBe(resumo.get("Receitas realizadas"));
    expect(evolucao.total?.[coluna(evolucao, "Despesas")]).toBe(resumo.get("Despesas realizadas"));
    expect(evolucao.total?.[coluna(evolucao, "Resultado")]).toBe(resumo.get("Resultado realizado"));
  });

  it("cartões: os números da tela Cartões e o gasto só até a fatura do mês atual", () => {
    const { limiteUsado, emAbertoNoMes } = totaisDoCartao(7, cenario.itensFatura, "2026-10");
    // Tênis 2/3 e 3/3 (400), Farmácia (100) e o Livro da fatura de setembro, vencida e não paga (150).
    expect(limiteUsado).toBe(650);
    const linha = tabela(relatorio, "Cartões").linhas[0];
    expect(linha).toEqual(["Nubank", 5000, 650, 4350, 750, emAbertoNoMes("2026-10"), emAbertoNoMes("2026-11"), "2026-11-10", 2, 400]);
  });

  it("limite utilizado: conta o que sobrou de faturas antigas; fixo de mês futuro ainda não", () => {
    const fixo = (id: number, mes: string) => ({ ...cenario.itensFatura[0], id, descricao: "Academia (Fixa)", valor: 90, mes_fatura: mes });
    const itens = [...cenario.itensFatura, fixo(40, "2026-09"), fixo(41, "2026-10"), fixo(42, "2026-11")];
    expect(totaisDoCartao(7, itens, "2026-10").limiteUsado).toBe(650 + 90 + 90);
  });

  it("maiores despesas: só o que já aconteceu", () => {
    expect(tabela(relatorio, "Maiores despesas").linhas.map((l) => [l[2], l[5]])).toEqual([
      ["Restaurante", 400], ["Mercado", 300], ["Tênis (parcela 1/3)", 200], ["Livro", 150],
    ]);
  });
});

describe("auditoria: projeção e pendências", () => {
  const relatorio = montarRelatorio(cenario, ano);
  const resumo = indicadores(relatorio);

  it("saldo projetado igual ao do Fluxo de caixa; faturas em aberto à parte", () => {
    const contexto = criarContexto(cenario, ano);
    const fluxo = calcularSaldoProjetadoPorMes(1000, lancamentosDoFluxo(transacoesNoEscopo(cenario.transacoes, contexto.idsContas, contexto.contas.length), true, cenario.hoje), 2026, new Date(2026, 9, 15, 12));
    expect(fluxo[11].saldo).toBe(11950);
    expect(resumo.get("Saldo projetado para 31/12/2026")).toBe(11950);
    expect(resumo.get("Faturas do cartão em aberto")).toBe(650);
    expect(resumo.get("Saldo projetado com as faturas")).toBe(11300);
    const projecao = projecaoDoSaldo(contexto);
    expect(projecao?.linhas.map((l) => [l.saldoInicio, l.entradas, l.saidas, l.saldoFim, l.faturas, l.saldoComFaturas])).toEqual([
      [13550, 400, 1700, 12250, 150, 12100],
      [12250, 0, 300, 11950, 300, 11500],
      [11950, 0, 0, 11950, 200, 11300],
    ]);
  });

  it("a receber e a pagar: a vencer + atrasados = total, igual à lista de pendências", () => {
    expect(resumo.get("A receber")).toBe(400);
    expect(resumo.get("A pagar")).toBe(1700);
    const lista = tabela(relatorio, "Pendências");
    const porTipo = (tipo: string) => soma(lista.linhas.filter((l) => l[2] === tipo).map((l) => l[6]));
    expect(porTipo("Receita")).toBe(400);
    expect(porTipo("Despesa")).toBe(1700);
    // A tabela de valores pendentes cobre todos os tipos da lista (inclusive faturas, transferências e objetivos).
    const resumoDaLista = tabela(relatorio, "Valores pendentes").linhas;
    const totalDoResumo = soma(resumoDaLista.map((l) => l[l.length - 1]));
    expect(totalDoResumo).toBe(soma(lista.linhas.map((l) => l[6])));
  });

  it("categorias: soma = total do resumo, inclusive o pendente", () => {
    const despesas = tabela(relatorio, "Despesas por categoria");
    expect(despesas.total?.[coluna(despesas, "Realizado")]).toBe(resumo.get("Despesas realizadas"));
    expect(despesas.total?.[coluna(despesas, "Pendente")]).toBe(resumo.get("A pagar"));
    const receitas = tabela(relatorio, "Receitas por categoria");
    expect(receitas.total?.[coluna(receitas, "Realizado")] ?? receitas.linhas[0][coluna(receitas, "Realizado")]).toBe(resumo.get("Receitas realizadas"));
    expect(soma(receitas.linhas.map((l) => l[coluna(receitas, "Pendente")]))).toBe(resumo.get("A receber"));
  });
});

describe("auditoria: clareza do relatório", () => {
  it("o saldo projetado diz para quando é (período em andamento)", () => {
    const relatorio = montarRelatorio(cenario, ano);
    const rotulos = relatorio.flatMap((bloco) => (bloco.tipo === "indicadores" ? bloco.itens.map((item) => item.rotulo) : []));
    expect(rotulos.filter((rotulo) => rotulo.startsWith("Saldo projetado"))).toEqual([
      "Saldo projetado para 31/12/2026", "Saldo projetado com as faturas",
      "Saldo projetado para 31/12/2026", "Saldo projetado com as faturas",
    ]);
    expect(rotulos).not.toContain("Saldo projetado");
  });

  it("destaques: meses positivos, negativos e sem movimentação somam os meses completos", () => {
    const destaques = tabela(montarRelatorio(cenario, ano), "Destaques").linhas;
    const valor = (rotulo: string) => Number(destaques.find((linha) => linha[0] === rotulo)?.[1]);
    // De janeiro a setembro (outubro ainda está em andamento): só setembro teve receitas e despesas.
    expect([valor("Meses positivos"), valor("Meses negativos"), valor("Meses sem movimentação")]).toEqual([1, 0, 8]);
  });

  it("comparação sem nenhum dado no período anterior: aviso no lugar da tabela", () => {
    const anoPassado = montarRelatorio(cenario, { ...ano, inicio: "2025-01-01", fim: "2025-12-31" });
    expect(tabelasDoRelatorio(anoPassado).some((t) => t.secao === "comparacao")).toBe(false);
    expect(anoPassado.some((bloco) => bloco.tipo === "nota" && bloco.texto.includes("sem dados suficientes no período anterior (01/01/2024 a 31/12/2024)"))).toBe(true);
  });
});

describe("auditoria: comparação e filtros", () => {
  it("período em andamento: compara o mesmo trecho dos dois períodos", () => {
    const relatorio = montarRelatorio(cenario, ano);
    const comparacao = tabela(relatorio, "Comparação");
    expect(comparacao.linhas.map((l) => [l[0], l[1], l[2]])).toEqual([
      ["Receitas realizadas", 10000, 3000],
      ["Despesas realizadas", 1050, 0],
      ["Resultado", 8950, 3000],
      ["Saldo (hoje e na mesma data do período anterior)", 13550, 4000],
    ]);
  });

  it("filtro de categoria ou tipo vale também para a lista de transferências", () => {
    expect(tabela(montarRelatorio(cenario, { ...ano, categoriaIds: [2] }), "Transferências").linhas).toEqual([]);
    expect(tabela(montarRelatorio(cenario, { ...ano, tipo: "despesa" }), "Transferências").linhas).toEqual([]);
    expect(tabela(montarRelatorio(cenario, ano), "Transferências").linhas.length).toBeGreaterThan(0);
  });

  it("período no futuro: o saldo inicial é o previsto para o dia em que ele começa", () => {
    const novembro = indicadores(montarRelatorio(cenario, { ...ano, inicio: "2026-11-01", fim: "2026-11-30" }));
    expect(novembro.get("Saldo inicial do período")).toBe(12250);
  });
});

describe("auditoria: gráficos, Excel e filtros usam os mesmos números das tabelas", () => {
  const relatorio = montarRelatorio(cenario, ano);
  const graficos = relatorio.flatMap((bloco) => (bloco.tipo === "grafico" ? [bloco.grafico] : []));

  it("gráfico do saldo, de receitas x despesas e de categorias = tabelas", () => {
    const evolucao = tabela(relatorio, "Evolução mensal");
    const projecao = tabela(relatorio, "Projeção mês a mês");
    const saldo = graficos.find((g) => g.id === "saldo");
    const fimDoMes = coluna(evolucao, "Saldo no fim do mês");
    expect(saldo?.tipo === "linha" && saldo.valores).toEqual([
      evolucao.linhas[0][coluna(evolucao, "Saldo no início do mês")],
      ...evolucao.linhas.map((l) => l[fimDoMes]),
      // Meses futuros: o saldo projetado da tabela de projeção (novembro e dezembro).
      ...projecao.linhas.slice(1).map((l) => l[coluna(projecao, "Saldo projetado no fim do mês")]),
    ]);
    const barras = graficos.find((g) => g.id === "receitas-despesas");
    expect(barras?.tipo === "barras" && barras.series.map((serie) => serie.valores)).toEqual([
      evolucao.linhas.map((l) => l[coluna(evolucao, "Receitas")]),
      evolucao.linhas.map((l) => l[coluna(evolucao, "Despesas")]),
    ]);
    const categorias = graficos.find((g) => g.id === "categorias");
    const despesas = tabela(relatorio, "Despesas por categoria");
    // O gráfico mostra o realizado: as categorias só com valor pendente ficam só na tabela.
    expect(categorias?.tipo === "barras_horizontais" && categorias.valores).toEqual(despesas.linhas.map((l) => l[coluna(despesas, "Realizado")]).filter((valor) => typeof valor === "number" && valor > 0));
  });

  it("Excel: as células numéricas são os valores das tabelas", () => {
    const abas = abasDoExcel(relatorio, { periodo: "", contas: "", filtros: "", geradoEm: "" }, () => 250);
    const evolucao = abas.find((aba) => aba.sheet === "Evolução Mensal");
    const tabelaDaEvolucao = tabela(relatorio, "Evolução mensal");
    const valoresNaPlanilha = (evolucao?.data ?? []).map((linha) => linha.map((celula) => (celula && typeof celula.value === "number" ? celula.value : null)));
    for (const linha of tabelaDaEvolucao.linhas) {
      const numeros = linha.filter((valor): valor is number => typeof valor === "number");
      expect(valoresNaPlanilha.some((celulas) => numeros.every((valor, indice) => celulas.filter((c) => c !== null)[indice] === valor))).toBe(true);
    }
  });

  it("filtro de categoria: resumo, categorias e pendências continuam batendo entre si", () => {
    const moradia = montarRelatorio(cenario, { ...ano, categoriaIds: [3] });
    const resumo = indicadores(moradia);
    expect(resumo.get("A pagar")).toBe(1700);
    expect(resumo.get("Despesas realizadas")).toBe(0);
    expect(resumo.get("Saldo atual")).toBe(13550);
    const lista = tabela(moradia, "Pendências");
    expect(lista.linhas.map((l) => l[1])).toEqual(["IPTU", "Luz", "Aluguel"]);
    expect(soma(tabela(moradia, "Valores pendentes").linhas.map((l) => l[l.length - 1]))).toBe(soma(lista.linhas.map((l) => l[6])));
    expect(tabela(moradia, "Despesas por categoria").linhas).toEqual([["Moradia", 0, 0, null, 1700, 2000]]);
  });

  it("filtro de situação: só os a vencer em todo o relatório", () => {
    const aVencer = montarRelatorio(cenario, { ...ano, situacoes: ["a_vencer"] });
    expect(indicadores(aVencer).get("A pagar")).toBe(1500);
    expect(indicadores(aVencer).get("Despesas realizadas")).toBe(0);
    expect(tabela(aVencer, "Pendências").linhas.every((l) => l[5] === "A vencer")).toBe(true);
  });

  it("filtro de conta: saldos, evolução e pendências só da conta escolhida", () => {
    const poupanca = montarRelatorio(cenario, { ...ano, contaIds: [2] });
    const resumo = indicadores(poupanca);
    expect(resumo.get("Saldo atual")).toBe(1100);
    expect(tabela(poupanca, "Evolução mensal").total?.at(-1)).toBe(1100);
    // A transferência agendada para a Poupança aparece nas pendências, como transferência.
    expect(tabela(poupanca, "Pendências").linhas.map((l) => [l[1], l[2]])).toEqual([["Reserva de novembro", "Transferência"]]);
    expect(tabela(poupanca, "Valores pendentes").linhas.at(-1)?.[0]).toBe("Transferências e objetivos");
    expect(tabela(poupanca, "Cartões")).toBeUndefined();
  });
});

describe("auditoria: pontos de atenção corrigidos", () => {
  const notas = (blocos: BlocoRelatorio[]) => blocos.flatMap((bloco) => (bloco.tipo === "nota" ? [bloco.texto] : []));
  const comNota = (blocos: BlocoRelatorio[], trecho: string) => notas(blocos).some((texto) => texto.includes(trecho));

  it("lançamento sem data de vencimento (o banco aceita) não quebra o relatório nem o Excel", () => {
    const semData: DadosRelatorio = { ...cenario, transacoes: [...cenario.transacoes, { ...cenario.transacoes[5], id: 99, descricao: "Sem data", data_vencimento: null as unknown as string }] };
    const relatorio = montarRelatorio(semData, ano);
    // Sem data não dá para saber se está atrasado: fica fora do total e da lista, os dois iguais.
    expect(indicadores(relatorio).get("A pagar")).toBe(1700);
    expect(tabela(relatorio, "Pendências").linhas.some((linha) => linha[1] === "Sem data")).toBe(false);
    expect(() => abasDoExcel(relatorio, { periodo: "", contas: "", filtros: "", geradoEm: "" }, () => 250)).not.toThrow();
  });

  it("porcentagens das categorias somam 100% e o gráfico usa as mesmas da tabela", () => {
    expect(porcentagensQueFecham([100, 100, 100])).toEqual([0.334, 0.333, 0.333]);
    expect(porcentagensQueFecham([0, 0])).toEqual([null, null]);
    const relatorio = montarRelatorio(cenario, ano);
    const despesas = tabela(relatorio, "Despesas por categoria");
    // Alimentação 700, Compras 200 e Educação 150 de 1.050; Moradia só tem pendente.
    expect(despesas.linhas.map((linha) => linha[coluna(despesas, "% das despesas")])).toEqual([0.667, 0.19, 0.143, 0]);
    const grafico = relatorio.flatMap((bloco) => (bloco.tipo === "grafico" ? [bloco.grafico] : [])).find((g) => g.id === "categorias");
    expect(grafico?.tipo === "barras_horizontais" && grafico.percentuais).toEqual([0.667, 0.19, 0.143]);
  });

  it("projeção: a primeira linha diz que parte de hoje", () => {
    expect(tabela(montarRelatorio(cenario, ano), "Projeção mês a mês").linhas.map((linha) => linha[0])).toEqual([
      "Outubro 2026 (a partir de hoje, 15/10)", "Novembro 2026", "Dezembro 2026",
    ]);
    const ateDia20 = montarRelatorio(cenario, { ...ano, inicio: "2026-10-01", fim: "2026-10-20" });
    expect(tabela(ateDia20, "Projeção mês a mês").linhas.map((linha) => linha[0])).toEqual(["Outubro 2026 (de hoje, 15/10, a 20/10)"]);
  });

  it("sem lançamentos concluídos antes do período: avisa que o saldo inicial é o de cadastro", () => {
    const aviso = "Não há lançamentos concluídos antes deste período";
    expect(comNota(montarRelatorio(cenario, ano), aviso)).toBe(false);
    expect(comNota(montarRelatorio(cenario, { ...ano, inicio: "2025-01-01", fim: "2025-12-31" }), aviso)).toBe(true);
  });

  it("transferências e objetivos pendentes: explica o que muda (ou não) a projeção", () => {
    expect(comNota(montarRelatorio(cenario, ano), "as transferências entre as contas do relatório estão nas pendências, mas não mudam o saldo total nem a projeção")).toBe(true);
    // Até outubro não há transferência nem objetivo pendente (os dois são de novembro).
    expect(comNota(montarRelatorio(cenario, { ...ano, fim: "2026-10-31" }), "Transferências e objetivos:")).toBe(false);
  });

  it("categorias: meta e limite são por mês; avisa quando o relatório soma vários meses", () => {
    expect(comNota(montarRelatorio(cenario, ano), "Meta e limite são valores por mês; este relatório soma 10 meses")).toBe(true);
    expect(comNota(montarRelatorio(cenario, { ...ano, inicio: "2026-10-01", fim: "2026-10-31" }), "Meta e limite")).toBe(false);
  });

  it("mês com receitas e despesas que se anulam: conta à parte, e as contagens somam os meses completos", () => {
    const empate: DadosRelatorio = { ...cenario, transacoes: [
      ...cenario.transacoes,
      { ...cenario.transacoes[2], id: 90, descricao: "Venda", valor: 100, data_vencimento: "2026-03-05", data_realizacao: "2026-03-05" },
      { ...cenario.transacoes[4], id: 91, descricao: "Conserto", valor: 100, data_vencimento: "2026-03-06", data_realizacao: "2026-03-06" },
    ] };
    const destaques = tabela(montarRelatorio(empate, ano), "Destaques").linhas;
    const valor = (rotulo: string) => Number(destaques.find((linha) => linha[0] === rotulo)?.[1]);
    expect([valor("Meses positivos"), valor("Meses negativos"), valor("Meses sem movimentação"), valor("Meses com resultado zero")]).toEqual([1, 0, 7, 1]);
    expect(tabela(montarRelatorio(cenario, ano), "Destaques").linhas.some((linha) => linha[0] === "Meses com resultado zero")).toBe(false);
  });

  it("contas: cada conta fecha com a coluna de transferências, objetivos e faturas somada lançamento a lançamento", () => {
    const contas = tabela(montarRelatorio(cenario, ano), "Saldo por conta");
    const valor = (linha: TabelaRelatorio["linhas"][number], titulo: string) => Number(linha[coluna(contas, titulo)]);
    for (const linha of contas.linhas) {
      const fechamento = valor(linha, "Saldo no início do período") + valor(linha, "Receitas") - valor(linha, "Despesas") + valor(linha, "Transferências, objetivos e faturas");
      expect(Math.round(fechamento * 100) / 100).toBe(valor(linha, "Saldo hoje"));
    }
    // Corrente: Reserva, objetivo, fatura, conta antiga e a transferência antiga.
    expect(valor(contas.linhas[0], "Transferências, objetivos e faturas")).toBe(-2250);
  });

  it("juros de fatura levada para a próxima: aparecem nos Cartões e não viram despesa", () => {
    const pagamento = (id: number, descricao: string, valor: number, data: string) => ({ ...cenario.transacoes[13], id, descricao, valor, data_vencimento: data, data_realizacao: data });
    const comJuros: DadosRelatorio = {
      ...cenario,
      transacoes: [
        ...cenario.transacoes,
        // Fatura de agosto: pagou a compra Extra (200) por inteiro; depois veio o Curso (1.000), pagou 600 e levou o resto.
        pagamento(60, "Fatura Nubank - 2026-08 [PagFatura:7:2026-08:total]", 200, "2026-08-01"),
        pagamento(61, "Fatura Nubank - 2026-08 [PagFatura:7:2026-08:saldo_transferido:51]", 600, "2026-08-10"),
      ],
      itensFatura: [
        ...cenario.itensFatura,
        { ...cenario.itensFatura[0], id: 49, descricao: "Extra", valor: 200, data_compra: "2026-07-15", mes_fatura: "2026-08", pago: true },
        { ...cenario.itensFatura[0], id: 50, descricao: "Curso", valor: 1000, data_compra: "2026-07-20", mes_fatura: "2026-08", pago: true },
        // O que faltou pagar (400) mais 40 de juros, na fatura de setembro.
        { ...cenario.itensFatura[0], id: 51, descricao: "Saldo da fatura anterior (2026-08)", valor: 440, data_compra: "2026-08-10", mes_fatura: "2026-09", categoria_id: null, pago: true },
      ],
    };
    const relatorio = montarRelatorio(comJuros, ano);
    expect(notas(relatorio).find((texto) => texto.startsWith("Juros de fatura"))).toMatch(/Nubank R\$\s40,00/);
    expect(indicadores(relatorio).get("Despesas realizadas")).toBe(1050 + 200 + 1000);
    expect(comNota(montarRelatorio(cenario, ano), "Juros de fatura")).toBe(false);
  });

  it("pagamento de fatura lançado como despesa comum: o relatório avisa", () => {
    const manual: DadosRelatorio = { ...cenario, transacoes: [...cenario.transacoes, { ...cenario.transacoes[4], id: 70, categoria_id: null, valor: 600, descricao: "Pagamento fatura Nubank", data_vencimento: "2026-10-10", data_realizacao: "2026-10-10" }] };
    const aviso = notas(montarRelatorio(manual, ano)).find((texto) => texto.startsWith("Atenção:"));
    expect(aviso).toContain("\"Pagamento fatura Nubank\"");
    expect(aviso).toContain("mesmo valor da fatura Nubank 10/2026");
    // O pagamento feito por "Pagar fatura" (lançamento 14) não gera aviso.
    expect(comNota(montarRelatorio(cenario, ano), "Atenção:")).toBe(false);
  });

  it("Fluxo de caixa (site e app): entradas e saídas de dinheiro, não receitas e despesas", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/page.tsx"), "utf8");
    expect(pagina).toMatch(/"Entradas de dinheiro no mês"/);
    expect(pagina).toMatch(/"Saídas de dinheiro no mês"/);
    expect(pagina).not.toMatch(/realizadas no mês/);
    const app = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    expect(app).toMatch(/Entradas e saídas de dinheiro — \{anoSelecionado\}/);
  });
});
