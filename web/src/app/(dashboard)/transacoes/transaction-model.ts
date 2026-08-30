import type { Categoria, Conta, Transacao } from "@/lib/types";
import {
  dataEfetivaTransacao,
  descricaoVisivel,
  getContaDestinoTransferencia,
  getIdSerie,
} from "@/lib/transacoes";

export type TransactionRow = Transacao & {
  version: number;
  transacao_pai_id: number | null;
};

export type PaymentSummary = {
  rootTransactionId: number;
  displayTransactionId: number;
  currentPendingTransactionId: number | null;
  lastPaidTransactionId: number | null;
  technicalTransactionIds: number[];
  totalValue: number;
  paidTotal: number;
  remainingValue: number;
  isFullyPaid: boolean;
  paymentCount: number;
  scheduledDate: string | null;
  lastRealizationDate: string | null;
};

export type PaymentHistoryItem = {
  paymentId: string;
  paymentSequence: number;
  transactionId: number;
  value: number;
  realizationDate: string;
  adjustmentType: "none" | "interest" | "discount";
  adjustmentValue: number;
  active: boolean;
  reopenedAt: string | null;
  createdAt: string | null;
};

export type PaymentHistory = {
  summary: PaymentSummary;
  payments: PaymentHistoryItem[];
  reconciliationAdjustment: { scheduledAmount: number; interestAmount: number; totalAmount: number } | null;
};

export type TransactionKind = "receita" | "despesa" | "transferencia";
export type PeriodFilter = "all" | "attention" | "completed" | "pending" | "overdue" | "today" | "next7";
export type QuickFilter = "attention" | "overdue" | "today" | "next7" | null;

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveId(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return positiveId(value);
}

function nonNegativeMoney(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export function fallbackPaymentSummary(transaction: TransactionRow): PaymentSummary {
  const value = Math.max(0, Number(transaction.valor) || 0);
  const complete = transaction.status === "paga";
  return {
    rootTransactionId: transaction.id,
    displayTransactionId: transaction.id,
    currentPendingTransactionId: complete ? null : transaction.id,
    lastPaidTransactionId: complete ? transaction.id : null,
    technicalTransactionIds: [],
    totalValue: value,
    paidTotal: complete ? value : 0,
    remainingValue: complete ? 0 : value,
    isFullyPaid: complete,
    paymentCount: 0,
    scheduledDate: dateOnly(transaction.data_vencimento),
    lastRealizationDate: dateOnly(transaction.data_realizacao),
  };
}

export function normalizePaymentSummary(value: unknown, transaction: TransactionRow): PaymentSummary {
  const fallback = fallbackPaymentSummary(transaction);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  const rootTransactionId = positiveId(row.root_transaction_id ?? row.transaction_id) ?? fallback.rootTransactionId;
  const displayTransactionId = positiveId(row.display_transaction_id) ?? rootTransactionId;
  const totalValue = nonNegativeMoney(row.total_value ?? row.scheduled_total);
  const paidTotal = nonNegativeMoney(row.paid_total);
  const remainingValue = nonNegativeMoney(row.remaining_value);
  const paymentCount = numberValue(row.payment_count);
  if (totalValue === null || paidTotal === null || remainingValue === null || paymentCount === null || !Number.isInteger(paymentCount) || paymentCount < 0) {
    return fallback;
  }
  const technicalTransactionIds = Array.isArray(row.technical_transaction_ids)
    ? row.technical_transaction_ids.map(positiveId).filter((id): id is number => id !== null)
    : [];
  return {
    rootTransactionId,
    displayTransactionId,
    currentPendingTransactionId: nullableId(row.current_pending_transaction_id),
    lastPaidTransactionId: nullableId(row.last_paid_transaction_id),
    technicalTransactionIds: [...new Set(technicalTransactionIds)],
    totalValue,
    paidTotal,
    remainingValue,
    isFullyPaid: booleanValue(row.is_fully_paid),
    paymentCount,
    scheduledDate: dateOnly(row.scheduled_date) ?? fallback.scheduledDate,
    lastRealizationDate: dateOnly(row.last_realization_date) ?? fallback.lastRealizationDate,
  };
}

export function normalizePaymentHistory(value: unknown, transaction: TransactionRow): PaymentHistory {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const summary = normalizePaymentSummary(body.summary, transaction);
  const payments: PaymentHistoryItem[] = [];
  if (Array.isArray(body.payments)) {
    for (const raw of body.payments) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const transactionId = positiveId(item.transaction_id ?? item.payment_transaction_id);
      const paymentValue = nonNegativeMoney(item.value ?? item.realized_value);
      const realizationDate = dateOnly(item.realization_date);
      if (transactionId === null || paymentValue === null || realizationDate === null) continue;
      const adjustment = item.adjustment_type;
      payments.push({
        paymentId: String(item.payment_id ?? transactionId),
        paymentSequence: positiveId(item.payment_sequence) ?? 0,
        transactionId,
        value: paymentValue,
        realizationDate,
        adjustmentType: adjustment === "interest" || adjustment === "discount" ? adjustment : "none",
        adjustmentValue: nonNegativeMoney(item.adjustment_value) ?? 0,
        active: item.active === undefined ? item.reopened_at == null : booleanValue(item.active),
        reopenedAt: typeof item.reopened_at === "string" ? item.reopened_at : null,
        createdAt: typeof item.created_at === "string" ? item.created_at : null,
      });
    }
  }
  payments.sort((a, b) => b.paymentSequence - a.paymentSequence || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const rawAdjustment = body.reconciliation_adjustment;
  const adjustment = rawAdjustment && typeof rawAdjustment === "object" && !Array.isArray(rawAdjustment)
    ? rawAdjustment as Record<string, unknown>
    : null;
  const scheduledAmount = nonNegativeMoney(adjustment?.scheduled_amount);
  const interestAmount = nonNegativeMoney(adjustment?.interest_amount);
  const totalAmount = nonNegativeMoney(adjustment?.entry_amount);
  return {
    summary,
    payments,
    reconciliationAdjustment: scheduledAmount !== null && interestAmount !== null && totalAmount !== null
      ? { scheduledAmount, interestAmount, totalAmount }
      : null,
  };
}

export function transactionKind(transaction: TransactionRow): TransactionKind {
  return transaction.descricao.includes("[Transf.]") ? "transferencia" : transaction.tipo;
}

export function visibleBaseDescription(description: string): string {
  return descricaoVisivel(description)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
}

export function recurrenceLabel(description: string): string | null {
  const visible = descricaoVisivel(description);
  const installment = visible.match(/\((\d+)\/(\d+)\)$/);
  if (installment) return `Parcela ${installment[1]} de ${installment[2]}`;
  if (/\(Fixa semanal\)$/.test(visible)) return "Fixa semanal";
  if (/\(Fixa anual\)$/.test(visible)) return "Fixa anual";
  if (/\(Fixa\)$/.test(visible)) return "Fixa mensal";
  return null;
}

export function isSeriesTransaction(transaction: TransactionRow): boolean {
  return getIdSerie(transaction.descricao) !== null || recurrenceLabel(transaction.descricao) !== null;
}

export function isInstallmentTransaction(transaction: TransactionRow): boolean {
  return /\(\d+\/\d+\)$/.test(descricaoVisivel(transaction.descricao));
}

export function effectiveTransactionDate(transaction: TransactionRow, summary?: PaymentSummary): string {
  if (summary?.isFullyPaid) {
    return summary.lastRealizationDate ?? transaction.data_realizacao ?? transaction.data_vencimento;
  }
  return summary?.scheduledDate ?? dataEfetivaTransacao(transaction).slice(0, 10);
}

export function destinationAccount(transaction: TransactionRow, accounts: Conta[]): Conta | undefined {
  const id = getContaDestinoTransferencia(transaction.descricao);
  return id === null ? undefined : accounts.find((account) => account.id === id);
}

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function transactionSearchText(transaction: TransactionRow, accounts: Conta[], categories: Categoria[]): string {
  const account = accounts.find((item) => item.id === transaction.conta_id);
  const destination = destinationAccount(transaction, accounts);
  const category = categories.find((item) => item.id === transaction.categoria_id);
  return normalizeSearch([
    descricaoVisivel(transaction.descricao),
    account?.nome,
    destination?.nome,
    category?.nome,
    transactionKind(transaction),
  ].filter(Boolean).join(" "));
}

/** Mesma ordem do app: hoje, futuros crescentes e passados decrescentes. */
export function compareMobileHistory(
  first: { id: number; date: string },
  second: { id: number; date: string },
  today: string,
): number {
  function group(date: string): number {
    return date === today ? 0 : date > today ? 1 : 2;
  }
  const firstGroup = group(first.date);
  const secondGroup = group(second.date);
  if (firstGroup !== secondGroup) return firstGroup - secondGroup;
  if (first.date !== second.date) return firstGroup === 1
    ? first.date.localeCompare(second.date)
    : second.date.localeCompare(first.date);
  return second.id - first.id;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, number - 1, 10, 12)));
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function addIsoDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
}
