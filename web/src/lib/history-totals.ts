import type { InvoiceHistoryGroup } from "./invoices";
import {
  getReferenciaPagamentoFatura,
  isMovimentoObjetivo,
  isTransferencia,
} from "./transacoes";

export type HistoryFinancialEvent = {
  tipo: "receita" | "despesa";
  valor: number;
  descricao: string;
};

export function historyFinancialTotals(
  events: HistoryFinancialEvent[],
  visibleInvoices: InvoiceHistoryGroup[],
): { receita: number; despesa: number } {
  const visibleInvoiceKeys = new Set(visibleInvoices.map((invoice) => `${invoice.cardId}:${invoice.invoiceMonth}`));
  const result = { receita: 0, despesa: 0 };

  for (const transaction of events) {
    if (isTransferencia(transaction.descricao) || isMovimentoObjetivo(transaction.descricao)) continue;
    const invoicePayment = getReferenciaPagamentoFatura(transaction.descricao);
    if (invoicePayment && visibleInvoiceKeys.has(`${invoicePayment.cartaoId}:${invoicePayment.mes}`)) continue;
    const value = Number(transaction.valor);
    if (Number.isFinite(value)) result[transaction.tipo] += value;
  }
  for (const invoice of visibleInvoices) {
    const value = Number(invoice.total);
    if (Number.isFinite(value)) result.despesa += value;
  }
  return result;
}
