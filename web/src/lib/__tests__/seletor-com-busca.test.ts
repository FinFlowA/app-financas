// Busca por digitação nos seletores do site (categorias, contas e destinos),
// com a mesma regra do SeletorLista do app (lib/seletor-busca.ts, testada em
// npm run test:app-helpers). O teste não importa a função: arquivos da raiz do
// projeto não carregam no vitest do site no CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("seletor com busca no site", () => {
  it("o FinFlowSelect usa a busca do app e os campos de categoria, conta e destino a ligam", () => {
    const seletor = readFileSync(join(raiz, "web/src/components/ui/finflow-select.tsx"), "utf8");
    expect(seletor).toContain('import { filtrarOpcoesSeletor } from "../../../../lib/seletor-busca";');
    expect(seletor).toMatch(/placeholder="Digite para pesquisar"/);
    const historico = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8");
    expect(historico.match(/<FinFlowSelect[^>]*name="category_id"[^>]*searchable/g)).toHaveLength(2);
    expect(historico.match(/<FinFlowSelect[^>]*name="account_id"[^>]*searchable/g)).toHaveLength(2);
    expect(historico).toMatch(/<FinFlowSelect required searchable value=\{destination\}/);
    expect(readFileSync(join(raiz, "web/src/app/(dashboard)/cartoes/nova-compra-form.tsx"), "utf8")).toMatch(/name="category_id" required searchable/);
    expect(readFileSync(join(raiz, "web/src/app/(dashboard)/conciliacao/reconciliation-workspace.tsx"), "utf8")).toMatch(/<FinFlowSelect searchable value=\{item\.categoryId/);
  });
});
