import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { totaisDoCartao } from "../cartoes-resumo";
import { lancamentosDoFluxo } from "../fluxo-atrasados";
import { invoicePurchasesInMonth } from "../invoices";
import { planHasFeature } from "../plan-entitlements";
import {
  linhasPorSecao,
  montarRelatorio,
  SECOES_RELATORIO,
  tabelasDoRelatorio,
  type BlocoRelatorio,
  type DadosRelatorio,
  type IndicadorRelatorio,
  type OpcoesRelatorio,
  type SecaoRelatorio,
  type TabelaRelatorio,
} from "../relatorio";
import {
  agrupamentos,
  criarContexto,
  evolucaoMensal,
  periodoAnterior,
  projecaoDoSaldo,
  recortesMensais,
  totaisNoIntervalo,
} from "../relatorio-analise";
import { ABAS_DO_EXCEL, abasDoExcel, GRUPOS_DO_PDF, textoDaCelula, textoParaPdf } from "../relatorio-arquivos";
import { calcularSaldoProjetadoPorMes } from "../saldo-projetado";
import { transacoesNoEscopo } from "../transacoes";
import type { Cartao, FaturaItem } from "../types";

const raiz = join(__dirname, "..", "..", "..", "..");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- só caminhos fixos deste teste
const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");

const cartao: Cartao = { id: 7, user_id: "u", nome: "Nubank", cor: "#8A05BE", limite: 5000, dia_vencimento: 10, dia_fechamento: 3, ativo: true, version: 1 };
const item = (dados: Partial<FaturaItem>): FaturaItem => ({
  id: 1, cartao_id: 7, user_id: "u", descricao: "Mercado", valor: 100, data_compra: "2026-09-20", mes_fatura: "2026-10",
  parcela_atual: 1, total_parcelas: 1, categoria_id: 2, pago: false, grupo_parcela_id: null, ...dados,
});
type Lancamento = DadosRelatorio["transacoes"][number];
const lanc = (dados: Partial<Lancamento>): Lancamento => ({
  id: 1, conta_id: 1, categoria_id: 2, tipo: "despesa", valor: 50, descricao: "Conta", data_vencimento: "2026-10-05",
  data_realizacao: "2026-10-05", status: "paga", ...dados,
});

const dados: DadosRelatorio = {
  hoje: "2026-10-15",
  contas: [
    { id: 1, nome: "Corrente", saldo_inicial: 1000, arquivado: false },
    { id: 2, nome: "Poupança", saldo_inicial: 0, arquivado: false },
  ],
  categorias: [
    { id: 1, nome: "Salário", tipo: "receita", meta_mensal: 5000, limite_mensal: null },
    { id: 2, nome: "Alimentação", tipo: "despesa", meta_mensal: null, limite_mensal: 800 },
  ],
  objetivos: [{ id: 9, nome: "Viagem", meta_valor: 2000, saldo_atual: 500, data_prazo: "2027-01-31", arquivado: false }],
  cartoes: [cartao],
  transacoes: [
    lanc({ id: 1, tipo: "receita", categoria_id: 1, valor: 4000, descricao: "Salário", data_vencimento: "2026-10-05", data_realizacao: "2026-10-05" }),
    lanc({ id: 2, valor: 300, descricao: "Feira", status: "pendente", data_vencimento: "2026-10-20", data_realizacao: null }),
    // Atrasado de antes do período: fica fora de Despesas, mas entra em Pendências.
    lanc({ id: 3, valor: 80, descricao: "Luz", status: "pendente", data_vencimento: "2026-09-25", data_realizacao: null }),
    lanc({ id: 4, valor: 200, categoria_id: null, descricao: "[Transf.] Reserva [Destino:2]", data_vencimento: "2026-10-06", data_realizacao: "2026-10-06" }),
    lanc({ id: 5, valor: 150, categoria_id: null, descricao: "[Transf.] Aporte · Guardar em: Viagem [Objetivo:9:guardar]", data_vencimento: "2026-10-07", data_realizacao: "2026-10-07" }),
    lanc({ id: 6, valor: 100, categoria_id: 2, descricao: "Fatura Nubank [PagFatura:7:2026-10:total]", data_vencimento: "2026-10-10", data_realizacao: "2026-10-10" }),
    // Agendada para depois do período (o banco não aceita concluir com data futura).
    lanc({ id: 7, tipo: "receita", categoria_id: 1, valor: 999, descricao: "Fora do período", status: "pendente", data_vencimento: "2026-11-05", data_realizacao: null }),
  ],
  itensFatura: [
    item({ id: 1, valor: 100, mes_fatura: "2026-10", descricao: "Mercado" }),
    item({ id: 2, valor: 60, mes_fatura: "2026-10", descricao: "Pagamento parcial da fatura", categoria_id: null }),
    item({ id: 3, valor: 70, mes_fatura: "2026-11", descricao: "Tênis (2/3)", parcela_atual: 2, total_parcelas: 3 }),
  ],
};

const todas = SECOES_RELATORIO.map((secao) => secao.id);
const outubro: OpcoesRelatorio = { inicio: "2026-10-01", fim: "2026-10-31", contaIds: [], secoes: todas };
const tabela = (blocos: BlocoRelatorio[], titulo: string) => tabelasDoRelatorio(blocos).find((item) => item.titulo === titulo) as TabelaRelatorio;
const coluna = (t: TabelaRelatorio, titulo: string) => t.colunas.findIndex((c) => c.titulo === titulo);
const indicadores = (blocos: BlocoRelatorio[], titulo: string) => {
  const bloco = blocos.find((item) => item.tipo === "indicadores" && item.titulo === titulo);
  return new Map(bloco && bloco.tipo === "indicadores" ? bloco.itens.map((indicador: IndicadorRelatorio) => [indicador.rotulo, indicador.valor]) : []);
};
const secoesNaOrdem = (blocos: BlocoRelatorio[]) => [...new Set(blocos.map((bloco) => bloco.secao))];

describe("relatório: detalhamento (as listas de antes continuam iguais)", () => {
  const relatorio = montarRelatorio(dados, outubro);

  it("traz as seções escolhidas, na ordem, com a linha de títulos", () => {
    expect(secoesNaOrdem(relatorio)).toEqual(todas);
    expect(secoesNaOrdem(montarRelatorio(dados, { ...outubro, secoes: ["despesas", "receitas"] }))).toEqual(["receitas", "despesas"]);
    expect(tabela(relatorio, "Receitas").colunas.map((c) => c.titulo)).toEqual(["Vencimento", "Concluído em", "Descrição", "Categoria", "Conta", "Situação", "Valor"]);
  });

  it("receitas e despesas pela data efetiva; transferências, objetivos e o pagamento da fatura ficam de fora", () => {
    expect(tabela(relatorio, "Receitas").linhas.map((l) => l[2])).toEqual(["Salário"]);
    const despesas = tabela(relatorio, "Despesas");
    expect(despesas.linhas.map((l) => l[2])).toEqual(["Feira"]);
    expect(despesas.linhas[0][coluna(despesas, "Situação")]).toBe("A vencer");
  });

  it("transferências mostram origem e destino, inclusive objetivos", () => {
    expect(tabela(relatorio, "Transferências").linhas.map((l) => [l[2], l[3], l[4]])).toEqual([
      ["Reserva", "Corrente", "Poupança"],
      ["Aporte · Guardar em: Viagem", "Corrente", "Objetivo: Viagem"],
    ]);
  });

  it("faturas pelo vencimento; compras sem os ajustes de pagamento parcial", () => {
    expect(tabela(relatorio, "Faturas").linhas).toEqual([["Nubank", "10/2026", "2026-10-10", "Vencida", 160]]);
    expect(tabela(relatorio, "Compras no cartão").linhas.map((l) => [l[1], l[6]])).toEqual([["Mercado", 100]]);
  });

  it("pendências incluem atrasados de antes do período e o que falta pagar das faturas", () => {
    expect(tabela(relatorio, "Pendências").linhas.map((l) => [l[0], l[1], l[5], l[6]])).toEqual([
      ["2026-09-25", "Luz", "Atrasado", 80],
      ["2026-10-10", "Fatura 10/2026", "Atrasado", 160],
      ["2026-10-20", "Feira", "A vencer", 300],
    ]);
  });

  it("objetivos com o quanto da meta já foi guardado", () => {
    expect(tabela(relatorio, "Objetivos").linhas).toEqual([["Viagem", 2000, 500, 0.25, "2027-01-31"]]);
  });

  it("com contas escolhidas: sem cartão, e o pagamento da fatura vira despesa da conta", () => {
    const soCorrente = montarRelatorio(dados, { ...outubro, contaIds: [1] });
    expect(tabela(soCorrente, "Despesas").linhas.map((l) => l[2])).toEqual(["Fatura Nubank", "Feira"]);
    expect(tabela(soCorrente, "Faturas").linhas).toEqual([]);
    expect(tabela(soCorrente, "Compras no cartão").linhas).toEqual([]);
    expect(tabela(soCorrente, "Saldo por conta").linhas.map((l) => l[0])).toEqual(["Corrente"]);
    // A transferência para a Poupança aparece ao escolher só a Poupança.
    expect(tabela(montarRelatorio(dados, { ...outubro, contaIds: [2] }), "Transferências").linhas.map((l) => l[2])).toEqual(["Reserva"]);
  });

  it("contas arquivadas ficam de fora, como no Início e no Fluxo de caixa", () => {
    const comArquivada = { ...dados, contas: [...dados.contas, { id: 3, nome: "Antiga", saldo_inicial: 70, arquivado: true }] };
    expect(tabela(montarRelatorio(comArquivada, outubro), "Saldo por conta").linhas.map((l) => l[0])).toEqual(["Corrente", "Poupança"]);
  });
});

describe("relatório: resumo financeiro", () => {
  const relatorio = montarRelatorio(dados, outubro);
  const resumo = indicadores(relatorio, "Indicadores do período");

  it("saldo inicial, saldo atual, receitas, despesas e resultado", () => {
    expect(resumo.get("Saldo inicial do período")).toBe(1000);
    // Saldo atual: Corrente 4550 + Poupança 200.
    expect(resumo.get("Saldo atual")).toBe(4750);
    expect(resumo.get("Receitas realizadas")).toBe(4000);
    // O cartão entra pela compra da fatura de outubro; o pagamento da fatura não conta de novo.
    expect(resumo.get("Despesas realizadas")).toBe(100);
    expect(resumo.get("Resultado realizado")).toBe(3900);
    expect(resumo.get("Taxa de poupança")).toBe(0.975);
  });

  it("o resultado é o mesmo Balanço da Visão do mês do Início", () => {
    // Início: recebido - pago (sem o pagamento da fatura e sem objetivos) - compras da fatura do mês.
    const cartaoNoMes = invoicePurchasesInMonth(dados.itensFatura, "2026-10").reduce((soma, i) => soma + i.valor, 0);
    expect(resumo.get("Resultado realizado")).toBe(4000 - 0 - cartaoNoMes);
  });

  it("a receber e a pagar separados em a vencer e atrasados", () => {
    expect(resumo.get("A receber")).toBe(0);
    expect(resumo.get("A pagar")).toBe(380);
    expect(tabela(relatorio, "Valores pendentes").linhas).toEqual([
      ["A receber", 0, 0, 0, 0, 0],
      ["A pagar", 1, 300, 1, 80, 380],
      // A fatura em aberto também está na lista de pendências.
      ["Faturas do cartão", 0, 0, 1, 160, 160],
    ]);
  });

  it("saldo projetado igual ao do Fluxo de caixa, e as faturas em aberto à parte", () => {
    expect(resumo.get("Saldo projetado para 31/10/2026")).toBe(4370);
    const contexto = criarContexto(dados, outubro);
    const fluxo = calcularSaldoProjetadoPorMes(1000, lancamentosDoFluxo(transacoesNoEscopo(dados.transacoes, contexto.idsContas, 2), true, dados.hoje), 2026, new Date(2026, 9, 15, 12));
    expect(fluxo[9].saldo).toBe(4370);
    expect(resumo.get("Faturas do cartão em aberto")).toBe(160);
    expect(resumo.get("Saldo projetado com as faturas")).toBe(4210);
    expect(resumo.get("Guardado em objetivos")).toBe(500);
  });

  it("a projeção inclui sempre os atrasados (o padrão do Fluxo de caixa), e eles aparecem à parte nas pendências", () => {
    // Saldo atual 4750 - Feira 300 - Luz 80 (atrasada) = 4370.
    expect(resumo.get("Saldo projetado para 31/10/2026")).toBe(4370);
    expect(tabela(relatorio, "Valores pendentes").linhas.find((linha) => linha[0] === "A pagar")?.[4]).toBe(80);
  });

  it("destaques: tendência do saldo e o mês em andamento fora do melhor e do pior mês", () => {
    const destaques = tabela(relatorio, "Destaques").linhas;
    expect(destaques[0]).toEqual(["Seu saldo está", "Crescendo (+R$ 3.750,00, +375% desde o início do período)"]);
    // Outubro ainda não terminou: não conta como mês positivo nem negativo.
    expect(destaques.find((linha) => linha[0] === "Meses positivos")).toEqual(["Meses positivos", "0"]);
    expect(destaques.find((linha) => linha[0] === "Meses sem movimentação")).toEqual(["Meses sem movimentação", "0"]);
    expect(destaques.find((linha) => linha[0] === "Mês em andamento")).toEqual(["Mês em andamento", "Outubro 2026: +R$ 3.900,00 até agora (fora do melhor e do pior mês)"]);
  });
});

describe("relatório: evolução mês a mês", () => {
  it("o saldo no fim do mês é o início do seguinte, e resultado e saldo fecham com objetivos e cartão", () => {
    const contexto = criarContexto(dados, { ...outubro, inicio: "2026-09-01" });
    const linhas = evolucaoMensal(contexto);
    expect(linhas.map((linha) => linha.recorte.rotulo)).toEqual(["Setembro 2026", "Outubro 2026"]);
    expect(linhas[0].saldoFim).toBe(linhas[1].saldoInicio);
    for (const linha of linhas) {
      expect(linha.saldoInicio + linha.resultado + linha.objetivosETransferencias + linha.ajusteCartao).toBeCloseTo(linha.saldoFim, 2);
    }
    expect(linhas[1]).toMatchObject({ saldoInicio: 1000, receitas: 4000, despesas: 100, resultado: 3900, objetivosETransferencias: -150, ajusteCartao: 0, saldoFim: 4750, emAndamento: true });
  });

  it("com contas escolhidas, a transferência para outra conta entra em objetivos e transferências", () => {
    const [linha] = evolucaoMensal(criarContexto(dados, { ...outubro, contaIds: [1] }));
    expect(linha).toMatchObject({ receitas: 4000, despesas: 100, resultado: 3900, objetivosETransferencias: -350, saldoFim: 4550 });
    expect(linha.saldoInicio + linha.resultado + linha.objetivosETransferencias + linha.ajusteCartao).toBeCloseTo(linha.saldoFim, 2);
  });

  it("tabela e gráficos do PDF", () => {
    const relatorio = montarRelatorio(dados, outubro);
    const evolucao = tabela(relatorio, "Evolução mensal");
    expect(evolucao.colunas.map((c) => c.titulo)).toEqual(["Mês", "Saldo no início do mês", "Receitas", "Despesas", "Resultado", "Objetivos e transferências", "Saldo no fim do mês"]);
    expect(evolucao.linhas).toEqual([["Outubro 2026 (em andamento)", 1000, 4000, 100, 3900, -150, 4750]]);
    const graficos = relatorio.flatMap((bloco) => (bloco.tipo === "grafico" ? [bloco.grafico] : []));
    expect(graficos.map((grafico) => grafico.id)).toEqual(["saldo", "receitas-despesas", "categorias"]);
    expect(graficos[0]).toMatchObject({ tipo: "linha", rotulos: ["Início", "Out/26"], valores: [1000, 4750] });
  });

  it("meses cortados pelo período e colunas por trimestre ou ano em períodos longos", () => {
    expect(recortesMensais("2026-09-15", "2026-11-10").map((recorte) => recorte.rotulo)).toEqual([
      "Setembro 2026 (15/09 a 30/09)",
      "Outubro 2026",
      "Novembro 2026 (01/11 a 10/11)",
    ]);
    expect(agrupamentos(recortesMensais("2026-01-01", "2026-12-31")).length).toBe(12);
    expect(agrupamentos(recortesMensais("2025-01-01", "2026-03-31")).map((coluna) => coluna.rotulo)).toEqual(["T1/25", "T2/25", "T3/25", "T4/25", "T1/26"]);
    expect(agrupamentos(recortesMensais("2022-01-01", "2026-12-31")).map((coluna) => coluna.rotulo)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
  });
});

describe("relatório: projeção do saldo", () => {
  it("mês a mês até o fim do período, com as faturas em aberto à parte", () => {
    const projecao = projecaoDoSaldo(criarContexto(dados, { ...outubro, fim: "2026-11-30" }));
    expect(projecao?.linhas.map((linha) => [linha.recorte.rotulo, linha.saldoInicio, linha.entradas, linha.saidas, linha.saldoFim, linha.faturas, linha.saldoComFaturas])).toEqual([
      ["Outubro 2026", 4750, 0, 380, 4370, 160, 4210],
      ["Novembro 2026", 4370, 999, 0, 5369, 70, 5139],
    ]);
  });

  it("período no futuro: parte do saldo projetado no dia em que ele começa", () => {
    const projecao = projecaoDoSaldo(criarContexto(dados, { ...outubro, inicio: "2026-11-01", fim: "2026-11-30" }));
    expect(projecao?.linhas).toHaveLength(1);
    expect(projecao?.linhas[0]).toMatchObject({ saldoInicio: 4370, saldoFim: 5369, faturas: 70, saldoComFaturas: 5139 });
    expect(projecao?.saldoProjetado).toBe(5369);
  });

  it("período já encerrado não tem projeção", () => {
    expect(projecaoDoSaldo(criarContexto(dados, { ...outubro, inicio: "2026-09-01", fim: "2026-09-30" }))).toBeNull();
  });
});

describe("relatório: contas, categorias, maiores e cartões", () => {
  const relatorio = montarRelatorio(dados, outubro);

  it("saldo por conta: início, receitas, despesas, o resto da movimentação e os saldos", () => {
    expect(tabela(relatorio, "Saldo por conta").linhas).toEqual([
      // Corrente: -200 de transferência, -150 do objetivo e -100 da fatura paga.
      ["Corrente", 1000, 1000, 4000, 0, -450, 4550, 4550],
      ["Poupança", 0, 0, 0, 0, 200, 200, 200],
    ]);
    expect(tabela(relatorio, "Saldo por conta").total).toEqual(["Total", 1000, 1000, 4000, 0, -250, 4750, 4750]);
  });

  it("despesas e receitas por categoria, com quantidade, porcentagem, pendente e meta ou limite", () => {
    // Pendente: Feira (a vencer) e Luz (atrasada de setembro), o mesmo de "A pagar".
    expect(tabela(relatorio, "Despesas por categoria").linhas).toEqual([["Alimentação", 1, 100, 1, 380, 800]]);
    expect(tabela(relatorio, "Receitas por categoria").linhas).toEqual([["Salário", 1, 4000, 1, 0, 5000]]);
  });

  it("maiores despesas incluem as compras do cartão (e não o pagamento da fatura)", () => {
    expect(tabela(relatorio, "Maiores despesas (top 10)").linhas).toEqual([[1, "2026-09-20", "Mercado", "Alimentação", "Cartão Nubank", 100]]);
    expect(tabela(relatorio, "Maiores receitas (top 10)").linhas.map((l) => l[2])).toEqual(["Salário"]);
    expect(tabela(montarRelatorio(dados, { ...outubro, maiores: 5 }), "Maiores despesas (top 5)")).toBeDefined();
  });

  it("cartões com os mesmos números da tela Cartões, gasto do período e parcelas que faltam", () => {
    const { limiteUsado, emAbertoNoMes } = totaisDoCartao(7, dados.itensFatura, "2026-10");
    expect(tabela(relatorio, "Cartões").linhas).toEqual([["Nubank", 5000, limiteUsado, 5000 - limiteUsado, 100, emAbertoNoMes("2026-10"), emAbertoNoMes("2026-11"), "2026-11-10", 1, 70]]);
    expect(tabela(relatorio, "Compras parceladas em aberto").linhas).toEqual([["Tênis", "Nubank", "2/3", 70, 1, 70, "11/2026"]]);
    expect(ler("web/src/app/(dashboard)/cartoes/page.tsx")).toMatch(/totaisDoCartao\(cartao\.id, itens, mesAtual\)/);
  });

  it("comparação com o período anterior de mesma duração (em andamento: o mesmo trecho)", () => {
    expect(periodoAnterior("2026-10-01", "2026-10-31")).toEqual({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(periodoAnterior("2026-01-01", "2026-12-31")).toEqual({ inicio: "2025-01-01", fim: "2025-12-31" });
    expect(periodoAnterior("2026-09-15", "2026-10-14")).toEqual({ inicio: "2026-08-16", fim: "2026-09-14" });
    // Sem nenhuma receita nem despesa no trecho anterior (01 a 15/09), não há base: aparece o aviso, não a tabela.
    const comparacao = relatorio.filter((bloco) => bloco.secao === "comparacao");
    expect(comparacao).toEqual([{ tipo: "nota", secao: "comparacao", texto: "Comparação com o período anterior: sem dados suficientes no período anterior (01/09/2026 a 15/09/2026) para comparação." }]);
    // Período encerrado sem dados no anterior: o mesmo aviso.
    const setembro = montarRelatorio(dados, { ...outubro, inicio: "2026-09-01", fim: "2026-09-30" }).filter((bloco) => bloco.secao === "comparacao");
    expect(setembro.map((bloco) => (bloco.tipo === "nota" ? bloco.texto : bloco.tipo))).toEqual(["Comparação com o período anterior: sem dados suficientes no período anterior (01/08/2026 a 31/08/2026) para comparação."]);
  });
});

describe("relatório: filtros", () => {
  it("categoria, tipo e situação mudam receitas, despesas e listas, mas não os saldos", () => {
    const soAlimentacao = montarRelatorio(dados, { ...outubro, categoriaIds: [2] });
    const resumo = indicadores(soAlimentacao, "Indicadores do período");
    expect(resumo.get("Receitas realizadas")).toBe(0);
    expect(resumo.get("Despesas realizadas")).toBe(100);
    expect(resumo.get("Saldo atual")).toBe(4750);
    expect(resumo.get("Saldo projetado para 31/10/2026")).toBe(4370);
    // Com filtros, a evolução não mostra as colunas que só fecham sem filtros.
    expect(tabela(soAlimentacao, "Evolução mensal").colunas.map((c) => c.titulo)).toEqual(["Mês", "Saldo no início do mês", "Receitas", "Despesas", "Resultado", "Saldo no fim do mês"]);
    expect(soAlimentacao.some((bloco) => bloco.tipo === "nota" && bloco.texto.includes("dinheiro real das contas"))).toBe(true);

    expect(tabela(montarRelatorio(dados, { ...outubro, tipo: "receita" }), "Despesas").linhas).toEqual([]);
    const atrasados = montarRelatorio(dados, { ...outubro, situacoes: ["atrasado"] });
    expect(tabela(atrasados, "Pendências").linhas.map((l) => l[1])).toEqual(["Luz", "Fatura 10/2026"]);
    expect(tabela(atrasados, "Despesas").linhas).toEqual([]);
  });

  it("cartão escolhido: só as compras e faturas dele", () => {
    const outroCartao = montarRelatorio(dados, { ...outubro, cartaoIds: [99] });
    expect(tabela(outroCartao, "Compras no cartão").linhas).toEqual([]);
    expect(indicadores(outroCartao, "Indicadores do período").get("Despesas realizadas")).toBe(0);
    // A projeção segue o dinheiro real: as faturas de todos os cartões.
    expect(indicadores(outroCartao, "Indicadores do período").get("Faturas do cartão em aberto")).toBe(160);
  });

  it("sem filtros, os totais fecham com a variação do saldo no período", () => {
    const contexto = criarContexto(dados, outubro);
    const totais = totaisNoIntervalo(contexto, "2026-10-01", "2026-10-31", false);
    const variacao = contexto.saldoEm("2026-10-31") - contexto.saldoEm("2026-09-30");
    expect(totais.resultado + totais.objetivos + totais.transferencias + totais.compras - totais.faturasPagas).toBeCloseTo(variacao, 2);
  });
});

describe("relatório: arquivos e acesso", () => {
  it("texto do PDF: valores em reais, datas no padrão brasileiro e sem símbolos que a fonte não tem", () => {
    expect(textoDaCelula(1234.5, "moeda")).toBe("R$ 1.234,50");
    expect(textoDaCelula("2026-10-05", "data")).toBe("05/10/2026");
    expect(textoDaCelula(0.25, "percentual")).toBe("25%");
    expect(textoDaCelula(null, "moeda")).toBe("");
    expect(textoParaPdf("Café — açaí “ok” 🎉")).toBe("Café - açaí \"ok\" ");
  });

  it("cada seção está numa página do PDF e numa aba do Excel", () => {
    for (const grupos of [GRUPOS_DO_PDF.map((grupo) => grupo.secoes), ABAS_DO_EXCEL.map((aba) => aba.secoes)]) {
      const secoes: SecaoRelatorio[] = grupos.flat();
      expect([...secoes].sort()).toEqual([...todas].sort());
    }
  });

  it("Excel: abas organizadas, gráficos na evolução e a primeira linha com os títulos nas listas", () => {
    const cabecalho = { periodo: "01/10/2026 a 31/10/2026", contas: "Todas as contas", filtros: "nenhum", geradoEm: "15/10/2026" };
    const abas = abasDoExcel(montarRelatorio(dados, outubro), cabecalho, () => 300);
    expect(abas.map((aba) => aba.sheet)).toEqual(["Resumo", "Evolução Mensal", "Contas", "Categorias", "Cartões", "Receitas", "Despesas", "Transferências", "Pendências", "Projeção", "Objetivos"]);
    const receitas = abas.find((aba) => aba.sheet === "Receitas");
    expect(receitas?.stickyRowsCount).toBe(1);
    expect(receitas?.data[0]?.[0]).toMatchObject({ value: "Vencimento", fontWeight: "bold" });
    expect(abas.find((aba) => aba.sheet === "Evolução Mensal")?.graficos.map((grafico) => grafico.id)).toEqual(["saldo", "receitas-despesas"]);
    // Sem a aba Resumo, as informações do relatório ficam numa aba "Sobre", no começo.
    expect(abasDoExcel(montarRelatorio(dados, { ...outubro, secoes: ["receitas"] }), cabecalho, () => 300).map((aba) => aba.sheet)).toEqual(["Sobre", "Receitas"]);
  });

  it("contagem de linhas por seção para a tela", () => {
    const contagem = linhasPorSecao(montarRelatorio(dados, outubro));
    expect(contagem.get("receitas")).toBe(1);
    expect(contagem.get("pendencias")).toBe(3);
  });

  it("só Pro e Plus geram, quando os limites de plano estão ligados", () => {
    expect(planHasFeature("free", "report_export", true)).toBe(false);
    expect(planHasFeature("smart", "report_export", true)).toBe(true);
    expect(planHasFeature("premium", "report_export", true)).toBe(true);
    expect(planHasFeature("free", "report_export", false)).toBe(true);
    const pagina = ler("web/src/app/(dashboard)/exportar/page.tsx");
    expect(pagina).toMatch(/planHasFeature\(normalizePlan\(entitlement\.plan\), "report_export", entitlement\.limits_enabled === true\)/);
    expect(ler("web/src/components/layout/dashboard-nav.tsx")).toMatch(/\{ href: "\/exportar", label: "Relatórios", icon: "reports" \}/);
  });

  it("o período é o primeiro bloco da página, em destaque e com as datas exatas", () => {
    const tela = ler("web/src/app/(dashboard)/exportar/report-builder.tsx");
    const cabecalho = tela.slice(tela.indexOf("<header"), tela.indexOf("</header>"));
    expect(cabecalho).not.toMatch(/PeriodNavigator/);
    const depois = tela.slice(tela.indexOf("</header>"));
    expect(depois.indexOf('aria-labelledby="relatorio-periodo"')).toBeLessThan(depois.indexOf("Contas do relatório"));
    expect(depois).toMatch(/<PeriodNavigator\s+size="lg"/);
    expect(depois).toMatch(/\{dataBr\(inicio\)\} a \{dataBr\(fim\)\}/);
  });

  it("a tela tem os filtros e não pergunta sobre atrasados (o relatório traz tudo)", () => {
    const tela = ler("web/src/app/(dashboard)/exportar/report-builder.tsx");
    expect(tela).not.toMatch(/Considerar atrasados|overdueToggle/);
    expect(tela).toMatch(/aria-label="Tipo de lançamento"/);
    expect(tela).toMatch(/aria-label="Situação dos lançamentos"/);
    expect(tela).toMatch(/aria-label="Cartões do relatório"/);
  });
});
