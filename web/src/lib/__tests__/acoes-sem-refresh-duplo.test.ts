// Ações do Histórico, Início e Calendário: a ação do servidor já devolve a
// página atualizada (revalidatePath), então a tela não chama router.refresh()
// de novo, o que montava a página inteira duas vezes. E o Histórico busca
// transações, faturas e conciliação ao mesmo tempo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("ações sem atualização dupla", () => {
  it("as ações de lançamento atualizam as páginas pelo servidor", () => {
    const acoes = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/actions.ts"), "utf8");
    for (const pagina of ['"/"', '"/transacoes"', '"/calendario"']) expect(acoes).toContain(`revalidatePath(${pagina})`);
  });

  it("as telas não pedem a página de novo depois da ação", () => {
    expect(readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8")).not.toContain("router.refresh()");
    expect(readFileSync(join(raiz, "web/src/app/(dashboard)/home-dashboard.tsx"), "utf8")).not.toContain("router.refresh()");
    expect(readFileSync(join(raiz, "web/src/app/(dashboard)/calendario/calendar-manager.tsx"), "utf8")).not.toContain("router.refresh()");
  });

  it("o Histórico busca transações, faturas e conciliação ao mesmo tempo", () => {
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/page.tsx"), "utf8");
    expect(pagina).toMatch(/const \[transactions, invoiceItems, reconciledResult\] = await Promise\.all\(\[\s*loadTransactions\(\),\s*loadInvoiceItems\(\),/);
  });
});
