// Lançamento incerto ("não tenho certeza deste lançamento"): o filtro
// "Considerar incertos" do Fluxo de caixa (site e app) e a marcação no
// Histórico, na criação e na edição.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estaIncerto, lancamentosSemIncertos } from "../fluxo-incertos";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("filtro Considerar incertos", () => {
  const lancamentos = [
    { id: 1, status: "pendente", incerta: true },
    { id: 2, status: "pendente", incerta: false },
    { id: 3, status: "paga", incerta: true },
    { id: 4, status: "pendente" },
  ];

  it("só o pendente marcado é incerto; o concluído nunca é", () => {
    expect(lancamentos.filter(estaIncerto).map((item) => item.id)).toEqual([1]);
  });

  it("ligado mantém tudo; desligado tira só os incertos", () => {
    expect(lancamentosSemIncertos(lancamentos, true).map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(lancamentosSemIncertos(lancamentos, false).map((item) => item.id)).toEqual([2, 3, 4]);
  });
});

describe("lançamento incerto nas telas", () => {
  it("site: Fluxo com o filtro e Histórico com etiqueta, filtro, criação e edição", () => {
    const filtros = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/report-filters.tsx"), "utf8");
    expect(filtros).toContain("<strong>Considerar incertos</strong>");
    const historico = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8");
    expect(historico).toContain('{ value: "uncertain", label: "Incertos" }');
    expect(historico).toContain("{!recurring && kind !== \"transferencia\" && status === \"pendente\" && <UncertainToggle");
    expect(historico).toContain("{canBeUncertain && <UncertainToggle");
    const acoes = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/actions.ts"), "utf8");
    expect(acoes).toContain('supabase.from("transacoes").update({ incerta: uncertain })');
  });

  it("app: Fluxo com o filtro e Histórico com etiqueta, filtro, criação e edição", () => {
    const fluxo = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    expect(fluxo).toContain("lancamentosSemIncertos(lancamentosDoFluxo(transacoesFiltradas, considerarAtrasados, hojeIso), considerarIncertos)");
    const historico = readFileSync(join(raiz, "app/(tabs)/transacoes.tsx"), "utf8");
    expect(historico).toContain('{ key: "incertos", label: "Incertos" }');
    expect(historico).toContain("{podeSerIncerta(transacaoEditando) && !pago && (");
    const inicio = readFileSync(join(raiz, "app/(tabs)/index.tsx"), "utf8");
    expect(inicio).toContain("idDoLancamentoCriado(resultado.result)");
  });
});
