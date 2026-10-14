// Fluxo de caixa: na visão diária, Receitas e Despesas por categoria mostram só
// o dia selecionado (na mensal, o mês). As compras do cartão contam no dia do
// vencimento da fatura, como no mês da fatura da visão mensal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");
const pasta = join(raiz, "web/src/app/(dashboard)/relatorios");

describe("categorias do dia no Fluxo de caixa", () => {
  const visao = readFileSync(join(pasta, "report-overview.tsx"), "utf8");
  const pagina = readFileSync(join(pasta, "page.tsx"), "utf8");

  it("a visão diária filtra as categorias pelo dia selecionado", () => {
    expect(visao).toContain('view === "daily" ? categoriasDoDia(categorias.receitas, diaIso)');
    expect(visao).toContain('view === "daily" ? categoriasDoDia(categorias.despesas, diaIso)');
    expect(visao).toContain("(detalhe.day ?? detalhe.date).slice(0, 10) === dia");
  });

  it("as compras do cartão contam no vencimento da fatura", () => {
    expect(pagina).toContain("day: invoiceDueDate(detailMonth, dueDayByCard.get(item.cartao_id) ?? 1)");
  });
});
