import { describe, expect, it } from "vitest";
import { buildCategoryChanges } from "../../app/(dashboard)/categorias/category-edit";

const ORIGINAL = {
  name: "Alimentação",
  color: "#16966E",
  icon: "restaurant",
};

describe("edição de categoria", () => {
  it("preserva cor e ícone legados ao alterar apenas o nome", () => {
    expect(buildCategoryChanges(ORIGINAL, ORIGINAL, {
      ...ORIGINAL,
      name: "Mercado",
    })).toEqual({ changes: { name: "Mercado" }, conflicts: [] });
  });

  it("normaliza a comparação de cor sem criar uma alteração falsa", () => {
    expect(buildCategoryChanges(
      { ...ORIGINAL, color: "#16966e" },
      ORIGINAL,
      ORIGINAL,
    )).toEqual({ changes: {}, conflicts: [] });
  });

  it("não sobrescreve um mesmo campo alterado em outro dispositivo", () => {
    expect(buildCategoryChanges(
      { ...ORIGINAL, name: "Supermercado" },
      ORIGINAL,
      { ...ORIGINAL, name: "Compras" },
    )).toEqual({ changes: {}, conflicts: ["name"] });
  });

  it("permite editar um campo quando outro mudou no servidor", () => {
    expect(buildCategoryChanges(
      { ...ORIGINAL, icon: "shopping-cart" },
      ORIGINAL,
      { ...ORIGINAL, name: "Mercado" },
    )).toEqual({ changes: { name: "Mercado" }, conflicts: [] });
  });
});
