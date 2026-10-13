// O banco aceita no máximo 500 lançamentos por pedido de resumo de pagamentos
// (TRANSACTION_SUMMARY_LIMIT_EXCEEDED); o Histórico do app e o do site pedem em
// blocos de 500, senão uma conta com muitos lançamentos fica sem os resumos.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("resumos de pagamento em blocos de 500", () => {
  it("o app e o site dividem os pedidos", () => {
    const app = readFileSync(join(raiz, "app/(tabs)/transacoes.tsx"), "utf8");
    expect(app).toContain("for (let inicio = 0; inicio < raizes.length; inicio += 500)");
    expect(app).toContain('blocos.map((ids) => supabase.rpc("list_transaction_payment_summaries", { p_transaction_ids: ids }))');
    const site = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/page.tsx"), "utf8");
    expect(site).toContain("index += 500");
    const banco = readFileSync(join(raiz, "supabase/migrations/20260929203600_linha_de_base_producao.sql"), "utf8");
    expect(banco).toContain("coalesce(cardinality(p_transaction_ids),0)>500");
  });
});
