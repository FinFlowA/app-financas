// Histórico do site: trocar de mês mantém o filtro escolhido (Todos, Concluídos,
// Pendentes) e "Limpar filtros" volta também para o mês atual.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("filtros do Histórico", () => {
  const tela = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8");

  it("as setas de mês e o período de/até mantêm Todos, Concluídos e Pendentes", () => {
    expect(tela).toContain('period === "all" || period === "completed" || period === "pending" ? period : "pending"');
    expect(tela).toMatch(/function chooseMonth\(next: string\) \{ const nextPeriod = periodForNewDates\(\);/);
    expect(tela).toMatch(/function chooseRange\(next: HistoryRange\) \{ const nextPeriod = periodForNewDates\(\);/);
  });

  it("limpar filtros volta para o mês atual, e um mês diferente conta como filtro", () => {
    const limpar = tela.slice(tela.indexOf("function clearFilters()"), tela.indexOf("function toggle<"));
    expect(limpar).toContain("setMonth(currentMonth)");
    expect(limpar).toContain('syncUrl("pending", currentMonth, null)');
    expect(tela).toContain("|| month !== today.slice(0, 7)");
  });
});
