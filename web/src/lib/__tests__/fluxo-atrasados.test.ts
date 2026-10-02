import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estaEmAtraso, lancamentosDoFluxo } from "../fluxo-atrasados";
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
    expect(pagina).toMatch(/montarSeriesDoFluxo\(lancamentosDoFluxo\(scoped, true, today\), opcoesDasSeries\)/);
    expect(pagina).toMatch(/montarSeriesDoFluxo\(lancamentosDoFluxo\(scoped, false, today\), opcoesDasSeries\)/);
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
