import {
  FINANCE_AI_INTENTS,
  FINANCE_AI_MUTATION_INTENTS,
  FINANCE_AI_NAVIGATION_INTENTS,
  FINANCE_AI_READ_INTENTS,
  type FinanceAiHttpResponse,
  type FinanceAiResult,
  type FinanceAiValidationIssue,
} from "./types";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,99}$/;
const allIntents = new Set<string>(FINANCE_AI_INTENTS);
const mutations = new Set<string>(FINANCE_AI_MUTATION_INTENTS);
const reads = new Set<string>(FINANCE_AI_READ_INTENTS);
const navigation = new Set<string>(FINANCE_AI_NAVIGATION_INTENTS);
const routes: Record<string, string> = {
  open_home: "/", open_history: "/transacoes", open_goals: "/caixinhas",
  open_cash_flow: "/relatorios", open_cards: "/cartoes", open_categories: "/?abrirCategorias=1",
};

function object(value: unknown): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(row: Row, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(row).every((key) => expected.has(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(row, key));
}

function text(value: unknown, max = 2_000, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function quota(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["plan", "limits_enabled", "limit", "used", "remaining", "model_limit", "model_used", "model_remaining", "window_start", "window_end", "timezone"])) return false;
  return text(value.plan, 40)
    && typeof value.limits_enabled === "boolean"
    && integer(value.limit, -1)
    && integer(value.used)
    && integer(value.remaining, -1)
    && integer(value.model_limit)
    && integer(value.model_used)
    && integer(value.model_remaining)
    && timestamp(value.window_start)
    && timestamp(value.window_end)
    && value.timezone === "America/Sao_Paulo";
}

function exactKeysWithOptionalQuota(row: Row, baseKeys: readonly string[]): boolean {
  const hasQuota = Object.prototype.hasOwnProperty.call(row, "quota");
  return exactKeys(row, hasQuota ? [...baseKeys, "quota"] : baseKeys)
    && (!hasQuota || quota(row.quota));
}

function messageBase(row: Row): boolean {
  return uuid(row.conversationId) && text(row.message) && quota(row.quota);
}

function preview(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["title", "summary", "consequences"])) return false;
  return text(value.title, 200) && text(value.summary, 2_000)
    && Array.isArray(value.consequences) && value.consequences.length <= 20
    && value.consequences.every((item) => text(item, 500));
}

function pendingAction(value: unknown, intent: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["id", "confirmationToken", "actionType", "expiresAt", "preview"])) return false;
  return uuid(value.id) && uuid(value.confirmationToken) && value.actionType === intent
    && mutations.has(String(value.actionType)) && timestamp(value.expiresAt) && preview(value.preview);
}

function execution(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["ok", "action_id", "action_type", "status", "result", "replayed"])) return false;
  return value.ok === true && uuid(value.action_id) && mutations.has(String(value.action_type))
    && value.status === "succeeded" && object(value.result) && typeof value.replayed === "boolean";
}

function cancellation(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["ok", "action_id", "action_type", "status", "cancelled_at", "replayed"])) return false;
  return value.ok === true && uuid(value.action_id) && mutations.has(String(value.action_type))
    && value.status === "cancelled" && timestamp(value.cancelled_at) && typeof value.replayed === "boolean";
}

function historyMessages(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 200 && value.every((item) => {
    if (!object(item) || !exactKeys(item, ["id", "role", "text", "createdAt", "intent"])) return false;
    return typeof item.id === "string" && /^[1-9]\d*$/.test(item.id)
      && (item.role === "user" || item.role === "assistant")
      && text(item.text) && timestamp(item.createdAt)
      && (item.intent === null || allIntents.has(String(item.intent)));
  });
}

function invalid(issues: FinanceAiValidationIssue[]): FinanceAiResult<FinanceAiHttpResponse> {
  return {
    ok: false,
    error: {
      code: "INVALID_ENVELOPE",
      message: "A resposta HTTP da IA foi rejeitada.",
      retryable: false,
      issues,
    },
  };
}

export function parseFinanceAiHttpResponse(raw: string | unknown): FinanceAiResult<FinanceAiHttpResponse> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: { code: "INVALID_JSON", message: "A resposta não é um JSON válido.", retryable: false } };
    }
  }
  if (!object(value)) return invalid([{ path: "$", message: "A resposta deve ser um objeto." }]);

  let valid = false;
  if (Object.prototype.hasOwnProperty.call(value, "error")) {
    const keys = Object.prototype.hasOwnProperty.call(value, "message") ? ["error", "message"] : ["error"];
    valid = exactKeys(value, keys) && typeof value.error === "string" && ERROR_CODE.test(value.error)
      && (!Object.prototype.hasOwnProperty.call(value, "message") || text(value.message));
  } else if (value.kind === "answer") {
    valid = exactKeys(value, ["kind", "conversationId", "message", "intent", "quota"])
      && messageBase(value) && (reads.has(String(value.intent)) || value.intent === "out_of_scope");
  } else if (value.kind === "clarify") {
    valid = exactKeys(value, ["kind", "conversationId", "message", "intent", "missingFields", "quota"])
      && messageBase(value) && allIntents.has(String(value.intent)) && value.intent !== "out_of_scope"
      && Array.isArray(value.missingFields) && value.missingFields.length >= 1 && value.missingFields.length <= 20
      && value.missingFields.every((item) => text(item, 60));
  } else if (value.kind === "navigate") {
    valid = exactKeys(value, ["kind", "conversationId", "message", "intent", "route", "quota"])
      && messageBase(value) && navigation.has(String(value.intent)) && value.route === routes[String(value.intent)];
  } else if (value.kind === "proposal") {
    valid = exactKeys(value, ["kind", "conversationId", "message", "intent", "pendingAction", "quota"])
      && messageBase(value) && mutations.has(String(value.intent)) && pendingAction(value.pendingAction, value.intent);
  } else if (value.kind === "executed") {
    valid = exactKeys(value, ["kind", "message", "result", "quota"])
      && text(value.message) && execution(value.result) && quota(value.quota);
  } else if (value.kind === "cancelled") {
    valid = exactKeysWithOptionalQuota(value, ["kind", "message", "action"])
      && text(value.message) && cancellation(value.action);
  } else if (value.cleared === true) {
    valid = exactKeysWithOptionalQuota(value, ["cleared", "conversationId", "messages"])
      && value.conversationId === null && Array.isArray(value.messages) && value.messages.length === 0;
  } else if (Object.prototype.hasOwnProperty.call(value, "messages") && Object.prototype.hasOwnProperty.call(value, "conversationId")) {
    valid = exactKeysWithOptionalQuota(value, ["conversationId", "messages"])
      && (value.conversationId === null || uuid(value.conversationId)) && historyMessages(value.messages);
  }

  return valid ? { ok: true, value: value as FinanceAiHttpResponse } : invalid([{ path: "$", message: "Campos ausentes, extras ou inválidos." }]);
}
