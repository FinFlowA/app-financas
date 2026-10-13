// Guardar e resgatar de objetivo não têm categoria. As séries antigas não trazem
// "[Transf.]" na descrição, e a edição no site pedia uma categoria para elas
// ("Escolha uma categoria compatível."), embora a tela já as mostrasse como
// transferência.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMovimentoObjetivo, isTransferencia } from "../transacoes";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("editar guardar/resgatar de objetivo no site", () => {
  it("a descrição antiga é movimento de objetivo, sem a marca de transferência", () => {
    const antiga = "Guardar em: Entrada casa (Fixa)";
    expect(isTransferencia(antiga)).toBe(false);
    expect(isMovimentoObjetivo(antiga)).toBe(true);
    expect(isMovimentoObjetivo("Resgate de: Viagem")).toBe(true);
  });

  it("a ação de editar não pede categoria para movimento de objetivo, como a tela", () => {
    const acao = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/actions.ts"), "utf8");
    expect(acao).toContain("const transfer = isTransferencia(current.descricao) || isMovimentoObjetivo(current.descricao);");
    const modelo = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-model.ts"), "utf8");
    expect(modelo).toContain('transaction.descricao.includes("[Transf.]") || isMovimentoObjetivo(transaction.descricao) ? "transferencia"');
  });
});
