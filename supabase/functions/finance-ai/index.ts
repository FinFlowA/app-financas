import { handleOptions, json } from "../_shared/http.ts";
import { adminClient, authenticatedClient } from "../_shared/supabase.ts";
import {
  fieldsToPayload,
  hasRemainingActionQuota,
  isDirectAction,
  publicErrorMessage,
  type ConversationMessage,
  type NavigationIntent,
} from "./contracts.ts";
import { buildFinancialContext } from "./context.ts";
import {
  containsSensitiveData,
  isFinancialControlMessage,
  normalizeText,
  redactInternalIdentifiers,
  redactSensitiveText,
  safeAssistantMessage,
} from "./guard.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  estimateModelTokenBudget,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_MAX_RESERVED_INPUT_TOKENS,
  providerFailureMetadata,
  requestModel,
  type ModelTokenBudget,
} from "./provider.ts";
import { enforceActionWorkflow } from "./workflow.ts";

type JsonRecord = Record<string, unknown>;
type RequestMode = "message" | "confirm" | "cancel" | "history" | "clear";
type SupabaseClient = ReturnType<typeof authenticatedClient>;
type AdminClient = ReturnType<typeof adminClient>;

const MAX_REQUEST_BYTES = 24_000;
const MAX_MESSAGE_CHARS = 2_000;
const OUT_OF_SCOPE_MESSAGE = "Posso ajudar exclusivamente com o controle financeiro no FinFlow: contas, lançamentos, categorias, objetivos, cartões, faturas, orçamento e fluxo de caixa.";
const ANALYTIC_INTENTS = new Set(["category_analysis", "budget_analysis", "financial_projection"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const PRE_CONTEXT_MODEL_BUDGET: ModelTokenBudget = {
  estimatedInputTokens: 1,
  maxOutputTokens: 1,
};

const NAVIGATION_ROUTES: Record<NavigationIntent, string> = {
  open_home: "/",
  open_history: "/transacoes",
  open_goals: "/caixinhas",
  open_cash_flow: "/relatorios",
  open_cards: "/cartoes",
  open_categories: "/?abrirCategorias=1",
};

const REQUEST_FIELDS: Record<RequestMode, readonly string[]> = {
  message: ["mode", "message", "conversationId", "requestId"],
  confirm: ["mode", "actionId", "confirmationToken", "conversationId"],
  cancel: ["mode", "actionId", "conversationId"],
  history: ["mode", "conversationId"],
  clear: ["mode", "conversationId"],
};

function optionalSecret(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizeRpcObject(value: unknown): JsonRecord {
  return Array.isArray(value) ? asObject(value[0]) : asObject(value);
}

function requestMode(value: unknown): RequestMode {
  if (value === "message" || value === "confirm" || value === "cancel" || value === "history" || value === "clear") return value;
  throw new Error("INVALID_REQUEST");
}

function validateRequestFields(body: JsonRecord, mode: RequestMode): void {
  const allowed = new Set(REQUEST_FIELDS[mode]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("INVALID_REQUEST");
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("INVALID_REQUEST");
  return value;
}

function optionalUuid(value: unknown): string | undefined {
  return value == null ? undefined : parseUuid(value);
}

function parseMessage(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_REQUEST");
  const message = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) throw new Error("INVALID_REQUEST");
  if (containsSensitiveData(message)) {
    throw new Error("AI_SENSITIVE_DATA_REJECTED");
  }
  return message;
}

function parseRequestId(value: unknown): string {
  if (value == null) return crypto.randomUUID();
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) throw new Error("INVALID_REQUEST");
  return value;
}

async function parseRequest(req: Request): Promise<JsonRecord> {
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) throw new Error("INVALID_REQUEST");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new Error("INVALID_REQUEST");
  try {
    return asObject(JSON.parse(raw));
  } catch {
    throw new Error("INVALID_REQUEST");
  }
}

function isAnalyticalRequest(message: string): boolean {
  const normalized = normalizeText(message);
  return /(analis|analise|projec|projet|previsao|prever|tendencia|cenario|orcamento ideal|planejamento|como estao meus gastos|onde estou gastando|gastos? por categoria|economizar quanto|quanto vou ter|quanto terei|fim do ano)/.test(normalized);
}

function isDraftCancellation(message: string): boolean {
  return /^(cancelar?|cancela|desistir|desisto|deixa pra la|esquece|nao quero)(?:[.!\s]|$)/.test(normalizeText(message));
}

function isLikelyMutationRequest(message: string): boolean {
  const normalized = normalizeText(message);
  if (/\b(como|posso|onde|qual a forma)\b/.test(normalized)) return false;
  return /(crie|criar|adicione|adicionar|lance|lancar|registre|registrar|edite|editar|altere|alterar|apague|apagar|exclua|excluir|arquive|arquivar|reative|reativar|conclua|concluir|pague|pagar|transfira|transferir|guarde|guardar|resgate|resgatar|reabra|reabrir)/.test(normalized)
    && /(conta|categoria|objetiv|caixinha|lanc|transa|receit|despes|cartao|compra|fatura|transfer)/.test(normalized);
}

function asStringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asObject(value))
      .filter(([key, item]) => key.length <= 60 && typeof item === "string" && item.length <= 1_000)
      .slice(0, 50),
  ) as Record<string, string>;
}

function allowedBetaEmail(email?: string): boolean {
  const allowed = optionalSecret("FINFLOW_AI_ALLOWED_EMAILS")
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("pt-BR"))
    .filter(Boolean);
  return Boolean(email) && allowed.includes(email!.toLocaleLowerCase("pt-BR"));
}

function ensureRolloutAccess(email: string | undefined, quota: JsonRecord): void {
  const limitsEnabled = Boolean(quota.limits_enabled);
  // Fail closed: uma publicação sem configuração explícita nunca libera custo
  // de IA para toda a base por engano.
  const rollout = (optionalSecret("FINFLOW_AI_ROLLOUT_MODE") || "off").toLowerCase();
  if (rollout === "off") throw new Error("AI_NOT_AVAILABLE");
  if (rollout === "beta" && !allowedBetaEmail(email)) throw new Error("AI_NOT_AVAILABLE");
  if (rollout === "plans" && !limitsEnabled) throw new Error("AI_NOT_AVAILABLE");
  if (rollout === "plans" && quota.plan === "free") throw new Error("AI_PLAN_REQUIRED");
  if (rollout !== "beta" && rollout !== "plans") throw new Error("AI_NOT_AVAILABLE");
}

async function getQuota(client: SupabaseClient): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ai_get_action_quota");
  if (error) throw new Error("AI_CONFIGURATION_FAILED");
  return normalizeRpcObject(data);
}

async function reserveModelRequest(
  admin: AdminClient,
  userId: string,
  budget: ModelTokenBudget,
): Promise<string> {
  const configured = Number(optionalSecret("FINFLOW_AI_REQUESTS_PER_MINUTE"));
  const limit = Number.isSafeInteger(configured) && configured >= 1 && configured <= 30 ? configured : 8;
  const { data, error } = await admin.rpc("ai_reserve_model_request_v2", {
    p_user_id: userId,
    p_user_limit: limit,
    p_window_seconds: 60,
    p_estimated_input_tokens: budget.estimatedInputTokens,
    p_max_output_tokens: budget.maxOutputTokens,
  });
  if (error) throw new Error("AI_CONFIGURATION_FAILED");
  const reservation = normalizeRpcObject(data);
  if (!reservation.allowed) {
    const reason = String(reservation.reason ?? "");
    if (reason === "daily") throw new Error("AI_DAILY_MESSAGE_LIMIT");
    if (reason === "user_daily_attempts") throw new Error("AI_DAILY_SAFETY_LIMIT");
    if (reason === "request_tokens") throw new Error("AI_CONTEXT_TOO_LARGE");
    if (reason.startsWith("global_")) throw new Error("AI_TEMPORARILY_PAUSED");
    throw new Error("AI_RATE_LIMITED");
  }
  if (typeof reservation.usage_id !== "string" || !UUID_PATTERN.test(reservation.usage_id)) {
    throw new Error("AI_CONFIGURATION_FAILED");
  }
  return reservation.usage_id;
}

async function finalizeModelRequest(admin: AdminClient, args: {
  usageId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: "completed" | "failed";
  latencyMs: number;
  errorCode: string | null;
}): Promise<void> {
  const { error } = await admin.rpc("ai_finalize_model_request_v2", {
    p_usage_id: args.usageId,
    p_provider: args.provider,
    p_model: args.model,
    p_input_tokens: args.inputTokens,
    p_output_tokens: args.outputTokens,
    p_status: args.status,
    p_latency_ms: args.latencyMs,
    p_error_code: args.errorCode,
  });
  if (error) console.error("finance-ai model telemetry", error.message);
}

function monitoringLatencyMs(startedAt: number): number {
  return Math.min(300_000, Math.max(0, Date.now() - startedAt));
}

function monitoringErrorCode(error: unknown, fallback: string): string {
  const candidate = error instanceof Error ? error.message : "";
  return /^AI_[A-Z0-9_]{1,77}$/.test(candidate) ? candidate : fallback;
}

async function adjustModelRequest(
  admin: AdminClient,
  usageId: string,
  budget: ModelTokenBudget,
): Promise<void> {
  const { data, error } = await admin.rpc("ai_adjust_model_request_v2", {
    p_usage_id: usageId,
    p_estimated_input_tokens: budget.estimatedInputTokens,
    p_max_output_tokens: budget.maxOutputTokens,
  });
  if (error) throw new Error("AI_CONFIGURATION_FAILED");
  const adjustment = normalizeRpcObject(data);
  if (!adjustment.allowed) {
    const reason = String(adjustment.reason ?? "");
    if (reason === "request_tokens") throw new Error("AI_CONTEXT_TOO_LARGE");
    if (reason.startsWith("global_tokens_")) throw new Error("AI_TEMPORARILY_PAUSED");
    throw new Error("AI_RATE_LIMITED");
  }
}

async function findConversation(admin: AdminClient, userId: string, requestedId?: unknown): Promise<{ id: string; state: Record<string, string> } | null> {
  let query = admin.from("ai_conversations").select("id,state").eq("user_id", userId);
  if (requestedId == null) {
    query = query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  } else {
    query = query.eq("id", parseUuid(requestedId)).limit(1);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("AI_HISTORY_FAILED");
  return data ? { id: String(data.id), state: asStringRecord(data.state) } : null;
}

async function getOrCreateConversation(admin: AdminClient, userId: string, requestedId?: unknown): Promise<{ id: string; state: Record<string, string> }> {
  const existing = await findConversation(admin, userId, requestedId);
  if (existing) return existing;
  const { data, error } = await admin.from("ai_conversations").insert({ user_id: userId, state: {} }).select("id,state").single();
  if (error || !data) throw new Error("AI_HISTORY_FAILED");
  return { id: String(data.id), state: {} };
}

async function recentMessages(admin: AdminClient, userId: string, conversationId: string): Promise<ConversationMessage[]> {
  const { data, error } = await admin
    .from("ai_messages")
    .select("role,content")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(8);
  if (error) throw new Error("AI_HISTORY_FAILED");
  return (data ?? []).reverse().map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content).slice(0, MAX_MESSAGE_CHARS),
  }));
}

async function saveMessage(admin: AdminClient, args: {
  userId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  intent?: string | null;
  provider?: string | null;
  model?: string | null;
}): Promise<void> {
  const safeContent = redactSensitiveText(args.content).trim().slice(0, MAX_MESSAGE_CHARS);
  if (!safeContent) throw new Error("AI_HISTORY_FAILED");
  const { error } = await admin.from("ai_messages").insert({
    user_id: args.userId,
    conversation_id: args.conversationId,
    role: args.role,
    content: safeContent,
    intent: args.intent ?? null,
    provider: args.provider ?? null,
    model: args.model ?? null,
  });
  if (error) throw new Error("AI_HISTORY_FAILED");
}

async function saveMessageBestEffort(admin: AdminClient, args: Parameters<typeof saveMessage>[1]): Promise<void> {
  try {
    await saveMessage(admin, args);
  } catch (error) {
    console.error("finance-ai history write", error instanceof Error ? error.message : "unknown");
  }
}

async function updateConversationState(admin: AdminClient, userId: string, conversationId: string, state: Record<string, string>): Promise<void> {
  const compactState: Record<string, string> = {};
  for (const [key, value] of Object.entries(state).slice(0, 50)) {
    if (!key || key.length > 60 || typeof value !== "string") continue;
    compactState[key] = redactSensitiveText(value).slice(0, 1_000);
    if (new TextEncoder().encode(JSON.stringify(compactState)).byteLength > 16_000) {
      delete compactState[key];
      break;
    }
  }
  const { error } = await admin.from("ai_conversations").update({ state: compactState, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
  if (error) throw new Error("AI_HISTORY_FAILED");
}

async function safetyIdentifier(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`finflow:${userId}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function errorCodeFromRpc(error: { message?: string } | null | undefined, fallback: string): string {
  const match = error?.message?.match(/AI_[A-Z0-9_]+/);
  return match?.[0] ?? fallback;
}

function actionSuccessMessage(actionType: unknown, replayed: boolean): string {
  const labels: Record<string, string> = {
    create_account: "Conta criada com sucesso.", update_account: "Conta atualizada com sucesso.", archive_account: "Conta arquivada com sucesso.",
    delete_account: "Conta excluída ou arquivada conforme os lançamentos existentes.", reactivate_account: "Conta reativada com sucesso.",
    create_category: "Categoria criada com sucesso.", update_category: "Categoria atualizada com sucesso.", archive_category: "Categoria arquivada com sucesso.",
    delete_category: "Categoria excluída ou arquivada conforme os vínculos existentes.", reactivate_category: "Categoria reativada com sucesso.",
    create_goal: "Objetivo criado com sucesso.", update_goal: "Objetivo atualizado com sucesso.", archive_goal: "Objetivo arquivado com sucesso.",
    delete_goal: "Objetivo excluído com sucesso.", reactivate_goal: "Objetivo reativado com sucesso.", move_goal: "Movimentação do objetivo concluída com sucesso.",
    create_transaction: "Lançamento criado com sucesso.", update_transaction: "Lançamento atualizado com sucesso.", delete_transaction: "Lançamento excluído com sucesso.",
    complete_transaction: "Lançamento concluído com a data de realização informada.", reopen_transaction: "Lançamento reaberto como pendente.",
    transfer_between_accounts: "Transferência criada com sucesso.", create_card: "Cartão criado com sucesso.", update_card: "Cartão atualizado com sucesso.",
    archive_card: "Cartão arquivado com sucesso.", delete_card: "Cartão excluído com sucesso.", reactivate_card: "Cartão reativado com sucesso.",
    create_card_purchase: "Compra lançada no cartão com sucesso.", update_card_purchase: "Compra do cartão atualizada com sucesso.", delete_card_purchase: "Compra do cartão excluída com sucesso.",
    pay_invoice: "Pagamento da fatura registrado com sucesso.", reverse_invoice_payment: "Pagamento da fatura estornado com sucesso.",
  };
  const message = labels[String(actionType)] ?? "Ação financeira concluída com sucesso.";
  return replayed ? `${message} Esta confirmação já havia sido processada e não foi duplicada.` : message;
}

async function handleHistory(admin: AdminClient, userId: string, requestedId?: unknown): Promise<JsonRecord> {
  const conversation = await findConversation(admin, userId, requestedId);
  if (!conversation) return { conversationId: null, messages: [] };
  const { data, error } = await admin.from("ai_messages").select("id,role,content,created_at,intent")
    .eq("user_id", userId).eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) throw new Error("AI_HISTORY_FAILED");
  return {
    conversationId: conversation.id,
    messages: (data ?? []).reverse().map((row) => ({ id: String(row.id), role: row.role, text: row.content, createdAt: row.created_at, intent: row.intent })),
  };
}

async function handleClear(admin: AdminClient, userId: string, requestedId?: unknown): Promise<JsonRecord> {
  const conversationId = optionalUuid(requestedId);
  if (conversationId) {
    const { error } = await admin.from("ai_conversations").delete().eq("id", conversationId).eq("user_id", userId);
    if (error) throw new Error("AI_HISTORY_FAILED");
  } else {
    const { error } = await admin.from("ai_conversations").delete().eq("user_id", userId);
    if (error) throw new Error("AI_HISTORY_FAILED");
  }
  return { cleared: true, conversationId: null, messages: [] };
}

function errorStatus(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "METHOD_NOT_ALLOWED") return 405;
  if (code === "AI_PROVIDER_REQUEST_TOO_LARGE") return 413;
  if (code === "AI_TEMPORARILY_PAUSED") return 503;
  if (["AI_RATE_LIMITED", "AI_DAILY_MESSAGE_LIMIT", "AI_DAILY_SAFETY_LIMIT", "AI_DAILY_QUOTA_EXCEEDED", "AI_DAILY_LIMIT_REACHED", "AI_PROVIDER_RATE_LIMITED", "AI_PROPOSAL_RATE_LIMITED"].includes(code)) return 429;
  if (["AI_NOT_AVAILABLE", "AI_PLAN_REQUIRED", "AI_ANALYTICS_PLAN_REQUIRED", "AI_PLAN_RESOURCE_LIMIT"].includes(code)) return 403;
  if (code === "AI_ACTION_NOT_FOUND" || code === "PENDING_ACTION_NOT_FOUND" || code.includes("_NOT_FOUND")) return 404;
  if (code === "INVALID_REQUEST" || code === "AI_SENSITIVE_DATA_REJECTED" || code.startsWith("INVALID_") || code.startsWith("AI_INVALID_") || code.startsWith("AI_MISSING_")) return 400;
  if (code === "AI_ACTION_STATE_CHANGED") return 409;
  if ([
    "AI_ACTION_EXPIRED", "AI_ACTION_CANCELLED", "AI_ACTION_NOT_EXECUTABLE", "AI_ACTION_NOT_CANCELLABLE",
    "AI_IDEMPOTENCY_CONFLICT", "AI_INSUFFICIENT_GOAL_BALANCE",
    "AI_GOAL_HAS_BALANCE", "AI_GOAL_HAS_PENDING_ENTRIES", "AI_INVOICE_CLOSED", "AI_PAYMENT_ABOVE_INVOICE",
    "AI_INVOICE_HAS_LATER_PAYMENT", "AI_INVOICE_HAS_UNTRACKED_PAYMENT", "AI_TRANSACTION_VALUE_CHANGED",
    "AI_TRANSACTION_NOT_COMPLETED", "AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL", "AI_NO_OPEN_SERIES_ITEMS",
    "AI_TRANSACTION_NOT_IN_SERIES", "AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL",
    "AI_LEGACY_SERIES_AMBIGUOUS", "AI_LEGACY_GOAL_AMBIGUOUS",
  ].includes(code)
    || code.includes("ALREADY_") || code.includes("_MISMATCH") || code.includes("_IMMUTABLE")
    || code.includes("_ARCHIVED") || code.includes("_EXCEEDED") || code.includes("_UNSUPPORTED")) return 409;
  return 500;
}

Deno.serve(async (req) => {
  const requestStartedAt = Date.now();
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED", message: publicErrorMessage("METHOD_NOT_ALLOWED") }, 405, req);

  try {
    const client = authenticatedClient(req);
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) throw new Error("UNAUTHORIZED");
    const user = authData.user;
    const body = await parseRequest(req);
    const mode = requestMode(body.mode);
    validateRequestFields(body, mode);
    const admin = adminClient();

    // Histórico e limpeza são direitos de privacidade. Cancelar uma proposta
    // também continua disponível após downgrade, encerramento do rollout ou
    // indisponibilidade temporária da apuração de plano.
    if (mode === "history" || mode === "clear" || mode === "cancel") {
      let privacyQuota: JsonRecord | undefined;
      try {
        privacyQuota = await getQuota(client);
      } catch (quotaError) {
        console.error("finance-ai quota unavailable for privacy operation", quotaError instanceof Error ? quotaError.message : "unknown");
      }
      const quotaEnvelope = privacyQuota ? { quota: privacyQuota } : {};
      if (mode === "history") return json({ ...(await handleHistory(admin, user.id, body.conversationId)), ...quotaEnvelope }, 200, req);
      if (mode === "clear") return json({ ...(await handleClear(admin, user.id, body.conversationId)), ...quotaEnvelope }, 200, req);

      const actionId = parseUuid(body.actionId);
      const { data, error } = await client.rpc("ai_cancel_pending_action", { p_action_id: actionId });
      if (error) throw new Error(errorCodeFromRpc(error, "AI_ACTION_NOT_FOUND"));
      const action = normalizeRpcObject(data);
      if (!action.ok) throw new Error(String(action.error_code || "AI_ACTION_NOT_FOUND"));
      return json({ kind: "cancelled", message: "Ação cancelada. Nenhuma alteração financeira foi feita.", action, ...quotaEnvelope }, 200, req);
    }

    const quota = await getQuota(client);
    ensureRolloutAccess(user.email, quota);

    if (mode === "confirm") {
      const actionId = parseUuid(body.actionId);
      const confirmationToken = parseUuid(body.confirmationToken);
      const { data, error } = await client.rpc("ai_consume_pending_action", {
        p_action_id: actionId,
        p_confirmation_token: confirmationToken,
      });
      if (error) throw new Error(errorCodeFromRpc(error, "AI_ACTION_EXECUTION_FAILED"));
      const result = normalizeRpcObject(data);
      if (!result.ok) throw new Error(String(result.error_code || "AI_ACTION_EXECUTION_FAILED"));
      const message = actionSuccessMessage(result.action_type, Boolean(result.replayed));
      // A escrita financeira já foi confirmada neste ponto. Histórico e
      // atualização visual da cota não podem converter um sucesso real em
      // HTTP 500 e induzir o usuário a acreditar que nada aconteceu.
      try {
        const conversation = await findConversation(admin, user.id, body.conversationId);
        if (conversation) {
          await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: message, intent: String(result.action_type ?? "") });
        }
      } catch (historyError) {
        console.error("finance-ai post-execution history", historyError instanceof Error ? historyError.message : "unknown");
      }
      let refreshedQuota = quota;
      try {
        refreshedQuota = await getQuota(client);
      } catch (quotaError) {
        console.error("finance-ai post-execution quota", quotaError instanceof Error ? quotaError.message : "unknown");
      }
      return json({ kind: "executed", message, result, quota: refreshedQuota }, 200, req);
    }

    const message = parseMessage(body.message);
    const requestId = parseRequestId(body.requestId);
    const existingConversation = await findConversation(admin, user.id, body.conversationId);
    const existingState = existingConversation?.state ?? {};

    if (!isFinancialControlMessage(message, existingState)) {
      if (existingConversation && Object.keys(existingState).length) {
        await updateConversationState(admin, user.id, existingConversation.id, {});
      }
      // Não cria conversa, não persiste o texto e não consome o provedor.
      return json({ error: "AI_OUT_OF_SCOPE", message: OUT_OF_SCOPE_MESSAGE }, 400, req);
    }

    if (existingConversation && Object.keys(existingState).length && isDraftCancellation(message)) {
      const responseMessage = "Rascunho cancelado. Nenhuma alteração financeira foi feita.";
      await updateConversationState(admin, user.id, existingConversation.id, {});
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: existingConversation.id, role: "assistant", content: responseMessage, intent: "explain_financial_control" });
      return json({ kind: "answer", conversationId: existingConversation.id, message: responseMessage, intent: "explain_financial_control", quota }, 200, req);
    }

    const analyticsRequested = isAnalyticalRequest(message);
    if (analyticsRequested && Boolean(quota.limits_enabled) && quota.plan !== "premium") throw new Error("AI_ANALYTICS_PLAN_REQUIRED");
    if (isLikelyMutationRequest(message) && !hasRemainingActionQuota(quota.remaining)) {
      throw new Error("AI_DAILY_QUOTA_EXCEEDED");
    }

    const usageId = await reserveModelRequest(
      admin,
      user.id,
      PRE_CONTEXT_MODEL_BUDGET,
    );
    let conversation: { id: string; state: Record<string, string> };
    let modelResult: Awaited<ReturnType<typeof requestModel>>;
    let financialContext: Awaited<ReturnType<typeof buildFinancialContext>>;
    let prompt: string;
    let history: ConversationMessage[];
    let safetyId: string;
    const outputCanary = crypto.randomUUID().replaceAll("-", "");
    try {
      const safeMessage = redactSensitiveText(message);
      const safeState = Object.fromEntries(Object.entries(existingState).map(([key, value]) => (
        [key, redactSensitiveText(value)]
      )));
      const storedHistory = existingConversation
        ? await recentMessages(admin, user.id, existingConversation.id)
        : [];
      history = [
        ...storedHistory.map((item) => ({ ...item, content: redactSensitiveText(item.content) })),
        { role: "user" as const, content: safeMessage },
      ];
      const contextRequest = `${safeMessage}\n${JSON.stringify(safeState)}`.slice(0, 3_000);
      financialContext = await buildFinancialContext(
        client,
        String(quota.plan ?? "free"),
        Boolean(quota.limits_enabled),
        contextRequest,
        user.id,
      );
      if (analyticsRequested && !financialContext.analyticsAllowed) throw new Error("AI_ANALYTICS_PLAN_REQUIRED");

      prompt = buildSystemPrompt({
        financialContext: financialContext.compactJson,
        conversationState: safeState,
        analyticsAllowed: financialContext.analyticsAllowed,
        outputCanary,
      });
      const actualBudget = estimateModelTokenBudget(prompt, history);
      if (actualBudget.estimatedInputTokens > MODEL_MAX_RESERVED_INPUT_TOKENS
        || actualBudget.maxOutputTokens > MODEL_MAX_OUTPUT_TOKENS) {
        throw new Error("AI_CONTEXT_TOO_LARGE");
      }
      // A primeira fase protege RPM/RPD antes de consultar o banco. Esta segunda
      // fase reserva atomicamente o TPM/TPD real antes de qualquer fetch externo.
      await adjustModelRequest(admin, usageId, actualBudget);
      // A conversa só nasce depois de escopo, plano e orçamento aprovados.
      conversation = existingConversation ?? await getOrCreateConversation(admin, user.id, body.conversationId);
      await saveMessage(admin, { userId: user.id, conversationId: conversation.id, role: "user", content: safeMessage });
      safetyId = await safetyIdentifier(user.id);
    } catch (preProviderError) {
      const errorCode = monitoringErrorCode(preProviderError, "AI_CONFIGURATION_FAILED");
      await finalizeModelRequest(admin, {
        usageId,
        provider: "not_called",
        model: "not_called",
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
        latencyMs: monitoringLatencyMs(requestStartedAt),
        errorCode,
      });
      throw preProviderError;
    }

    try {
      modelResult = await requestModel(prompt, history, safetyId);
    } catch (providerError) {
      const providerErrorCode = monitoringErrorCode(providerError, "AI_PROVIDER_FAILED");
      const providerMetadata = providerFailureMetadata(providerError);
      const definitelyNotCalled = providerErrorCode === "AI_PROVIDER_NOT_CONFIGURED"
        || providerErrorCode === "AI_CONTEXT_TOO_LARGE";
      // Configuração/contexto falham antes do fetch e podem liberar a reserva.
      // Qualquer outra falha pode ter consumido tokens e preserva o orçamento.
      await finalizeModelRequest(admin, {
        usageId,
        provider: definitelyNotCalled ? "not_called" : providerMetadata?.provider ?? "attempted",
        model: definitelyNotCalled ? "not_called" : providerMetadata?.model ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
        latencyMs: monitoringLatencyMs(requestStartedAt),
        errorCode: providerErrorCode,
      });
      throw providerError;
    }
    await finalizeModelRequest(admin, {
      usageId,
      provider: modelResult.provider,
      model: modelResult.model,
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      status: "completed",
      latencyMs: monitoringLatencyMs(requestStartedAt),
      errorCode: null,
    });
    const { output: rawOutput, provider, model } = modelResult;
    const output = enforceActionWorkflow(rawOutput, existingState, financialContext.compactJson);
    const quotaAfterModel = await getQuota(client);

    if (output.kind === "out_of_scope") {
      await updateConversationState(admin, user.id, conversation.id, {});
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: OUT_OF_SCOPE_MESSAGE, intent: "out_of_scope", provider, model });
      return json({ kind: "answer", conversationId: conversation.id, message: OUT_OF_SCOPE_MESSAGE, intent: "out_of_scope", quota: quotaAfterModel }, 200, req);
    }

    const outputMessage = safeAssistantMessage(output.message, output.intent, output.kind, outputCanary);
    if (!outputMessage) {
      await updateConversationState(admin, user.id, conversation.id, {});
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: OUT_OF_SCOPE_MESSAGE, intent: "out_of_scope", provider, model });
      return json({ kind: "answer", conversationId: conversation.id, message: OUT_OF_SCOPE_MESSAGE, intent: "out_of_scope", quota: quotaAfterModel }, 200, req);
    }

    const outputIsAnalytical = ANALYTIC_INTENTS.has(output.intent);
    if ((analyticsRequested || outputIsAnalytical) && !financialContext.analyticsAllowed) throw new Error("AI_ANALYTICS_PLAN_REQUIRED");
    // A heurística anterior ao provedor economiza chamadas óbvias, mas não é
    // uma fronteira de autorização. A intenção estruturada é a decisão final.
    if (output.kind === "propose_action" && !hasRemainingActionQuota(quotaAfterModel.remaining)) {
      throw new Error("AI_DAILY_QUOTA_EXCEEDED");
    }

    if (output.kind === "clarify") {
      const state = {
        ...fieldsToPayload(output.data),
        __intent: output.intent,
        __missing_fields: output.missing_fields.join(",").slice(0, 500),
      };
      await updateConversationState(admin, user.id, conversation.id, state);
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: outputMessage, intent: output.intent, provider, model });
      return json({ kind: "clarify", conversationId: conversation.id, message: outputMessage, intent: output.intent, missingFields: output.missing_fields, quota: quotaAfterModel }, 200, req);
    }

    if (output.kind === "answer") {
      await updateConversationState(admin, user.id, conversation.id, {});
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: outputMessage, intent: output.intent, provider, model });
      return json({ kind: "answer", conversationId: conversation.id, message: outputMessage, intent: output.intent, quota: quotaAfterModel }, 200, req);
    }

    if (output.kind === "navigate") {
      const route = NAVIGATION_ROUTES[output.intent as NavigationIntent];
      if (!route) throw new Error("INVALID_MODEL_OUTPUT");
      await updateConversationState(admin, user.id, conversation.id, {});
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: outputMessage, intent: output.intent, provider, model });
      return json({ kind: "navigate", conversationId: conversation.id, message: outputMessage, intent: output.intent, route, quota: quotaAfterModel }, 200, req);
    }

    if (!isDirectAction(output.intent)) throw new Error("INVALID_MODEL_OUTPUT");
    const payload = fieldsToPayload(output.data);
    // Limpa o rascunho antes de criar a proposta. Assim, uma falha de histórico
    // nunca deixa uma ação válida escondida do aplicativo sem seu token de
    // confirmação.
    await updateConversationState(admin, user.id, conversation.id, {});
    const { data, error } = await client.rpc("ai_create_pending_action", {
      p_action_type: output.intent,
      p_payload: payload,
      p_idempotency_key: `conversation:${conversation.id}:${requestId}`,
      p_ttl_seconds: 600,
    });
    if (error) throw new Error(errorCodeFromRpc(error, "INVALID_REQUEST"));
    const action = normalizeRpcObject(data);
    if (!action.ok || !action.id || !action.confirmation_token) throw new Error(String(action.error_code || "INVALID_REQUEST"));

    const rawPreview = asObject(action.preview);
    const summaryCandidate = typeof rawPreview.summary === "string" ? rawPreview.summary : outputMessage;
    const summary = safeAssistantMessage(summaryCandidate, output.intent)
      ?? "Revise os dados financeiros desta ação antes de confirmar.";
    const preview = {
      title: redactSensitiveText(redactInternalIdentifiers(typeof rawPreview.title === "string" ? rawPreview.title : "Ação financeira")).slice(0, 200),
      summary,
      consequences: (Array.isArray(rawPreview.consequences) ? rawPreview.consequences : [])
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
        .map((item) => redactSensitiveText(redactInternalIdentifiers(item)).slice(0, 500)),
    };
    await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: summary, intent: output.intent, provider, model });
    return json({
      kind: "proposal",
      conversationId: conversation.id,
      message: summary,
      intent: output.intent,
      pendingAction: {
        id: action.id,
        confirmationToken: action.confirmation_token,
        actionType: action.action_type,
        expiresAt: action.expires_at,
        preview,
      },
      quota: quotaAfterModel,
    }, 200, req);
  } catch (error) {
    const original = error instanceof Error ? error.message : "AI_PROVIDER_FAILED";
    const extracted = original.match(/AI_[A-Z0-9_]+|INVALID_REQUEST|INVALID_MODEL_OUTPUT|UNAUTHORIZED/)?.[0] ?? "AI_PROVIDER_FAILED";
    const code = extracted === "INVALID_MODEL_OUTPUT" ? "AI_PROVIDER_FAILED" : extracted;
    if (["AI_PROVIDER_FAILED", "AI_CONFIGURATION_FAILED", "AI_HISTORY_FAILED"].includes(code)) console.error("finance-ai", original);
    return json({ error: code, message: publicErrorMessage(code) }, errorStatus(code), req);
  }
});
