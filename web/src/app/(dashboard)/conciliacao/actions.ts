"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { traduzirErro } from "@/lib/error-messages";

export type ReconcileEntryInput = {
  accountId: number;
  fingerprint: string;
  date: string;
  type: "receita" | "despesa";
  amount: number;
  mode: "existing" | "new";
  transactionId?: number | null;
  transactionIds?: number[];
  categoryId?: number | null;
  description: string;
  requestId: string;
  excessAsInterest?: boolean;
  existingKind?: "standard" | "transfer" | "goal";
  existingStatus?: "pendente" | "paga";
};

export type ReconcileEntryResult = { erro: string | null; sucesso?: string };

export type IgnoreEntryInput = Pick<ReconcileEntryInput, "accountId" | "fingerprint" | "date" | "type" | "amount" | "requestId">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function reconciliationError(message: string): string {
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
    TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE: "Juros só podem ser registrados depois da data agendada.",
    RECONCILIATION_CATEGORY_INVALID: "Selecione uma categoria ativa e compatível.",
    RECONCILIATION_DESCRIPTION_INVALID: "Informe uma descrição de até 100 caracteres.",
    RECONCILIATION_COMPLETION_NOT_CONFIRMED: "O banco não confirmou a baixa. Nenhuma conciliação foi gravada.",
    RECONCILIATION_CREATION_NOT_CONFIRMED: "O banco não confirmou o novo lançamento. Nenhuma conciliação foi gravada.",
  };
  return code ? messages[code] ?? traduzirErro(code) : traduzirErro(message);
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
    || transactionIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) {
    return { erro: "Selecione o lançamento que será conciliado." };
  }
  if (input.mode === "new" && (!Number.isSafeInteger(input.categoryId) || Number(input.categoryId) <= 0)) {
    return { erro: "Selecione a categoria do novo lançamento." };
  }
  const description = input.description.trim();
  if (input.mode === "new" && (!description || description.length > 100)) return { erro: "Informe uma descrição de até 100 caracteres." };

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };
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
    if (error) return { erro: reconciliationError(error.message) };
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou a conciliação. Nenhuma alteração foi considerada concluída." };
    }
    revalidatePath("/"); revalidatePath("/conciliacao"); revalidatePath("/transacoes"); revalidatePath("/contas"); revalidatePath("/relatorios");
    return { erro: null, sucesso: `${transactionIds.length} lançamentos conciliados com a movimentação.` };
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
    p_category_id: input.mode === "new" ? input.categoryId : null,
    p_description: input.mode === "new" ? description : "",
    p_excess_as_interest: input.excessAsInterest === true,
  };
  const { data, error } = await supabase.rpc(rpcName, rpcInput);
  if (error) return { erro: reconciliationError(error.message) };
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
  if (error) return { erro: reconciliationError(error.message) };
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
  if (error) return { erro: reconciliationError(error.message) };
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) return { erro: "O servidor não confirmou a exclusão das movimentações." };
  revalidatePath("/conciliacao");
  return { erro: null, sucesso: "Movimentações excluídas dos próximos extratos." };
}
