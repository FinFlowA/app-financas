/**
 * Contrato HTTP público entre o aplicativo e a Edge Function `finance-ai`.
 *
 * O aplicativo nunca recebe o payload financeiro interno preparado pelo
 * modelo. Valores, enums e validações de escrita pertencem exclusivamente à
 * Edge Function e ao PostgreSQL, evitando dois contratos financeiros rivais.
 */

export const FINANCE_AI_MUTATION_INTENTS = [
  "create_account", "update_account", "archive_account", "delete_account", "reactivate_account",
  "create_category", "update_category", "archive_category", "delete_category", "reactivate_category",
  "create_goal", "update_goal", "archive_goal", "delete_goal", "reactivate_goal", "move_goal",
  "create_transaction", "update_transaction", "delete_transaction", "complete_transaction", "reopen_transaction", "transfer_between_accounts",
  "create_card", "update_card", "archive_card", "delete_card", "reactivate_card",
  "create_card_purchase", "update_card_purchase", "delete_card_purchase", "pay_invoice", "reverse_invoice_payment",
] as const;

export const FINANCE_AI_READ_INTENTS = [
  "financial_summary", "list_transactions", "cash_flow", "category_analysis", "budget_analysis",
  "financial_projection", "card_summary", "goal_progress", "explain_financial_control",
] as const;

export const FINANCE_AI_NAVIGATION_INTENTS = [
  "open_home", "open_history", "open_goals", "open_cash_flow", "open_cards", "open_categories",
] as const;

export const FINANCE_AI_INTENTS = [
  ...FINANCE_AI_MUTATION_INTENTS,
  ...FINANCE_AI_READ_INTENTS,
  ...FINANCE_AI_NAVIGATION_INTENTS,
  "out_of_scope",
] as const;

export type FinanceAiMutationIntent = typeof FINANCE_AI_MUTATION_INTENTS[number];
export type FinanceAiReadIntent = typeof FINANCE_AI_READ_INTENTS[number];
export type FinanceAiNavigationIntent = typeof FINANCE_AI_NAVIGATION_INTENTS[number];
export type FinanceAiIntent = typeof FINANCE_AI_INTENTS[number];
export type Uuid = string;
export type IsoTimestamp = string;

export type FinanceAiHttpRequest =
  | { mode: "message"; message: string; conversationId?: Uuid; requestId?: string }
  | { mode: "confirm"; actionId: Uuid; confirmationToken: Uuid; conversationId?: Uuid }
  | { mode: "cancel"; actionId: Uuid; conversationId?: Uuid }
  | { mode: "history"; conversationId?: Uuid }
  | { mode: "clear"; conversationId?: Uuid };

export interface FinanceAiQuota {
  plan: string;
  limits_enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  model_limit: number;
  model_used: number;
  model_remaining: number;
  window_start: IsoTimestamp;
  window_end: IsoTimestamp;
  timezone: "America/Sao_Paulo";
}

export interface FinanceAiProposalPreview {
  title: string;
  summary: string;
  consequences: string[];
}

export interface FinanceAiPendingAction {
  id: Uuid;
  confirmationToken: Uuid;
  actionType: FinanceAiMutationIntent;
  expiresAt: IsoTimestamp;
  preview: FinanceAiProposalPreview;
}

export type FinanceAiNavigationRoute = "/" | "/transacoes" | "/caixinhas" | "/relatorios" | "/cartoes" | "/?abrirCategorias=1";

export type FinanceAiHttpSuccessResponse =
  | { kind: "answer"; conversationId: Uuid; message: string; intent: FinanceAiReadIntent | "out_of_scope"; quota: FinanceAiQuota }
  | { kind: "clarify"; conversationId: Uuid; message: string; intent: Exclude<FinanceAiIntent, "out_of_scope">; missingFields: string[]; quota: FinanceAiQuota }
  | { kind: "navigate"; conversationId: Uuid; message: string; intent: FinanceAiNavigationIntent; route: FinanceAiNavigationRoute; quota: FinanceAiQuota }
  | { kind: "proposal"; conversationId: Uuid; message: string; intent: FinanceAiMutationIntent; pendingAction: FinanceAiPendingAction; quota: FinanceAiQuota }
  | {
      kind: "executed";
      message: string;
      result: { ok: true; action_id: Uuid; action_type: FinanceAiMutationIntent; status: "succeeded"; result: Record<string, unknown>; replayed: boolean };
      quota: FinanceAiQuota;
    }
  | {
      kind: "cancelled";
      message: string;
      action: { ok: true; action_id: Uuid; action_type: FinanceAiMutationIntent; status: "cancelled"; cancelled_at: IsoTimestamp; replayed: boolean };
      quota?: FinanceAiQuota;
    }
  | {
      conversationId: Uuid | null;
      messages: { id: string; role: "user" | "assistant"; text: string; createdAt: IsoTimestamp; intent: FinanceAiIntent | null }[];
      quota?: FinanceAiQuota;
    }
  | { cleared: true; conversationId: null; messages: []; quota?: FinanceAiQuota };

export type FinanceAiErrorHttpResponse = { error: string; message?: string };
export type FinanceAiHttpResponse = FinanceAiHttpSuccessResponse | FinanceAiErrorHttpResponse;

export type FinanceAiValidationIssue = { path: string; message: string };
export type FinanceAiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "INVALID_JSON" | "INVALID_ENVELOPE"; message: string; retryable: false; issues?: FinanceAiValidationIssue[] } };
