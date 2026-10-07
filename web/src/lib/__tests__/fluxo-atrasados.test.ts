import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataNoFluxo, estaEmAtraso, lancamentosDoFluxo } from "../fluxo-atrasados";
import { transferenciasEntreContas } from "../fluxo-transferencias";
import { calcularSaldoProjetadoPorMes } from "../saldo-projetado";

const HOJE = "2026-10-02";
const lancamentos = [
  { id: 1, tipo: "despesa" as const, valor: 100, status: "pendente" as const, data_vencimento: "2026-09-25", data_realizacao: null },
  { id: 2, tipo: "receita" as const, valor: 50, status: "pendente" as const, data_vencimento: "2026-10-01", data_realizacao: null },
  { id: 3, tipo: "despesa" as const, valor: 30, status: "pendente" as const, data_vencimento: "2026-10-02", data_realizacao: null },
  { id: 4, tipo: "despesa" as const, valor: 20, status: "pendente" as const, data_vencimento: "2026-10-20", data_realizacao: null },
  { id: 5, tipo: "despesa" as const, valor: 70, status: "paga" as const, data_vencimento: "2026-09-10", data_realizacao: "2026-09-10" },
];

describe("filtro Considerar atrasados do fluxo de caixa", () => {
  it("atraso é pendente com vencimento antes de hoje", () => {
    expect(lancamentos.filter((l) => estaEmAtraso(l, HOJE)).map((l) => l.id)).toEqual([1, 2]);
    expect(estaEmAtraso({ status: "pendente", data_vencimento: null }, HOJE)).toBe(false);
  });

  it("ligado mantém tudo; desligado tira só os pendentes vencidos", () => {
    expect(lancamentosDoFluxo(lancamentos, true, HOJE).map((l) => l.id)).toEqual([1, 2, 3, 4, 5]);
    expect(lancamentosDoFluxo(lancamentos, false, HOJE).map((l) => l.id)).toEqual([3, 4, 5]);
  });

  it("o saldo previsto deixa de contar os atrasados", () => {
    const referencia = new Date(`${HOJE}T12:00:00-03:00`);
    const comAtrasados = calcularSaldoProjetadoPorMes(1000, lancamentos, 2026, referencia);
    const semAtrasados = calcularSaldoProjetadoPorMes(1000, lancamentosDoFluxo(lancamentos, false, HOJE), 2026, referencia);
    // Outubro: 1000 - 70 (pago) - 100 + 50 - 30 - 20 = 830 com atrasados; sem eles, 1000 - 70 - 30 - 20 = 880.
    expect(comAtrasados[9].saldo).toBe(830);
    expect(semAtrasados[9].saldo).toBe(880);
  });

  it("site e app usam o mesmo filtro, e ele segue ao trocar mês, contas e visão", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/page.tsx"), "utf8");
    const visao = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/report-overview.tsx"), "utf8");
    const filtros = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/report-filters.tsx"), "utf8");
    const app = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    // O servidor monta as duas versões; a tela troca na hora, sem nova busca.
    expect(pagina).toMatch(/montarSeriesDoFluxo\(lancamentosDoFluxo\(scoped, true, today\), lancamentosDoFluxo\(internas, true, today\), opcoesDasSeries\)/);
    expect(pagina).toMatch(/montarSeriesDoFluxo\(lancamentosDoFluxo\(scoped, false, today\), lancamentosDoFluxo\(internas, false, today\), opcoesDasSeries\)/);
    expect(visao).toMatch(/considerarAtrasados \? series\.comAtrasados : series\.semAtrasados/);
    expect(visao).toMatch(/window\.history\.replaceState\(/);
    expect((visao.match(/params\.set\("atrasados", "0"\)/g) ?? []).length).toBe(3);
    expect(filtros).toMatch(/Considerar atrasados/);
    expect(filtros).toMatch(/name="atrasados" value="0"/);
    expect(filtros).toMatch(/onClick=\{onAlternarAtrasados\}/);
    // O gráfico passa do desenho anterior para o novo, respeitando quem prefere menos movimento.
    const grafico = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/fluxo-saldo-chart.tsx"), "utf8");
    expect(grafico).toMatch(/useQuadroAnimado\(mesesDestino, saldosDestino, period\)/);
    expect(grafico).toMatch(/prefers-reduced-motion: reduce/);
    expect(app).toMatch(/lancamentosDoFluxo\(transacoesFiltradas, considerarAtrasados, hojeIso\)/);
    expect(app).toMatch(/Considerar atrasados/);
  });
});

describe("transferências entre as contas escolhidas no fluxo", () => {
  const transferencias = [
    { id: 1, conta_id: 1, tipo: "despesa", valor: 200, status: "pendente", data_vencimento: "2026-09-25", descricao: "[Transf.] Reserva [Destino:2]" },
    { id: 2, conta_id: 1, tipo: "despesa", valor: 80, status: "paga", data_vencimento: "2026-10-01", descricao: "[Transf.] Para a 3 [Destino:3]" },
    { id: 3, conta_id: 1, tipo: "despesa", valor: 50, status: "pendente", data_vencimento: "2026-10-20", descricao: "[Transf.] Antiga" },
    { id: 4, conta_id: 2, tipo: "receita", valor: 50, status: "pendente", data_vencimento: "2026-10-20", descricao: "[Transf.] Antiga" },
    { id: 5, conta_id: 1, tipo: "despesa", valor: 90, status: "pendente", data_vencimento: "2026-09-20", descricao: "[Transf.] Guardar [Objetivo:4:guardar]" },
    { id: 6, conta_id: 1, tipo: "despesa", valor: 10, status: "pendente", data_vencimento: "2026-09-20", descricao: "Mercado" },
  ];

  it("entram as que ficam dentro da seleção, inclusive atrasadas; antigas contam só a saída", () => {
    expect(transferenciasEntreContas(transferencias, new Set([1, 2, 3])).map((t) => t.id)).toEqual([1, 2, 3]);
    // A que vai para fora da seleção já conta como saída no fluxo.
    expect(transferenciasEntreContas(transferencias, new Set([1, 2])).map((t) => t.id)).toEqual([1, 3]);
    // Com uma conta só, a transferência já é entrada ou saída dela.
    expect(transferenciasEntreContas(transferencias, new Set([1]))).toEqual([]);
  });

  it("seguem o filtro Considerar atrasados", () => {
    const internas = transferenciasEntreContas(transferencias, new Set([1, 2, 3]));
    expect(lancamentosDoFluxo(internas, false, HOJE).map((t) => t.id)).toEqual([2, 3]);
  });

  it("aparecem nas informações do mês do site e do app, sem mudar o saldo", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    const grafico = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/fluxo-saldo-chart.tsx"), "utf8");
    expect(grafico).toMatch(/<span>Transferências a fazer<\/span>/);
    const app = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    expect(app).toMatch(/lancamentosDoFluxo\(transferenciasEntreContas\(transacoes, idsEscopoFluxo\), considerarAtrasados, hojeIso\)/);
    expect(app).toMatch(/label="Transferências a fazer"/);
  });
});

describe("atrasados de meses anteriores no mês atual", () => {
  const pendentes = [
    { tipo: "receita" as const, valor: 900, status: "pendente" as const, data_vencimento: "2026-09-05", data_realizacao: null },
    { tipo: "despesa" as const, valor: 100, status: "pendente" as const, data_vencimento: "2025-12-10", data_realizacao: null },
    { tipo: "despesa" as const, valor: 300, status: "pendente" as const, data_vencimento: "2026-10-01", data_realizacao: null },
    { tipo: "receita" as const, valor: 50, status: "pendente" as const, data_vencimento: "2026-10-20", data_realizacao: null },
    { tipo: "despesa" as const, valor: 70, status: "paga" as const, data_vencimento: "2026-09-10", data_realizacao: "2026-09-10" },
  ];

  it("entram no mês atual, no dia de hoje; os do próprio mês e os concluídos ficam na sua data", () => {
    expect(pendentes.map((l) => dataNoFluxo(l, l.data_realizacao ?? l.data_vencimento, HOJE)))
      .toEqual([HOJE, HOJE, "2026-10-01", "2026-10-20", "2026-09-10"]);
  });

  it("assim, as previsões do mês atual somam o mesmo que o saldo projetado", () => {
    const outubro = calcularSaldoProjetadoPorMes(1000, pendentes, 2026, new Date(2026, 9, 2, 12))[9];
    const doMes = pendentes.filter((l) => l.status === "pendente" && dataNoFluxo(l, l.data_vencimento, HOJE).startsWith("2026-10"));
    const previsto = doMes.reduce((total, l) => total + (l.tipo === "receita" ? l.valor : -l.valor), 0);
    expect(outubro.saldo).toBe(1000 - 70 + previsto);
  });

  it("site e app usam a mesma regra nas barras e nas informações do mês", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/page.tsx"), "utf8");
    expect(pagina).toMatch(/const date = dataNoFluxo\(transaction, dataEfetivaTransacao\(transaction\), today\);/);
    const app = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    expect(app).toMatch(/const dataDoMes = dataNoFluxo\(transacao, dataEfetiva, hojeIso\);/);
  });
});
