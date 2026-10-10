import { describe, expect, it } from "vitest";
import { selectedTransactionIds } from "../reconciliation-selection";

const candidatos = [{ id: 10 }, { id: 20 }, { id: 30 }];

describe("lançamentos selecionados na conciliação", () => {
  it("mantém os escolhidos que ainda são candidatos, na ordem da escolha", () => {
    expect(selectedTransactionIds({ transactionId: 30, transactionIds: [30, 10] }, candidatos)).toEqual([30, 10]);
  });

  it("ignora o lançamento que deixou de ser candidato em vez de contá-lo como selecionado", () => {
    expect(selectedTransactionIds({ transactionId: 99, transactionIds: [99] }, candidatos)).toEqual([]);
    expect(selectedTransactionIds({ transactionId: 99, transactionIds: [99, 20] }, candidatos)).toEqual([20]);
  });

  it("usa o transactionId de rascunhos antigos sem a lista de ids", () => {
    expect(selectedTransactionIds({ transactionId: 20 }, candidatos)).toEqual([20]);
    expect(selectedTransactionIds({ transactionId: 20, transactionIds: [] }, candidatos)).toEqual([20]);
    expect(selectedTransactionIds({ transactionId: 99, transactionIds: [] }, candidatos)).toEqual([]);
    expect(selectedTransactionIds({ transactionId: null, transactionIds: [] }, candidatos)).toEqual([]);
  });
});
