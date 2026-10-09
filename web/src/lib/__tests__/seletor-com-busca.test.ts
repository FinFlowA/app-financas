// Busca por digitação nos seletores do site (categorias, contas e destinos),
// com a mesma regra do SeletorLista do app (lib/seletor-busca.ts, testada em
// npm run test:app-helpers). O teste não importa a função: arquivos da raiz do
// projeto não carregam no vitest do site no CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");
const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");

describe("seletor com busca no site", () => {
  it("o FinFlowSelect usa a busca do app e os campos de categoria, conta e destino a ligam", () => {
    const seletor = ler("web/src/components/ui/finflow-select.tsx");
    expect(seletor).toContain('import { filtrarOpcoesSeletor } from "../../../../lib/seletor-busca";');
    expect(seletor).toMatch(/placeholder="Digite para pesquisar"/);
    const historico = ler("web/src/app/(dashboard)/transacoes/transaction-manager.tsx");
    expect(historico.match(/<FinFlowSelect[^>]*name="category_id"[^>]*searchable/g)).toHaveLength(2);
    expect(historico.match(/<FinFlowSelect[^>]*name="account_id"[^>]*searchable/g)).toHaveLength(2);
    expect(historico).toMatch(/<FinFlowSelect required searchable value=\{destination\}/);
    expect(ler("web/src/app/(dashboard)/cartoes/nova-compra-form.tsx")).toMatch(/name="category_id" required searchable/);
    expect(ler("web/src/app/(dashboard)/conciliacao/reconciliation-workspace.tsx")).toMatch(/<FinFlowSelect searchable value=\{item\.categoryId/);
  });
});
