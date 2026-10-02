import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoicePurchasesInMonth } from "../invoices";
import type { FaturaItem } from "../types";

describe("cartão no Balanço do mês (todas as contas)", () => {
  it("cada parcela conta só no mês da sua fatura, sem os ajustes do pagamento", () => {
    const item = (id: number, descricao: string, valor: number, mes_fatura: string) =>
      ({ id, cartao_id: 1, descricao, valor, data_compra: "2026-09-15", mes_fatura, categoria_id: null, pago: false }) as unknown as FaturaItem;
    const itens = [
      item(1, "Notebook (1/10)", 300, "2026-10"),
      item(2, "Notebook (2/10)", 300, "2026-11"),
      item(3, "Mercado", 120, "2026-10"),
      item(4, "Pagamento parcial da fatura", -200, "2026-10"),
      item(5, "Saldo da fatura anterior (2026-09)", 80, "2026-10"),
    ];
    expect(invoicePurchasesInMonth(itens, "2026-10").map((i) => i.id)).toEqual([1, 3]);
    expect(invoicePurchasesInMonth(itens, "2026-11").map((i) => i.id)).toEqual([2]);
  });

  it("site e app somam as compras em Saídas e no Balanço, e deixam o pagamento da fatura de fora", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    const site = readFileSync(join(raiz, "web/src/app/(dashboard)/home-dashboard.tsx"), "utf8");
    const app = readFileSync(join(raiz, "app/(tabs)/index.tsx"), "utf8");
    expect(site).toMatch(/if \(allActiveSelected && isPagamentoFatura\(transaction\.descricao\)\) continue;/);
    expect(site).toMatch(/expense: monthSummary\.despesas \+ cardMonth,/);
    expect(site).toMatch(/monthBalance: monthSummary\.balancoRealizado - cardMonth,/);
    expect(app).toMatch(/escopoHomeEhTodas && isPagamentoFatura\(transacao\.descricao\)\) \|\| isMovimentoObjetivo/);
    expect(app).toMatch(/despesasDoMes: saidasMes \+ cartaoMes,/);
    expect(app).toMatch(/balancoMensal: entradasRealizadasMes - saidasRealizadasMes - cartaoMes,/);
  });
});
