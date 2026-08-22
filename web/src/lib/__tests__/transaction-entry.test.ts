import { describe, expect, it } from "vitest";
import { homeTransactionCreationHref, shouldReturnHomeAfterCreation } from "../transaction-entry";

describe("entrada da criação de lançamento", () => {
  it.each(["receita", "despesa", "transferencia"] as const)(
    "identifica a Home como origem do atalho de %s",
    (kind) => {
      expect(homeTransactionCreationHref(kind)).toBe(`/transacoes?new=1&kind=${kind}&source=home`);
    },
  );

  it("aceita apenas o marcador fechado da Home", () => {
    expect(shouldReturnHomeAfterCreation("home")).toBe(true);
    expect(shouldReturnHomeAfterCreation("https://exemplo.com")).toBe(false);
    expect(shouldReturnHomeAfterCreation("/configuracoes")).toBe(false);
    expect(shouldReturnHomeAfterCreation("")).toBe(false);
  });
});
