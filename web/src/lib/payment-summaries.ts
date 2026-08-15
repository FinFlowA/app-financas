export type PaymentSummaryResult = {
  data: unknown;
  error: unknown;
};

export function collectPaymentSummaryRows(results: PaymentSummaryResult[]): unknown[] {
  if (results.some((result) => result.error || !Array.isArray(result.data))) {
    throw new Error("TRANSACTION_PAYMENT_SUMMARIES_UNAVAILABLE");
  }
  return results.flatMap((result) => result.data as unknown[]);
}
