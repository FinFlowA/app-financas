export interface TransactionPaymentSummary {
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
}

export interface TransactionPaymentHistoryItem {
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
}

export interface TransactionPaymentHistory {
  summary: TransactionPaymentSummary;
  payments: TransactionPaymentHistoryItem[];
}

interface TransactionFallback {
  id: number;
  valor: number;
  status: string;
  data_vencimento?: string | null;
  data_realizacao?: string | null;
}

const finiteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonNegativeMoney = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
};

const positiveId = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const nullableId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  return positiveId(value);
};

const dateOnly = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

const booleanValue = (value: unknown): boolean => value === true || value === "true" || value === 1;

export const fallbackTransactionPaymentSummary = (
  transaction: TransactionFallback,
): TransactionPaymentSummary => {
  const value = nonNegativeMoney(transaction.valor) ?? 0;
  const fullyPaid = transaction.status === "paga";
  return {
    rootTransactionId: transaction.id,
    displayTransactionId: transaction.id,
    currentPendingTransactionId: fullyPaid ? null : transaction.id,
    lastPaidTransactionId: fullyPaid ? transaction.id : null,
    technicalTransactionIds: [],
    totalValue: value,
    paidTotal: fullyPaid ? value : 0,
    remainingValue: fullyPaid ? 0 : value,
    isFullyPaid: fullyPaid,
    paymentCount: fullyPaid ? 1 : 0,
    scheduledDate: dateOnly(transaction.data_vencimento),
    lastRealizationDate: dateOnly(transaction.data_realizacao),
  };
};

export const normalizeTransactionPaymentSummary = (
  value: unknown,
  fallback?: TransactionFallback,
): TransactionPaymentSummary | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback ? fallbackTransactionPaymentSummary(fallback) : null;
  }
  const row = value as Record<string, unknown>;
  const rootTransactionId = positiveId(row.root_transaction_id ?? row.transaction_id)
    ?? (fallback ? fallback.id : null);
  const displayTransactionId = positiveId(row.display_transaction_id) ?? rootTransactionId;
  const totalValue = nonNegativeMoney(row.total_value ?? row.scheduled_total);
  const paidTotal = nonNegativeMoney(row.paid_total);
  const remainingValue = nonNegativeMoney(row.remaining_value);
  const paymentCount = finiteNumber(row.payment_count);
  if (
    rootTransactionId === null
    || displayTransactionId === null
    || totalValue === null
    || paidTotal === null
    || remainingValue === null
    || paymentCount === null
    || !Number.isInteger(paymentCount)
    || paymentCount < 0
  ) {
    return fallback ? fallbackTransactionPaymentSummary(fallback) : null;
  }

  const technicalIds = Array.isArray(row.technical_transaction_ids)
    ? row.technical_transaction_ids.map(positiveId).filter((id): id is number => id !== null)
    : [];

  return {
    rootTransactionId,
    displayTransactionId,
    currentPendingTransactionId: nullableId(row.current_pending_transaction_id),
    lastPaidTransactionId: nullableId(row.last_paid_transaction_id),
    technicalTransactionIds: Array.from(new Set(technicalIds)),
    totalValue,
    paidTotal,
    remainingValue,
    isFullyPaid: booleanValue(row.is_fully_paid),
    paymentCount,
    scheduledDate: dateOnly(row.scheduled_date) ?? dateOnly(fallback?.data_vencimento),
    lastRealizationDate: dateOnly(row.last_realization_date) ?? dateOnly(fallback?.data_realizacao),
  };
};

export const normalizeTransactionPaymentSummaries = (
  rows: unknown,
  transactions: TransactionFallback[],
): Map<number, TransactionPaymentSummary> => {
  const fallbackById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const summaries = new Map<number, TransactionPaymentSummary>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const raw = row && typeof row === "object" && !Array.isArray(row)
        ? row as Record<string, unknown>
        : null;
      const id = positiveId(raw?.root_transaction_id ?? raw?.transaction_id);
      const summary = normalizeTransactionPaymentSummary(row, id === null ? undefined : fallbackById.get(id));
      if (summary) summaries.set(summary.rootTransactionId, summary);
    }
  }
  for (const transaction of transactions) {
    if (!summaries.has(transaction.id)) {
      summaries.set(transaction.id, fallbackTransactionPaymentSummary(transaction));
    }
  }
  return summaries;
};

export const normalizeTransactionPaymentHistory = (
  payload: unknown,
  fallback: TransactionFallback,
): TransactionPaymentHistory => {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const summary = normalizeTransactionPaymentSummary(body.summary, fallback)
    ?? fallbackTransactionPaymentSummary(fallback);
  const payments: TransactionPaymentHistoryItem[] = [];
  if (Array.isArray(body.payments)) {
    for (const rawItem of body.payments) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      const transactionId = positiveId(item.transaction_id ?? item.payment_transaction_id);
      const value = nonNegativeMoney(item.value ?? item.realized_value);
      const realizationDate = dateOnly(item.realization_date);
      if (transactionId === null || value === null || realizationDate === null) continue;
      const adjustment = item.adjustment_type;
      const adjustmentType = adjustment === "interest" || adjustment === "discount"
        ? adjustment
        : "none";
      payments.push({
        paymentId: String(item.payment_id ?? transactionId),
        paymentSequence: positiveId(item.payment_sequence) ?? 0,
        transactionId,
        value,
        realizationDate,
        adjustmentType,
        adjustmentValue: nonNegativeMoney(item.adjustment_value) ?? 0,
        active: item.active === undefined ? item.reopened_at == null : booleanValue(item.active),
        reopenedAt: typeof item.reopened_at === "string" ? item.reopened_at : null,
        createdAt: typeof item.created_at === "string" ? item.created_at : null,
      });
    }
  }
  payments.sort((a, b) => {
    const sequenceOrder = b.paymentSequence - a.paymentSequence;
    if (sequenceOrder !== 0) return sequenceOrder;
    const createdOrder = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    if (createdOrder !== 0) return createdOrder;
    return b.realizationDate.localeCompare(a.realizationDate);
  });
  return { summary, payments };
};

export const shouldShowTransactionPaymentBreakdown = (summary: TransactionPaymentSummary): boolean =>
  summary.paymentCount > 1 || (summary.paymentCount > 0 && summary.remainingValue > 0);
