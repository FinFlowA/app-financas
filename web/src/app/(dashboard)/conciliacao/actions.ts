"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MENSAGEM_ERRO_GENERICA, traduzirErro } from "@/lib/error-messages";

export type NewReconciliationEntry = { categoryId: number | null; description: string; value: number };

export type ReconcileEntryInput = {
  accountId: number;
  fingerprint: string;
  date: string;
  type: "receita" | "despesa";
  amount: number;
  mode: "existing" | "new";
  transactionId?: number | null;
  transactionIds?: number[];
  newEntries?: NewReconciliationEntry[];
  requestId: string;
  excessAsInterest?: boolean;
  existingKind?: "standard" | "transfer" | "goal" | "invoice";
  existingStatus?: "pendente" | "paga";
  invoiceCardId?: number;
  invoiceMonth?: string;
  reconciliationReceiptId?: number;
};

export type ReconcileEntryResult = { erro: string | null; sucesso?: string };

export type IgnoreEntryInput = Pick<ReconcileEntryInput, "accountId" | "fingerprint" | "date" | "type" | "amount" | "requestId">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function reconciliationError(message: string, sqlState?: string): string {
  const code = message.match(/(?:RECONCILIATION|TRANSACTION)_[A-Z0-9_]+/)?.[0];
  const messages: Record<string, string> = {
    RECONCILIATION_AUTH_REQUIRED: "Sua sessão expirou. Entre novamente.",
    RECONCILIATION_AUTH_MISMATCH: "A sessão mudou. Atualize a página antes de continuar.",
    RECONCILIATION_INVALID_REQUEST: "Esta solicitação expirou. Tente novamente.",
    RECONCILIATION_INVALID_ENTRY: "Revise a data, o tipo e o valor desta movimentação.",
    RECONCILIATION_ACCOUNT_DENIED: "A conta não está disponível para conciliação.",
    RECONCILIATION_TRANSACTION_REQUIRED: "Selecione um lançamento pendente.",
    RECONCILIATION_TRANSACTION_UNAVAILABLE: "O lançamento selecionado mudou ou já foi concluído.",
    RECONCILIATION_MULTIPLE_TOTAL_MISMATCH: "A soma dos lançamentos selecionados precisa ser exatamente igual ao valor do extrato.",
    RECONCILIATION_MULTIPLE_NOT_SUPPORTED: "Selecione lançamentos comuns ou movimentos de caixinha compatíveis com esta conta.",
    RECONCILIATION_AMOUNT_EXCEEDS_REMAINDER: "O valor do extrato supera o saldo pendente desse lançamento.",
    RECONCILIATION_EXCESS_CONFIRMATION_REQUIRED: "Confirme se a diferença deve ser registrada como juros.",
    RECONCILIATION_TRANSFER_REQUIRES_EXACT_VALUE: "Transferências entre contas só podem ser conciliadas pelo valor integral agendado.",
    RECONCILIATION_GOAL_REQUIRES_EXACT_VALUE: "Movimentos de caixinha só podem ser conciliados pelo valor integral agendado.",
    RECONCILIATION_INVOICE_UNAVAILABLE: "Esta fatura mudou ou já foi paga. Atualize a página.",
    RECONCILIATION_INVOICE_AMOUNT_MISMATCH: "O valor do extrato não pode superar o saldo atual da fatura.",
    TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE: "Juros só podem ser registrados depois da data agendada.",
    RECONCILIATION_CATEGORY_INVALID: "Selecione uma categoria ativa e compatível.",
    RECONCILIATION_DESCRIPTION_INVALID: "Informe uma descrição de até 100 caracteres.",
    RECONCILIATION_NEW_ENTRIES_INVALID: "Informe entre 2 e 50 lançamentos, cada um com categoria, descrição e valor.",
    RECONCILIATION_NEW_ENTRIES_TOTAL_MISMATCH: "A soma dos novos lançamentos precisa ser exatamente igual ao valor do extrato.",
    RECONCILIATION_COMPLETION_NOT_CONFIRMED: "O banco não confirmou a baixa. Nenhuma conciliação foi gravada.",
    RECONCILIATION_CREATION_NOT_CONFIRMED: "O banco não confirmou o novo lançamento. Nenhuma conciliação foi gravada.",
    RECONCILIATION_PARTIAL_RECEIPT_UNAVAILABLE: "Esta conciliação mudou. Reimporte o extrato antes de continuar.",
    RECONCILIATION_PARTIAL_AMOUNT_CHANGED: "O valor restante desta conciliação mudou. Reimporte o extrato.",
  };
  const traduzida = code ? messages[code] ?? traduzirErro(code) : traduzirErro(message);
  if (traduzida !== MENSAGEM_ERRO_GENERICA) return traduzida;
  // Sem tradução própria: mostra o código para o suporte achar a causa (só
  // códigos em maiúsculas ou o SQLSTATE, nunca o texto livre do erro).
  const referencia = code ?? message.match(/\b[A-Z][A-Z0-9_]*_[A-Z0-9]+\b/)?.[0] ?? sqlState;
  return referencia ? `${traduzida} (código ${referencia})` : traduzida;
}

export async function reconcileStatementEntry(input: ReconcileEntryInput): Promise<ReconcileEntryResult> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 || !HASH.test(input.fingerprint)
    || !DATE.test(input.date) || !["receita", "despesa"].includes(input.type)
    || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 999_999_999_999.99
    || !["existing", "new"].includes(input.mode) || !UUID.test(input.requestId)) {
    return { erro: "Os dados desta movimentação são inválidos." };
  }
  const transactionIds = Array.from(new Set(input.transactionIds ?? (input.transactionId ? [input.transactionId] : [])));
  if (input.mode === "existing" && (transactionIds.length < 1 || transactionIds.length > 50
    || transactionIds.some((id) => !Number.isSafeInteger(id) || (input.existingKind !== "invoice" && id <= 0)))) {
    return { erro: "Selecione o lançamento que será conciliado." };
  }
  const newEntries = (input.newEntries ?? []).map((entry) => ({
    categoryId: entry.categoryId,
    description: entry.description.trim(),
    value: Math.round((entry.value + Number.EPSILON) * 100) / 100,
  }));
  if (input.mode === "new" && (newEntries.length < 1 || newEntries.length > 50
    || newEntries.some((entry) => !Number.isSafeInteger(entry.categoryId) || Number(entry.categoryId) <= 0
      || !entry.description || entry.description.length > 100
      || !Number.isFinite(entry.value) || entry.value <= 0 || entry.value > 999_999_999_999.99))) {
    return { erro: "Informe categoria, descrição e valor de cada novo lançamento." };
  }
  if (input.mode === "new" && newEntries.length > 1) {
    const total = Math.round(newEntries.reduce((sum, entry) => sum + entry.value, 0) * 100) / 100;
    if (total !== Math.round(input.amount * 100) / 100) {
      return { erro: "A soma dos novos lançamentos precisa ser exatamente igual ao valor do extrato." };
    }
  }
  const description = newEntries[0]?.description ?? "";

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };
  if (input.mode === "existing" && input.reconciliationReceiptId) {
    if (transactionIds.length !== 1 || !Number.isSafeInteger(input.reconciliationReceiptId) || input.reconciliationReceiptId <= 0) {
      return { erro: "Selecione um único lançamento para completar esta conciliação." };
    }
    const { data, error } = await supabase.rpc("reconcile_reopened_bank_statement_entry", {
      p_receipt_id: input.reconciliationReceiptId,
      p_entry_fingerprint: input.fingerprint,
      p_entry_date: input.date,
      p_entry_type: input.type,
      p_entry_amount: input.amount,
      p_transaction_id: transactionIds[0],
      p_idempotency_key: input.requestId,
      p_expected_user_id: user.id,
      p_client_created_at: new Date().toISOString(),
    });
    if (error) return { erro: reconciliationError(error.message, error.code) };
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou a reconciliação da parte reaberta." };
    }
    revalidatePath("/"); revalidatePath("/conciliacao"); revalidatePath("/transacoes"); revalidatePath("/contas"); revalidatePath("/relatorios");
    return { erro: null, sucesso: "A parte reaberta foi conciliada novamente." };
  }
  if (input.mode === "existing" && input.existingKind === "invoice") {
    if (transactionIds.length !== 1 || !Number.isSafeInteger(input.invoiceCardId) || Number(input.invoiceCardId) <= 0
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.invoiceMonth ?? "") || input.type !== "despesa") {
      return { erro: "A fatura selecionada é inválida." };
    }
    const { data, error } = await supabase.rpc("reconcile_bank_invoice_entry", {
      p_account_id: input.accountId,
      p_entry_fingerprint: input.fingerprint,
      p_entry_date: input.date,
      p_entry_amount: input.amount,
      p_card_id: input.invoiceCardId,
      p_invoice_month: input.invoiceMonth,
      p_idempotency_key: input.requestId,
      p_expected_user_id: user.id,
      p_client_created_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[bank-invoice-reconciliation] RPC failed", { code: error.code, message: error.message, details: error.details });
      return { erro: error.code === "PGRST202"
        ? "A atualização do banco para conciliar faturas ainda não foi aplicada. Nenhuma alteração financeira foi feita."
        : reconciliationError(error.message, error.code) };
    }
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou o pagamento e a conciliação da fatura." };
    }
    revalidatePath("/"); revalidatePath("/conciliacao"); revalidatePath("/transacoes"); revalidatePath("/contas"); revalidatePath("/relatorios"); revalidatePath("/cartoes");
    return { erro: null, sucesso: "Fatura paga e conciliada com a movimentação bancária." };
  }
  if (input.mode === "existing" && transactionIds.length > 1) {
    const { data, error } = await supabase.rpc("reconcile_bank_statement_entries", {
      p_account_id: input.accountId,
      p_entry_fingerprint: input.fingerprint,
      p_entry_date: input.date,
      p_entry_type: input.type,
      p_entry_amount: input.amount,
      p_transaction_ids: transactionIds,
      p_idempotency_key: input.requestId,
      p_expected_user_id: user.id,
      p_client_created_at: new Date().toISOString(),
    });
    if (error) return { erro: reconciliationError(error.message, error.code) };
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou a conciliação. Nenhuma alteração foi considerada concluída." };
    }
    revalidatePath("/"); revalidatePath("/conciliacao"); revalidatePath("/transacoes"); revalidatePath("/contas"); revalidatePath("/relatorios");
    return { erro: null, sucesso: `${transactionIds.length} lançamentos conciliados com a movimentação.` };
  }
  if (input.mode === "new" && newEntries.length > 1) {
    const { data, error } = await supabase.rpc("reconcile_bank_statement_new_entries", {
      p_account_id: input.accountId,
      p_entry_fingerprint: input.fingerprint,
      p_entry_date: input.date,
      p_entry_type: input.type,
      p_entry_amount: input.amount,
      p_entries: newEntries.map((entry) => ({ category_id: entry.categoryId, description: entry.description, value: entry.value })),
      p_idempotency_key: input.requestId,
      p_expected_user_id: user.id,
      p_client_created_at: new Date().toISOString(),
    });
    if (error) {
      return { erro: error.code === "PGRST202"
        ? "A atualização do banco para dividir um lançamento novo em vários ainda não foi aplicada. Nenhuma alteração financeira foi feita."
        : reconciliationError(error.message, error.code) };
    }
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou a criação dos novos lançamentos. Nenhuma alteração foi considerada concluída." };
    }
    revalidatePath("/"); revalidatePath("/conciliacao"); revalidatePath("/transacoes"); revalidatePath("/contas"); revalidatePath("/relatorios");
    return { erro: null, sucesso: `${newEntries.length} novos lançamentos criados e conciliados com a movimentação.` };
  }
  const transactionId = transactionIds[0] ?? null;
  const rpcName = input.mode === "existing" && input.existingStatus === "paga"
    ? "link_completed_bank_statement_entry"
    : input.mode === "existing" && input.existingKind === "goal"
    ? "reconcile_bank_goal_entry"
    : input.mode === "existing" && input.existingKind === "transfer"
    ? "reconcile_bank_transfer_entry"
    : input.mode === "existing" && input.excessAsInterest
      ? "reconcile_bank_statement_excess_interest"
      : "reconcile_bank_statement_entry";
  const commonRpcInput = {
    p_account_id: input.accountId,
    p_entry_fingerprint: input.fingerprint,
    p_entry_date: input.date,
    p_entry_type: input.type,
    p_entry_amount: input.amount,
    p_idempotency_key: input.requestId,
    p_expected_user_id: user.id,
    p_client_created_at: new Date().toISOString(),
  };
  const rpcInput = rpcName === "reconcile_bank_transfer_entry" || rpcName === "reconcile_bank_goal_entry" || rpcName === "reconcile_bank_statement_excess_interest" || rpcName === "link_completed_bank_statement_entry" ? {
    ...commonRpcInput,
    p_transaction_id: transactionId,
  } : {
    ...commonRpcInput,
    p_mode: input.mode,
    p_transaction_id: input.mode === "existing" ? transactionId : null,
    p_category_id: input.mode === "new" ? newEntries[0]?.categoryId ?? null : null,
    p_description: input.mode === "new" ? description : "",
    p_excess_as_interest: input.excessAsInterest === true,
  };
  const { data, error } = await supabase.rpc(rpcName, rpcInput);
  if (error) return { erro: reconciliationError(error.message, error.code) };
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
    return { erro: "O servidor não confirmou a conciliação. Nenhuma alteração foi considerada concluída." };
  }
  revalidatePath("/");
  revalidatePath("/conciliacao");
  revalidatePath("/transacoes");
  revalidatePath("/contas");
  revalidatePath("/relatorios");
  return { erro: null, sucesso: input.mode === "existing" ? "Movimentação conciliada com o lançamento existente." : "Novo lançamento criado e conciliado." };
}

export async function ignoreStatementEntry(input: IgnoreEntryInput): Promise<ReconcileEntryResult> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0 || !HASH.test(input.fingerprint)
    || !DATE.test(input.date) || !["receita", "despesa"].includes(input.type)
    || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 999_999_999_999.99
    || !UUID.test(input.requestId)) return { erro: "Os dados desta movimentação são inválidos." };
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };
  const { data, error } = await supabase.rpc("ignore_bank_statement_entry", {
    p_account_id: input.accountId,
    p_entry_fingerprint: input.fingerprint,
    p_entry_date: input.date,
    p_entry_type: input.type,
    p_entry_amount: input.amount,
    p_idempotency_key: input.requestId,
    p_expected_user_id: user.id,
  });
  if (error) return { erro: reconciliationError(error.message, error.code) };
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
    return { erro: "O servidor não confirmou a exclusão desta linha do extrato." };
  }
  revalidatePath("/conciliacao");
  return { erro: null, sucesso: "Movimentação ignorada nos próximos extratos." };
}

export async function ignoreStatementEntries(inputs: IgnoreEntryInput[]): Promise<ReconcileEntryResult> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 500) return { erro: "Selecione entre 1 e 500 movimentações." };
  const accountId = inputs[0]?.accountId;
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || inputs.some((input) => input.accountId !== accountId
    || !HASH.test(input.fingerprint) || !DATE.test(input.date) || !["receita", "despesa"].includes(input.type)
    || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 999_999_999_999.99 || !UUID.test(input.requestId))) {
    return { erro: "Há movimentações inválidas na seleção." };
  }
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };
  const { data, error } = await supabase.rpc("ignore_bank_statement_entries", {
    p_account_id: accountId,
    p_entries: inputs.map((input) => ({ fingerprint: input.fingerprint, entry_date: input.date, entry_type: input.type, entry_amount: input.amount, idempotency_key: input.requestId })),
    p_expected_user_id: user.id,
  });
  if (error) return { erro: reconciliationError(error.message, error.code) };
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) return { erro: "O servidor não confirmou a exclusão das movimentações." };
  revalidatePath("/conciliacao");
  return { erro: null, sucesso: "Movimentações excluídas dos próximos extratos." };
}
