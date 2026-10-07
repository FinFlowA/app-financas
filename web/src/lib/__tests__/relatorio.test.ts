import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planHasFeature } from "../plan-entitlements";
import { montarRelatorio, SECOES_RELATORIO, type DadosRelatorio, type SecaoRelatorio, type TabelaRelatorio } from "../relatorio";
import { textoDaCelula, textoParaPdf } from "../relatorio-arquivos";
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
    lanc({ id: 7, tipo: "receita", categoria_id: 1, valor: 999, descricao: "Fora do período", data_vencimento: "2026-11-05", data_realizacao: "2026-11-05" }),
  ],
  itensFatura: [
    item({ id: 1, valor: 100, mes_fatura: "2026-10", descricao: "Mercado" }),
    item({ id: 2, valor: 60, mes_fatura: "2026-10", descricao: "Pagamento parcial da fatura", categoria_id: null }),
    item({ id: 3, valor: 70, mes_fatura: "2026-11", descricao: "Tênis (2/3)", parcela_atual: 2, total_parcelas: 3 }),
  ],
};

const todas = SECOES_RELATORIO.map((secao) => secao.id);
const outubro = { inicio: "2026-10-01", fim: "2026-10-31", contaIds: [] as number[], secoes: todas };
const tabela = (tabelas: TabelaRelatorio[], secao: SecaoRelatorio) => tabelas.find((item) => item.secao === secao) as TabelaRelatorio;
const coluna = (t: TabelaRelatorio, titulo: string) => t.colunas.findIndex((c) => c.titulo === titulo);

describe("relatório: o que entra em cada seção", () => {
  const relatorio = montarRelatorio(dados, outubro);

  it("traz as seções escolhidas, na ordem, com a linha de títulos", () => {
    expect(relatorio.map((t) => t.secao)).toEqual(todas);
    expect(montarRelatorio(dados, { ...outubro, secoes: ["despesas", "receitas"] }).map((t) => t.secao)).toEqual(["receitas", "despesas"]);
    expect(tabela(relatorio, "receitas").colunas.map((c) => c.titulo)).toEqual(["Vencimento", "Concluído em", "Descrição", "Categoria", "Conta", "Situação", "Valor"]);
  });

  it("receitas e despesas pela data efetiva; transferências, objetivos e o pagamento da fatura ficam de fora", () => {
    expect(tabela(relatorio, "receitas").linhas.map((l) => l[2])).toEqual(["Salário"]);
    const despesas = tabela(relatorio, "despesas");
    expect(despesas.linhas.map((l) => l[2])).toEqual(["Feira"]);
    expect(despesas.linhas[0][coluna(despesas, "Situação")]).toBe("A vencer");
  });

  it("transferências mostram origem e destino, inclusive objetivos", () => {
    const t = tabela(relatorio, "transferencias");
    expect(t.linhas.map((l) => [l[2], l[3], l[4]])).toEqual([
      ["Reserva", "Corrente", "Poupança"],
      ["Aporte · Guardar em: Viagem", "Corrente", "Objetivo: Viagem"],
    ]);
  });

  it("faturas pelo vencimento; compras sem os ajustes de pagamento parcial", () => {
    expect(tabela(relatorio, "faturas").linhas).toEqual([["Nubank", "10/2026", "2026-10-10", "Vencida", 160]]);
    expect(tabela(relatorio, "compras_cartao").linhas.map((l) => [l[1], l[6]])).toEqual([["Mercado", 100]]);
  });

  it("categorias somam lançamentos e compras do cartão, com a meta ou o limite", () => {
    const t = tabela(relatorio, "categorias");
    expect(t.linhas).toEqual([
      ["Alimentação", "Despesa", 100, 300, 400, 800],
      ["Salário", "Receita", 4000, 0, 4000, 5000],
    ]);
  });

  it("pendências incluem atrasados de antes do período e faturas em aberto", () => {
    expect(tabela(relatorio, "pendencias").linhas.map((l) => [l[0], l[1], l[5]])).toEqual([
      ["2026-09-25", "Luz", "Atrasado"],
      ["2026-10-10", "Fatura 10/2026", "Atrasado"],
      ["2026-10-20", "Feira", "A vencer"],
    ]);
  });

  it("resumo e contas", () => {
    expect(tabela(relatorio, "resumo").linhas).toEqual([
      ["Receitas concluídas", 4000],
      ["Receitas pendentes", 0],
      ["Despesas concluídas", 0],
      ["Despesas pendentes", 300],
      ["Compras no cartão (faturas do período)", 100],
      ["Resultado (receitas concluídas - despesas concluídas - cartão)", 3900],
    ]);
    // Corrente: 1000 + 4000 - 200 - 150 - 100 (+ 999 só depois do período).
    expect(tabela(relatorio, "contas").linhas).toEqual([
      ["Corrente", 1000, 4550, 5549],
      ["Poupança", 0, 200, 200],
    ]);
    expect(tabela(relatorio, "objetivos").linhas).toEqual([["Viagem", 2000, 500, 0.25, "2027-01-31"]]);
  });

  it("com contas escolhidas: sem cartão, e o pagamento da fatura vira despesa da conta", () => {
    const soCorrente = montarRelatorio(dados, { ...outubro, contaIds: [1] });
    expect(tabela(soCorrente, "despesas").linhas.map((l) => l[2])).toEqual(["Fatura Nubank", "Feira"]);
    expect(tabela(soCorrente, "faturas").linhas).toEqual([]);
    expect(tabela(soCorrente, "compras_cartao").linhas).toEqual([]);
    expect(tabela(soCorrente, "contas").linhas.map((l) => l[0])).toEqual(["Corrente"]);
    // A transferência para a Poupança aparece ao escolher só a Poupança.
    expect(tabela(montarRelatorio(dados, { ...outubro, contaIds: [2] }), "transferencias").linhas.map((l) => l[2])).toEqual(["Reserva"]);
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
});
