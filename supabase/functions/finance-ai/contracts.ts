export const DIRECT_ACTIONS = [
  "create_account",
  "update_account",
  "archive_account",
  "delete_account",
  "reactivate_account",
  "create_category",
  "update_category",
  "archive_category",
  "delete_category",
  "reactivate_category",
  "create_goal",
  "update_goal",
  "archive_goal",
  "delete_goal",
  "reactivate_goal",
  "move_goal",
  "create_transaction",
  "update_transaction",
  "delete_transaction",
  "complete_transaction",
  "reopen_transaction",
  "transfer_between_accounts",
  "create_card",
  "update_card",
  "archive_card",
  "delete_card",
  "reactivate_card",
  "create_card_purchase",
  "update_card_purchase",
  "delete_card_purchase",
  "pay_invoice",
  "reverse_invoice_payment",
] as const;

export const READ_INTENTS = [
  "financial_summary",
  "list_transactions",
  "cash_flow",
  "category_analysis",
  "budget_analysis",
  "financial_projection",
  "card_summary",
  "goal_progress",
  "explain_financial_control",
] as const;

export const NAVIGATION_INTENTS = [
  "open_home",
  "open_history",
  "open_goals",
  "open_cash_flow",
  "open_cards",
  "open_categories",
] as const;

export const ALL_INTENTS = [
  ...DIRECT_ACTIONS,
  ...READ_INTENTS,
  ...NAVIGATION_INTENTS,
  "out_of_scope",
] as const;

export type DirectAction = typeof DIRECT_ACTIONS[number];
export type ReadIntent = typeof READ_INTENTS[number];
export type NavigationIntent = typeof NAVIGATION_INTENTS[number];
export type AiIntent = typeof ALL_INTENTS[number];
export type ModelKind = "out_of_scope" | "answer" | "clarify" | "propose_action" | "navigate";

export const DATA_KEYS = [
  "account_id",
  "destination_account_id",
  "category_id",
  "goal_id",
  "card_id",
  "transaction_id",
  "purchase_id",
  "invoice_month",
  "name",
  "description",
  "type",
  "status",
  "value",
  "expected_value",
  "realized_value",
  "initial_balance",
  "target_amount",
  "target_date",
  "scheduled_date",
  "realization_date",
  "purchase_date",
  "color",
  "icon",
  "frequency",
  "recurrence_count",
  "installments",
  "installment_value",
  "series_scope",
  "operation",
  "due_day",
  "closing_day",
  "payment_amount",
  "remainder_mode",
  "interest_value",
  "interest_percent",
  "field",
  "new_value",
  "query",
  "date_from",
  "date_to",
  "account_ids",
  "category_ids",
  "transaction_type",
  "overdue_only",
  "next_days",
  "page",
  "page_size",
  "year",
  "selected_month",
  "basis",
  "include_budget_rule",
  "view",
] as const;

export type DataKey = typeof DATA_KEYS[number];

export type ModelField = { key: DataKey; value: string };

export type ModelOutput = {
  kind: ModelKind;
  intent: AiIntent;
  message: string;
  missing_fields: string[];
  data: ModelField[];
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const directActionSet = new Set<string>(DIRECT_ACTIONS);
const readIntentSet = new Set<string>(READ_INTENTS);
const navigationIntentSet = new Set<string>(NAVIGATION_INTENTS);
const allIntentSet = new Set<string>(ALL_INTENTS);
const dataKeySet = new Set<string>(DATA_KEYS);
const kindSet = new Set<string>(["out_of_scope", "answer", "clarify", "propose_action", "navigate"]);

export function isDirectAction(value: unknown): value is DirectAction {
  return typeof value === "string" && directActionSet.has(value);
}

export function isReadIntent(value: unknown): value is ReadIntent {
  return typeof value === "string" && readIntentSet.has(value);
}

export function isNavigationIntent(value: unknown): value is NavigationIntent {
  return typeof value === "string" && navigationIntentSet.has(value);
}

export function parseModelOutput(value: unknown): ModelOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MODEL_OUTPUT");
  const row = value as Record<string, unknown>;
  const rootKeys = Object.keys(row);
  if (rootKeys.length !== 5 || rootKeys.some((key) => !["kind", "intent", "message", "missing_fields", "data"].includes(key))) {
    throw new Error("INVALID_MODEL_OUTPUT");
  }
  if (!kindSet.has(String(row.kind)) || !allIntentSet.has(String(row.intent))) throw new Error("INVALID_MODEL_OUTPUT");
  if (typeof row.message !== "string" || !row.message.trim() || row.message.length > 2_000) throw new Error("INVALID_MODEL_OUTPUT");
  if (!Array.isArray(row.missing_fields) || row.missing_fields.length > 20 || row.missing_fields.some((item) => typeof item !== "string" || !dataKeySet.has(item))) {
    throw new Error("INVALID_MODEL_OUTPUT");
  }
  if (new Set(row.missing_fields).size !== row.missing_fields.length) throw new Error("INVALID_MODEL_OUTPUT");
  if (!Array.isArray(row.data) || row.data.length > 50) throw new Error("INVALID_MODEL_OUTPUT");

  const seen = new Set<string>();
  const data: ModelField[] = row.data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("INVALID_MODEL_OUTPUT");
    const field = item as Record<string, unknown>;
    if (Object.keys(field).length !== 2 || !("key" in field) || !("value" in field)) throw new Error("INVALID_MODEL_OUTPUT");
    if (!dataKeySet.has(String(field.key)) || typeof field.value !== "string" || field.value.length > 1_000) {
      throw new Error("INVALID_MODEL_OUTPUT");
    }
    if (seen.has(String(field.key))) throw new Error("INVALID_MODEL_OUTPUT");
    seen.add(String(field.key));
    return { key: field.key as DataKey, value: field.value.trim() };
  });

  const output: ModelOutput = {
    kind: row.kind as ModelKind,
    intent: row.intent as AiIntent,
    message: row.message.trim(),
    missing_fields: row.missing_fields as string[],
    data,
  };

  if (output.kind === "propose_action" && !isDirectAction(output.intent)) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "answer" && !isReadIntent(output.intent)) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "navigate" && !isNavigationIntent(output.intent)) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "out_of_scope" && output.intent !== "out_of_scope") throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "out_of_scope" && output.data.length > 0) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "clarify" && output.intent === "out_of_scope") throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "propose_action" && output.data.length === 0) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind === "clarify" && output.missing_fields.length === 0) throw new Error("INVALID_MODEL_OUTPUT");
  if (output.kind !== "clarify" && output.missing_fields.length > 0) throw new Error("INVALID_MODEL_OUTPUT");
  return output;
}

export function fieldsToPayload(fields: ModelField[]): Record<string, string> {
  return Object.fromEntries(fields.map(({ key, value }) => [key, value]));
}

export function hasRemainingActionQuota(value: unknown): boolean {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -1) {
    throw new Error("AI_CONFIGURATION_FAILED");
  }
  return value === -1 || value > 0;
}

export const MODEL_OUTPUT_FORMAT = {
  type: "json_schema",
  name: "finflow_financial_assistant",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["out_of_scope", "answer", "clarify", "propose_action", "navigate"] },
      intent: { type: "string", enum: ALL_INTENTS },
      // O schema enviado aos provedores usa apenas o subconjunto comum do modo
      // estrito. Os limites de tamanho continuam obrigatórios no parser local.
      message: { type: "string" },
      missing_fields: { type: "array", items: { type: "string" } },
      data: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string", enum: DATA_KEYS },
            value: { type: "string" },
          },
          required: ["key", "value"],
        },
      },
    },
    required: ["kind", "intent", "message", "missing_fields", "data"],
  },
} as const;

export function publicErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Sua sessão expirou. Entre novamente para usar a IA financeira.",
    METHOD_NOT_ALLOWED: "Esta operação não é aceita pela IA financeira.",
    AI_CONFIGURATION_FAILED: "A IA financeira está temporariamente indisponível por uma falha de configuração.",
    AI_HISTORY_FAILED: "Não consegui acessar o histórico da conversa agora.",
    AI_PROVIDER_NOT_CONFIGURED: "O provedor da IA financeira ainda não foi configurado.",
    AI_ACTION_EXECUTION_FAILED: "A ação não pôde ser concluída. Nenhuma alteração financeira foi aplicada.",
    AI_ACTION_NOT_CANCELLABLE: "Essa ação já foi finalizada e não pode mais ser cancelada.",
    AI_ACTION_NOT_EXECUTABLE: "Essa ação não está mais disponível para execução.",
    AI_ACTION_STATE_CHANGED: "Este item mudou desde a prévia, possivelmente em outro dispositivo ou pela conta parceira. Nenhuma alteração foi aplicada; peça uma nova prévia antes de confirmar.",
    AI_INVOICE_PAYMENT_ITEM_REQUIRES_REVERSAL: "Este item pertence a um pagamento de fatura. Estorne o pagamento em vez de editar ou excluir o item.",
    AI_INVOICE_SYNTHETIC_ITEM_IMMUTABLE: "Este item é controlado pelo pagamento da fatura e só pode ser alterado por um estorno.",
    AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED: "Este pagamento foi criado por uma versão antiga e não possui rastreabilidade suficiente para um estorno automático seguro.",
    AI_INVOICE_HAS_LATER_PAYMENT: "Há um pagamento posterior que depende desta fatura. Estorne primeiro o pagamento mais recente.",
    AI_INVOICE_HAS_UNTRACKED_PAYMENT: "Há outro pagamento sem rastreabilidade completa nesta fatura. Faça a revisão pela tela do cartão.",
    AI_INVOICE_PAYMENT_ALREADY_REVERSED: "Este pagamento de fatura já foi estornado.",
    AI_SHARED_TRANSACTION_OWNERSHIP_IMMUTABLE: "Não é possível transferir a propriedade de um lançamento compartilhado.",
    AI_DAILY_MESSAGE_LIMIT: "Você atingiu o limite diário de consultas à IA do seu plano. O acesso renova à meia-noite, no horário de Brasília.",
    AI_DAILY_SAFETY_LIMIT: "A IA foi pausada para sua conta hoje após muitas tentativas sem conclusão. Tente novamente amanhã.",
    AI_PROPOSAL_RATE_LIMITED: "Muitas ações foram preparadas em pouco tempo. Aguarde alguns minutos e tente novamente.",
    AI_TOO_MANY_PENDING_ACTIONS: "Você possui muitas ações aguardando confirmação. Confirme ou cancele alguma delas antes de continuar.",
    AI_IDEMPOTENCY_CONFLICT: "O pedido foi alterado durante o processamento. Envie-o novamente para gerar uma nova prévia.",
    AI_DAILY_QUOTA_EXCEEDED: "Você atingiu o limite diário de ações da IA. A cota renova à meia-noite, no horário de Brasília.",
    AI_CONTEXT_TOO_LARGE: "Seus dados financeiros são extensos demais para esta consulta. Informe uma conta, período ou item específico.",
    AI_ACTION_EXPIRED: "Essa confirmação expirou. Peça novamente para eu preparar a ação.",
    AI_ACTION_NOT_FOUND: "Essa ação não está mais disponível para confirmação.",
    AI_ACTION_CANCELLED: "Essa ação já foi cancelada e nenhuma alteração foi feita.",
    AI_ACCOUNT_NOT_FOUND: "Não encontrei essa conta ou ela não está disponível para esta ação.",
    AI_ACCOUNT_ARCHIVED: "A conta está arquivada. Reative-a antes de movimentá-la.",
    AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE: "A categoria não existe, está arquivada ou não corresponde ao tipo do lançamento.",
    AI_GOAL_NOT_FOUND: "Não encontrei esse objetivo ou ele não está disponível para esta ação.",
    AI_INSUFFICIENT_GOAL_BALANCE: "O objetivo não possui saldo suficiente para esse resgate.",
    AI_GOAL_HAS_BALANCE: "Resgate todo o saldo do objetivo antes de excluí-lo.",
    AI_GOAL_HAS_PENDING_ENTRIES: "Exclua ou conclua os agendamentos do objetivo antes de apagá-lo.",
    AI_CARD_NOT_FOUND: "Não encontrei esse cartão ou ele está arquivado.",
    AI_CARD_LIMIT_EXCEEDED: "Essa compra ultrapassa o limite disponível do cartão.",
    AI_INVOICE_CLOSED: "Essa fatura já está fechada e não aceita novas compras ou alterações.",
    AI_PAYMENT_ABOVE_INVOICE: "O valor informado é maior que o saldo aberto da fatura.",
    AI_INVOICE_ALREADY_SETTLED: "Essa fatura já está paga ou zerada.",
    AI_TRANSACTION_VALUE_CHANGED: "O valor do lançamento mudou desde a prévia. Peça uma nova confirmação.",
    AI_TRANSACTION_ALREADY_COMPLETED: "Esse lançamento já está concluído.",
    AI_TRANSACTION_NOT_COMPLETED: "Esse lançamento ainda está pendente.",
    AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL: "Um item concluído de uma série só pode ser alterado individualmente.",
    AI_NO_OPEN_SERIES_ITEMS: "Não há itens pendentes dessa série para alterar.",
    AI_TRANSACTION_NOT_IN_SERIES: "Este lançamento não possui um vínculo de série seguro. Altere ou exclua somente este item.",
    AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL: "Esta recorrência foi criada por uma versão antiga e não possui um identificador seguro de série. Por segurança, altere ou exclua somente este item.",
    AI_LEGACY_SERIES_AMBIGUOUS: "Não consegui distinguir essa série antiga com segurança. Altere ou exclua apenas este item pela tela de Histórico.",
    AI_LEGACY_GOAL_NOT_FOUND: "Este lançamento antigo aponta para um objetivo que não existe mais. Faça a alteração individual pela tela de Histórico.",
    AI_LEGACY_GOAL_AMBIGUOUS: "Há mais de um objetivo com o nome usado neste lançamento antigo. Faça a alteração individual pela tela de Histórico.",
    AI_LEGACY_GOAL_TYPE_MISMATCH: "Este lançamento antigo possui dados incompatíveis com o objetivo. Revise-o individualmente pela tela de Histórico.",
    AI_PLAN_RESOURCE_LIMIT: "Essa ação ultrapassa o limite de recursos do seu plano.",
    AI_NOT_AVAILABLE: "A IA ainda não está disponível para esta conta.",
    AI_PLAN_REQUIRED: "A IA operacional está disponível nos planos Smart e Premium.",
    AI_ANALYTICS_PLAN_REQUIRED: "Análises e projeções com IA estão disponíveis no plano Premium.",
    AI_DAILY_LIMIT_REACHED: "Você atingiu o limite diário de ações da IA. A cota renova à meia-noite, no horário de Brasília.",
    AI_RATE_LIMITED: "Muitas mensagens foram enviadas em pouco tempo. Aguarde alguns segundos e tente novamente.",
    AI_PROVIDER_RATE_LIMITED: "O provedor da IA está temporariamente no limite. Aguarde um pouco e tente novamente.",
    AI_PROVIDER_FAILED: "Não consegui consultar a IA agora. Nenhuma ação financeira foi realizada.",
    AI_TEMPORARILY_PAUSED: "A IA financeira foi pausada temporariamente para proteger a disponibilidade e os custos do serviço. Tente novamente mais tarde.",
    AI_SENSITIVE_DATA_REJECTED: "Por segurança, não envie senhas, PINs, códigos bancários, chaves, tokens, CPF ou número completo de cartão. Remova esses dados e tente novamente.",
    PENDING_ACTION_EXPIRED: "Essa confirmação expirou. Peça novamente para eu preparar a ação.",
    PENDING_ACTION_NOT_FOUND: "Essa ação não está mais disponível para confirmação.",
    INVALID_REQUEST: "Não consegui entender esse pedido com segurança.",
  };
  if (messages[code]) return messages[code];
  if (code.startsWith("AI_SCHEMA_") || code === "AI_ENTITLEMENT_UNAVAILABLE") {
    return "A IA financeira está temporariamente indisponível por uma falha de configuração.";
  }
  if (code.includes("NOT_FOUND")) return "Não encontrei o item financeiro solicitado ou você não possui acesso a ele.";
  if (code.includes("ARCHIVED")) return "O item está arquivado e precisa ser reativado antes desta ação.";
  if (code.includes("INVOICE") || code.includes("CARD_PURCHASE")) {
    return "A operação não pode ser aplicada com segurança a esta compra ou fatura. Revise o estado atual na tela do cartão.";
  }
  if (code.includes("SERIES") || code.includes("RECURRENCE")) {
    return "Os dados da recorrência ou o alcance da série não permitem esta alteração.";
  }
  if (code.includes("LIMIT") || code.includes("QUOTA")) {
    return "Esta ação atingiu um limite do plano ou de uso da IA.";
  }
  if (code.startsWith("AI_INVALID_") || code.startsWith("AI_MISSING_") || code.includes("REQUIRED") || code.includes("NOT_ALLOWED") || code.includes("MISMATCH")) {
    return "Os dados informados não atendem às regras desta operação. Revise valores, datas e itens selecionados.";
  }
  return "Não foi possível concluir a solicitação. Nenhuma alteração financeira foi feita.";
}
