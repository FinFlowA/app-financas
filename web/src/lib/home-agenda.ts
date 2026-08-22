import type { Transacao } from "./types";

export function listUpcomingTransactions(
  transactions: readonly Transacao[],
  today: string,
  lastDay: string,
): Transacao[] {
  return transactions
    .filter((transaction) => transaction.status === "pendente"
      && transaction.data_vencimento >= today
      && transaction.data_vencimento <= lastDay)
    .sort((first, second) => first.data_vencimento.localeCompare(second.data_vencimento) || first.id - second.id);
}
