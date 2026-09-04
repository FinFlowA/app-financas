"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
} from "@/lib/finance-action";
import { hojeEmSaoPaulo } from "@/lib/date";
import { traduzirErro } from "@/lib/error-messages";
import { parseMoney } from "@/lib/money";
import { descricaoVisivel, isPagamentoFatura, isTransferencia } from "@/lib/transacoes";
import { createClient } from "@/lib/supabase/server";

export type TransactionActionState<T = unknown> = {
  erro: string | null;
  sucesso?: string;
  dados?: T;
};

type TransactionSnapshot = {
  id: number;
  user_id: string;
  conta_id: number;
  categoria_id: number | null;
  tipo: "receita" | "despesa";
  valor: number;
  descricao: string;
  data_vencimento: string;
  data_realizacao: string | null;
  status: "pendente" | "paga";
  version: number;
  transacao_pai_id: number | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = ["unica", "parcelada", "semanal", "mensal", "anual"] as const;
const SERIES_SCOPES = ["one", "current_and_future", "open_series"] as const;

function refreshTransactions() {
  revalidatePath("/");
  revalidatePath("/transacoes");
  revalidatePath("/contas");
  revalidatePath("/relatorios");
}

function validDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function money(value: FormDataEntryValue | null): number {
  return parseMoney(value);
}

function requestId(formData: FormData): string {
  const supplied = formString(formData, "request_id");
  return UUID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

/** UUID estável por campo: uma repetição da mesma submissão não reaplica partes da série. */
function childRequestId(parentId: string, discriminator: string): string {
  const hex = createHash("sha256").update(`${parentId}:${discriminator}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function extractBackendCode(message: string): string {
  return message.match(/(?:AI|OFFLINE|TRANSACTION)_[A-Z0-9_]+/)?.[0] ?? message;
}

function transactionError(message: string): string {
  const code = extractBackendCode(message);
  const messages: Record<string, string> = {
    TRANSACTION_ALREADY_COMPLETED: "Este lançamento já foi concluído em outro dispositivo.",
    TRANSACTION_NOT_COMPLETED: "Este lançamento já está pendente.",
    TRANSACTION_VALUE_CHANGED: "O valor mudou desde que o painel foi aberto. Atualize e revise a baixa.",
    TRANSACTION_REALIZED_VALUE_TOO_HIGH: "O valor realizado não pode superar o total devido.",
    TRANSACTION_ADJUSTMENT_INVALID: "Revise o valor de juros ou desconto.",
    TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE: "Juros e desconto só podem ser informados depois da data agendada.",
    TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT: "Esta confirmação mudou durante o envio. Feche o painel e tente novamente.",
    TRANSACTION_COMPLETION_STATE_CONFLICT: "O lançamento mudou em outro dispositivo. Atualize a página antes de continuar.",
    TRANSACTION_PAYMENT_CHILD_NOT_ACTIONABLE: "Abra o lançamento principal para registrar ou estornar pagamentos.",
    AI_TRANSACTION_PAYMENT_LEDGER_REQUIRES_REOPEN: "Estorne os pagamentos, do mais recente para o mais antigo, antes de excluir.",
    AI_TRANSACTION_PARTIAL_REMAINDER_IS_INDIVIDUAL: "Um saldo com pagamentos parciais só pode ser editado individualmente.",
    AI_TRANSACTION_ALREADY_COMPLETED: "Este lançamento já foi concluído em outro dispositivo.",
    AI_TRANSACTION_NOT_COMPLETED: "Este lançamento já está pendente.",
    AI_TRANSACTION_VALUE_CHANGED: "O valor mudou desde que o painel foi aberto. Atualize e revise a baixa.",
    AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL: "Itens concluídos de uma série só podem ser alterados individualmente.",
    AI_NO_OPEN_SERIES_ITEMS: "Não há mais itens pendentes nessa série.",
    AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL: "Esta recorrência antiga não possui um identificador seguro. Altere apenas este item.",
    AI_LEGACY_SERIES_AMBIGUOUS: "Não foi possível identificar a série antiga com segurança. Altere apenas este item.",
    OFFLINE_VERSION_CONFLICT: "Este lançamento mudou em outro dispositivo. Atualize a página e tente novamente.",
  };
  return messages[code] ?? traduzirErro(code);
}

function baseDescription(description: string): string {
  return descricaoVisivel(description)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
}

async function transactionSnapshot(transactionId: number): Promise<{
  erro: string | null;
  transacao?: TransactionSnapshot;
  currentUserId?: string;
}> {
  const supabase = await createClient();
  const [{ data: authData, error: authError }, { data, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, version, transacao_pai_id")
      .eq("id", transactionId)
      .maybeSingle(),
  ]);
  if (authError || !authData.user) return { erro: "Sua sessão expirou. Entre novamente." };
  if (error || !data) return { erro: "O lançamento não foi encontrado ou você não possui acesso a ele." };
  return { erro: null, transacao: data as TransactionSnapshot, currentUserId: authData.user.id };
}

export async function createTransaction(formData: FormData): Promise<TransactionActionState> {
  const kind = formString(formData, "kind");
  const frequency = formString(formData, "frequency") as typeof FREQUENCIES[number];
  const informedValue = money(formData.get("value"));
  const description = formString(formData, "description");
  const scheduledDate = formString(formData, "scheduled_date");
  const accountId = formInteger(formData, "account_id");
  const destinationAccountId = formInteger(formData, "destination_account_id");
  const destinationGoalId = formInteger(formData, "destination_goal_id");
  const categoryId = formInteger(formData, "category_id");
  const installments = formInteger(formData, "installments");
  const valueMode = formString(formData, "value_mode");
  const requestedStatus = formString(formData, "status");

  if (!["receita", "despesa", "transferencia"].includes(kind)) return { erro: "Escolha receita, despesa ou transferência." };
  if (!FREQUENCIES.includes(frequency)) return { erro: "Escolha uma frequência válida." };
  if (!Number.isFinite(informedValue) || informedValue <= 0 || informedValue > 999_999_999_999.99) return { erro: "Informe um valor maior que zero." };
  if (!description || description.length > 100) return { erro: "Informe uma descrição de até 100 caracteres." };
  if (!validDate(scheduledDate)) return { erro: "Informe uma data válida." };
  if (!validId(accountId)) return { erro: "Escolha a conta de origem." };
  if (frequency === "parcelada" && (!Number.isInteger(installments) || installments < 2 || installments > 120)) {
    return { erro: "Use entre 2 e 120 parcelas." };
  }
  if (frequency === "parcelada" && !["total", "parcela"].includes(valueMode)) return { erro: "Escolha se o valor é total ou por parcela." };

  const status = frequency === "unica" && requestedStatus === "paga" ? "paga" : "pendente";
  if (status === "paga" && scheduledDate > hojeEmSaoPaulo()) return { erro: "Um lançamento futuro deve ficar pendente." };
  const totalValue = frequency === "parcelada" && valueMode === "parcela"
    ? Math.round(informedValue * installments * 100) / 100
    : informedValue;
  if (totalValue > 999_999_999_999.99) return { erro: "O valor total parcelado é muito alto." };

  const payload: Record<string, unknown> = {
    value: totalValue,
    description,
    status,
    scheduled_date: scheduledDate,
    account_id: accountId,
    frequency,
  };
  if (status === "paga") payload.realization_date = scheduledDate;
  if (frequency === "parcelada") {
    payload.installments = installments;
    if (valueMode === "parcela") payload.installment_value = informedValue;
  }

  const actionId = requestId(formData);
  if (kind === "transferencia") {
    if (validId(destinationGoalId)) {
      if (frequency === "parcelada") return { erro: "Transferências para objetivos podem ser únicas ou recorrentes." };
      if (frequency === "unica" && status !== "paga") return { erro: "Uma transferência única para objetivo deve ser concluída na data." };
      const goalPayload: Record<string, unknown> = { operation: "guardar", goal_id: destinationGoalId, account_id: accountId, value: totalValue, description, frequency };
      if (frequency === "unica") goalPayload.realization_date = scheduledDate;
      else {
        goalPayload.scheduled_date = scheduledDate;
        goalPayload.recurrence_count = frequency === "semanal" ? 260 : frequency === "mensal" ? 60 : 5;
      }
      const result = await executeManualFinancialAction("move_goal", goalPayload, actionId);
      if (result.erro) return { erro: result.erro };
    } else {
      if (!validId(destinationAccountId) || destinationAccountId === accountId) return { erro: "Escolha uma conta ou objetivo de destino." };
      payload.destination_account_id = destinationAccountId;
      const result = await executeManualFinancialAction("transfer_between_accounts", payload, actionId);
      if (result.erro) return { erro: result.erro };
    }
  } else {
    if (!validId(categoryId)) return { erro: "Escolha uma categoria compatível." };
    payload.type = kind;
    payload.category_id = categoryId;
    const result = await executeManualFinancialAction("create_transaction", payload, actionId);
    if (result.erro) return { erro: result.erro };
  }

  refreshTransactions();
  const suffix = frequency === "unica" ? "" : frequency === "parcelada" ? ` em ${installments} parcelas` : ` como fixa ${frequency}`;
  return { erro: null, sucesso: `Lançamento criado${suffix}.` };
}

export async function updateTransaction(formData: FormData): Promise<TransactionActionState> {
  const transactionId = formInteger(formData, "transaction_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const scope = formString(formData, "series_scope") as "one" | "open_series";
  const description = formString(formData, "description");
  const value = money(formData.get("value"));
  const scheduledDate = formString(formData, "scheduled_date");
  const accountId = formInteger(formData, "account_id");
  const categoryId = formInteger(formData, "category_id");

  if (!validId(transactionId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { erro: "Lançamento inválido." };
  if (scope !== "one" && scope !== "open_series") return { erro: "Escolha um alcance válido para a edição." };
  if (!description || description.length > 100) return { erro: "Informe uma descrição de até 100 caracteres." };
  if (!Number.isFinite(value) || value <= 0 || value > 999_999_999_999.99) return { erro: "Informe um valor maior que zero." };
  if (!validDate(scheduledDate) || !validId(accountId)) return { erro: "Revise a conta e a data." };

  const snapshot = await transactionSnapshot(transactionId);
  if (snapshot.erro || !snapshot.transacao || !snapshot.currentUserId) return { erro: snapshot.erro ?? "Lançamento inválido." };
  const current = snapshot.transacao;
  if (current.transacao_pai_id !== null) return { erro: "Abra o lançamento principal para editar." };
  if (isPagamentoFatura(current.descricao)) return { erro: "Pagamentos de fatura devem ser estornados pela tela do cartão." };
  if (current.status === "paga") return { erro: "Reabra o lançamento antes de editar. Um item concluído não pode ser alterado." };
  if (scope !== "one" && current.version !== expectedVersion) return { erro: "Este lançamento mudou em outro dispositivo. Atualize a página e tente novamente." };

  const transfer = isTransferencia(current.descricao);
  if (!transfer && !validId(categoryId)) return { erro: "Escolha uma categoria compatível." };

  const changes: Record<string, string | number> = {};
  if (description !== baseDescription(current.descricao)) changes.description = description;
  if (Math.round(value * 100) !== Math.round(Number(current.valor) * 100)) changes.value = value;
  if (scheduledDate !== current.data_vencimento) changes.scheduled_date = scheduledDate;
  if (accountId !== current.conta_id) changes.account_id = accountId;
  if (!transfer && categoryId !== current.categoria_id) changes.category_id = categoryId;
  if (Object.keys(changes).length === 0) return { erro: null, sucesso: "Nenhuma alteração necessária." };

  const parentRequestId = requestId(formData);
  if (scope === "one" && current.user_id === snapshot.currentUserId) {
    const result = await executeOptimisticUpdate("update_transaction", {
      transaction_id: transactionId,
      expected_version: expectedVersion,
      changes,
    }, parentRequestId);
    if (result.erro) return { erro: result.erro };
  } else {
    let completed = 0;
    for (const [field, newValue] of Object.entries(changes)) {
      const result = await executeManualFinancialAction("update_transaction", {
        transaction_id: transactionId,
        series_scope: scope,
        field,
        new_value: newValue,
      }, childRequestId(parentRequestId, field));
      if (result.erro) {
        refreshTransactions();
        return {
          erro: completed > 0
            ? `Parte das alterações foi aplicada antes de uma validação impedir o restante. Atualize a página. ${result.erro}`
            : result.erro,
        };
      }
      completed += 1;
    }
  }

  refreshTransactions();
  return { erro: null, sucesso: scope === "open_series" ? "Itens pendentes da série atualizados." : "Lançamento atualizado." };
}

export async function deleteTransaction(formData: FormData): Promise<TransactionActionState> {
  const transactionId = formInteger(formData, "transaction_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const scope = formString(formData, "series_scope") as typeof SERIES_SCOPES[number];
  if (!validId(transactionId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { erro: "Lançamento inválido." };
  if (!SERIES_SCOPES.includes(scope)) return { erro: "Escolha um alcance válido para a exclusão." };

  const snapshot = await transactionSnapshot(transactionId);
  if (snapshot.erro || !snapshot.transacao) return { erro: snapshot.erro ?? "Lançamento inválido." };
  if (snapshot.transacao.transacao_pai_id !== null) return { erro: "Abra o lançamento principal para excluir." };
  if (snapshot.transacao.version !== expectedVersion) return { erro: "Este lançamento mudou em outro dispositivo. Atualize a página e tente novamente." };
  if (isPagamentoFatura(snapshot.transacao.descricao)) return { erro: "Pagamentos de fatura devem ser estornados pela tela do cartão." };
  if (snapshot.transacao.status === "paga" && scope !== "one") return { erro: "Um item concluído só pode ser excluído individualmente." };

  const result = await executeManualFinancialAction("delete_transaction", {
    transaction_id: transactionId,
    series_scope: scope,
  }, requestId(formData));
  if (result.erro) return { erro: result.erro };
  refreshTransactions();
  return { erro: null, sucesso: scope === "one" ? "Lançamento excluído." : "Lançamentos pendentes excluídos." };
}

export async function completeTransaction(formData: FormData): Promise<TransactionActionState> {
  const transactionId = formInteger(formData, "transaction_id");
  const expectedValue = money(formData.get("expected_value"));
  const realizedValue = money(formData.get("realized_value"));
  const realizationDate = formString(formData, "realization_date");
  const adjustmentType = formString(formData, "adjustment_type");
  const adjustmentValue = adjustmentType === "none" ? 0 : money(formData.get("adjustment_value"));

  if (!validId(transactionId) || !Number.isFinite(expectedValue) || expectedValue <= 0) return { erro: "Lançamento inválido." };
  if (!validDate(realizationDate) || realizationDate > hojeEmSaoPaulo()) return { erro: "A data de realização não pode estar no futuro." };
  if (!["none", "interest", "discount"].includes(adjustmentType)) return { erro: "Escolha um ajuste válido." };

  const snapshot = await transactionSnapshot(transactionId);
  if (snapshot.erro || !snapshot.transacao) return { erro: snapshot.erro ?? "Lançamento inválido." };
  const current = snapshot.transacao;
  if (current.transacao_pai_id !== null) return { erro: "Abra o lançamento principal para concluir." };
  if (current.status !== "pendente") return { erro: "Este lançamento já foi concluído." };
  if (Math.round(Number(current.valor) * 100) !== Math.round(expectedValue * 100)) {
    return { erro: "O valor mudou desde que o painel foi aberto. Atualize e revise a baixa." };
  }

  const commonTransaction = current.categoria_id !== null
    && !isTransferencia(current.descricao)
    && !/\[(?:Destino:|Objetivo:|PagFatura:)/.test(current.descricao);
  const actionId = requestId(formData);
  let partialCompletion = false;

  if (commonTransaction) {
    if (!Number.isFinite(realizedValue) || realizedValue <= 0) return { erro: "Informe quanto foi efetivamente pago ou recebido." };
    if (adjustmentType !== "none" && (!Number.isFinite(adjustmentValue) || adjustmentValue <= 0)) return { erro: "Informe o valor do ajuste." };
    const totalDue = adjustmentType === "interest"
      ? expectedValue + adjustmentValue
      : adjustmentType === "discount" ? expectedValue - adjustmentValue : expectedValue;
    if (totalDue <= 0 || realizedValue > totalDue) return { erro: "O valor realizado não pode superar o total devido." };
    partialCompletion = Math.round(realizedValue * 100) < Math.round(totalDue * 100);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("complete_transaction_with_partial", {
      p_transaction_id: transactionId,
      p_expected_value: expectedValue,
      p_adjustment_type: adjustmentType,
      p_adjustment_value: adjustmentValue,
      p_realized_value: realizedValue,
      p_realization_date: realizationDate,
      p_idempotency_key: actionId,
    });
    if (error) return { erro: transactionError(error.message) };
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).ok !== true) {
      return { erro: "O servidor não confirmou a baixa. Nenhuma alteração foi considerada concluída." };
    }
  } else {
    const result = await executeManualFinancialAction("complete_transaction", {
      transaction_id: transactionId,
      realization_date: realizationDate,
      expected_value: expectedValue,
      realized_value: expectedValue,
    }, actionId);
    if (result.erro) return { erro: result.erro };
  }

  refreshTransactions();
  return { erro: null, sucesso: partialCompletion ? "Pagamento parcial registrado; o saldo continua pendente." : "Lançamento concluído." };
}

export async function reopenTransaction(formData: FormData): Promise<TransactionActionState> {
  const transactionId = formInteger(formData, "transaction_id");
  if (!validId(transactionId)) return { erro: "Lançamento inválido." };
  const snapshot = await transactionSnapshot(transactionId);
  if (snapshot.erro || !snapshot.transacao) return { erro: snapshot.erro ?? "Lançamento inválido." };
  if (snapshot.transacao.transacao_pai_id !== null) return { erro: "Abra o lançamento principal para reabrir." };
  if (isPagamentoFatura(snapshot.transacao.descricao)) return { erro: "Estorne este pagamento pela tela do cartão." };

  const result = await executeManualFinancialAction("reopen_transaction", {
    transaction_id: transactionId,
  }, requestId(formData));
  if (result.erro) return { erro: result.erro };
  refreshTransactions();
  return { erro: null, sucesso: "O lançamento foi reaberto e voltou a ficar pendente." };
}

export async function getTransactionPaymentHistory(transactionId: number): Promise<TransactionActionState<unknown>> {
  if (!validId(transactionId)) return { erro: "Lançamento inválido." };
  const supabase = await createClient();
  const [{ data, error }, adjustmentResult] = await Promise.all([
    supabase.rpc("get_transaction_payment_history", { p_transaction_id: transactionId }),
    supabase.rpc("get_bank_reconciliation_adjustment", { p_transaction_id: transactionId }),
  ]);
  if (error) {
    if (error.code === "PGRST202") return { erro: null, dados: null };
    return { erro: transactionError(error.message) };
  }
  if (adjustmentResult.error && adjustmentResult.error.code !== "PGRST202") {
    return { erro: transactionError(adjustmentResult.error.message) };
  }
  const adjustment = adjustmentResult.error?.code === "PGRST202" ? null : adjustmentResult.data?.[0] ?? null;
  const body = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return { erro: null, dados: { ...body, reconciliation_adjustment: adjustment } };
}
