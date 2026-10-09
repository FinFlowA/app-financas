// Seletor de período (Histórico e Relatórios): o mês do pequeno calendário é
// clicável e abre a escolha de mês e ano, sem precisar ir de seta em seta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("calendário do período", () => {
  const seletor = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/month-picker.tsx"), "utf8");

  it("o título do calendário abre a grade de meses com troca de ano", () => {
    expect(seletor).toContain("Escolher mês e ano do calendário");
    expect(seletor).toContain("onClick={() => { setGridYear(view.year); setChoosingMonth(true); }}");
    // Escolher o mês leva o calendário para ele e volta para os dias.
    expect(seletor).toContain("onClick={() => { setView({ year: gridYear, month: index + 1 }); setChoosingMonth(false); }}");
    expect(seletor).toContain('aria-label="Ano anterior do calendário"');
    expect(seletor).toContain('aria-label="Próximo ano do calendário"');
  });
});
