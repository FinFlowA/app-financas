// Fluxo de caixa: na visão diária, o dia de hoje mostra o saldo real das contas
// (o mesmo do Início), e não o ponto do gráfico, que soma os atrasados.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("saldo de hoje no Fluxo de caixa", () => {
  it("visão diária: hoje usa o saldo atual das contas", () => {
    const visao = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/report-overview.tsx"), "utf8");
    expect(visao).toContain("? isToday ? currentBalance : activeDayPoint?.saldo ?? initialBalance");
    expect(visao).toContain('? "Saldo atual das contas"');
  });

  it("visão diária: os atrasados, inclusive deste mês, aparecem no quadro de hoje", () => {
    // O saldo projetado já os soma em hoje; o quadro do dia precisa explicar a queda.
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/page.tsx"), "utf8");
    expect(pagina).toContain("const dia = atrasado ? today : date;");
    expect(pagina).toContain("const daily = diaNoFluxoDiario(transaction, date);");
    expect(pagina).toContain("const daily = diaNoFluxoDiario(transfer, date);");
    const grafico = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/fluxo-saldo-chart.tsx"), "utf8");
    expect(grafico).toContain('"lançamento atrasado" : "lançamentos atrasados"');
  });
});
