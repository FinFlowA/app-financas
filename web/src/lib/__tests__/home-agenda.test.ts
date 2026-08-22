import { describe, expect, it } from "vitest";
import { listUpcomingTransactions } from "../home-agenda";
import type { Transacao } from "../types";

function transaction(id: number, dueDate: string, status: Transacao["status"] = "pendente"): Transacao {
  return {
    id,
    user_id: "user-1",
    conta_id: 1,
    categoria_id: 1,
    tipo: "despesa",
    valor: 10,
    descricao: `Agendamento ${id}`,
    data_vencimento: dueDate,
    data_realizacao: null,
    status,
    version: 1,
    transacao_pai_id: null,
  };
}

describe("agenda da Home", () => {
  it("mantém todos os agendamentos dos próximos sete dias, sem corte visual", () => {
    const rows = [
      transaction(8, "2026-08-29"),
      transaction(7, "2026-08-28"),
      transaction(6, "2026-08-27"),
      transaction(5, "2026-08-26"),
      transaction(4, "2026-08-25"),
      transaction(3, "2026-08-24"),
      transaction(2, "2026-08-23"),
      transaction(1, "2026-08-22"),
      transaction(9, "2026-08-30"),
      transaction(10, "2026-08-22", "paga"),
    ];

    const result = listUpcomingTransactions(rows, "2026-08-22", "2026-08-29");

    expect(result).toHaveLength(8);
    expect(result.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
