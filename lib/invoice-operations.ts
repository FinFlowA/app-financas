import { supabase } from "./supabase";

export type InvoiceRemainderMode = "full" | "keep_open" | "carry";

export interface PayInvoiceInput {
  cardId: number;
  invoiceMonth: string;
  accountId: number;
  paymentAmount: number;
  remainderMode: InvoiceRemainderMode;
  interestValue?: number | null;
  interestPercent?: number | null;
  requestId: string;
}

export interface InvoicePaymentTransaction {
  id: number;
  description: string;
  mode: "total" | "parcial" | "saldo_transferido";
  linkedItemId: number | null;
}

const PAYMENT_MARKER = /\[PagFatura:(\d+):(\d{4}-\d{2}):(total|parcial|saldo_transferido)(?::(\d+))?\]\s*$/;

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  AI_ACCOUNT_ARCHIVED: "Reative a conta escolhida antes de pagar a fatura.",
  AI_ACCOUNT_NOT_FOUND: "A conta escolhida não está mais disponível.",
  AI_CARD_ARCHIVED: "Reative o cartão antes de alterar esta fatura.",
  AI_CARD_NOT_FOUND: "O cartão não está mais disponível.",
  AI_INVOICE_ALREADY_SETTLED: "Esta fatura já foi paga ou está zerada.",
  AI_INVOICE_HAS_LATER_PAYMENT: "Existe um pagamento posterior ligado a este. Estorne primeiro o pagamento mais recente.",
  AI_INVOICE_HAS_UNTRACKED_PAYMENT: "Há um pagamento antigo nesta fatura que precisa ser conciliado antes do estorno.",
  AI_INVOICE_PAYMENT_ALREADY_REVERSED: "Este pagamento já foi estornado.",
  AI_INVALID_INTEREST: "O valor dos juros informado é inválido.",
  AI_INVALID_INTEREST_PERCENT: "O percentual de juros informado é inválido.",
  AI_INVALID_INVOICE_MONTH: "O mês da fatura é inválido.",
  AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED: "Este pagamento foi criado por uma versão antiga e não pode ser estornado automaticamente com segurança.",
  AI_MULTIPLE_INTEREST_MODES: "Informe os juros em valor ou percentual, não nos dois formatos.",
  AI_NOT_AN_INVOICE_PAYMENT: "Este lançamento não corresponde a um pagamento de fatura.",
  AI_PARTIAL_PAYMENT_MISMATCH: "O pagamento parcial precisa ser menor que o saldo atual da fatura.",
  AI_PAYMENT_ABOVE_INVOICE: "O pagamento não pode ultrapassar o saldo atual da fatura.",
  AI_PAYMENT_TRANSACTION_NOT_FOUND: "O pagamento não foi encontrado. Atualize a tela e tente novamente.",
  AI_TOTAL_PAYMENT_MISMATCH: "O valor integral precisa ser igual ao saldo atual da fatura.",
  FINANCE_INVOICE_PAYMENT_ALREADY_REVERSED: "Este pagamento já foi estornado.",
  FINANCE_INVOICE_PAYMENT_NOT_FOUND: "O pagamento não foi encontrado. Atualize a tela e tente novamente.",
  FINANCE_LEGACY_INVOICE_REVERSAL_UNSUPPORTED: "Este pagamento foi criado por uma versão antiga e não pode ser estornado automaticamente com segurança.",
};

export class InvoiceOperationError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "InvoiceOperationError";
    this.code = code;
  }
}

export function createInvoiceOperationRequestId(): string {
  const availableCrypto = (globalThis as any).crypto;
  if (typeof availableCrypto?.randomUUID === "function") {
    return availableCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof availableCrypto?.getRandomValues === "function") {
    availableCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function parseInvoicePaymentMarker(description?: string | null): {
  cardId: number;
  invoiceMonth: string;
  mode: InvoicePaymentTransaction["mode"];
  linkedItemId: number | null;
} | null {
  const match = (description ?? "").match(PAYMENT_MARKER);
  if (!match) return null;
  return {
    cardId: Number(match[1]),
    invoiceMonth: match[2],
    mode: match[3] as InvoicePaymentTransaction["mode"],
    linkedItemId: match[4] ? Number(match[4]) : null,
  };
}

export function isInvoicePaymentAdjustment(description?: string | null): boolean {
  const value = description ?? "";
  return value === "Pagamento parcial da fatura"
    || /^Saldo da fatura anterior \(.+\)$/.test(value);
}

function operationError(error: unknown, fallback: string): InvoiceOperationError {
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const combined = [candidate?.code, candidate?.message, candidate?.details, candidate?.hint]
    .filter(Boolean)
    .join(" ");
  const domainCode = combined.match(/\b(?:AI|FINANCE)_[A-Z0-9_]+\b/)?.[0] ?? null;
  if (domainCode && FRIENDLY_ERROR_MESSAGES[domainCode]) {
    return new InvoiceOperationError(FRIENDLY_ERROR_MESSAGES[domainCode], domainCode);
  }
  if (candidate?.code === "PGRST202" || /finance_(?:pay_invoice|reverse_invoice_payment)/i.test(combined)) {
    return new InvoiceOperationError(
      "A atualização segura de faturas ainda está sendo concluída. Tente novamente em instantes.",
      candidate?.code ?? null,
    );
  }
  if (/network|fetch|conex|offline|timeout/i.test(combined)) {
    return new InvoiceOperationError(
      "Não foi possível confirmar a operação agora. Confira sua conexão e tente novamente; o mesmo pedido será reutilizado com segurança.",
      domainCode,
    );
  }
  return new InvoiceOperationError(fallback, domainCode);
}

export async function payInvoice(input: PayInvoiceInput): Promise<unknown> {
  const { data, error } = await supabase.rpc("finance_pay_invoice", {
    p_card_id: input.cardId,
    p_invoice_month: input.invoiceMonth,
    p_account_id: input.accountId,
    p_payment_amount: input.paymentAmount,
    p_remainder_mode: input.remainderMode,
    p_interest_value: input.interestValue ?? null,
    p_interest_percent: input.interestPercent ?? null,
    p_request_id: input.requestId,
  });
  if (error) {
    throw operationError(error, "Não foi possível registrar o pagamento. Nenhuma alteração parcial foi mantida.");
  }
  return data;
}

export async function reverseInvoicePayment(transactionId: number, requestId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("finance_reverse_invoice_payment", {
    p_transaction_id: transactionId,
    p_request_id: requestId,
  });
  if (error) {
    throw operationError(error, "Não foi possível estornar o pagamento. Nenhuma alteração parcial foi mantida.");
  }
  return data;
}

export async function listInvoicePaymentTransactions(
  userId: string,
  cardId: number,
  invoiceMonth: string,
): Promise<InvoicePaymentTransaction[]> {
  const markerPrefix = `[PagFatura:${cardId}:${invoiceMonth}:`;
  const { data, error } = await supabase
    .from("transacoes")
    .select("id, descricao")
    .eq("user_id", userId)
    .like("descricao", `%${markerPrefix}%`)
    .order("id", { ascending: false });

  if (error) {
    throw operationError(error, "Não foi possível localizar os pagamentos desta fatura.");
  }

  return (data ?? [])
    .map((row) => {
      const parsed = parseInvoicePaymentMarker(row.descricao);
      if (!parsed || parsed.cardId !== cardId || parsed.invoiceMonth !== invoiceMonth) return null;
      return {
        id: Number(row.id),
        description: row.descricao ?? "",
        mode: parsed.mode,
        linkedItemId: parsed.linkedItemId,
      } satisfies InvoicePaymentTransaction;
    })
    .filter((row): row is InvoicePaymentTransaction => row !== null)
    .sort((left, right) => right.id - left.id);
}
