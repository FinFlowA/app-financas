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
import { buildReadOnlySystemPrompt, buildSystemPrompt } from "./prompt.ts";
import {
  estimateModelTokenBudget,
  fallbackProductGuidance,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_MAX_RESERVED_INPUT_TOKENS,
  providerFailureMetadata,
  requestModel,
  type ModelTokenBudget,
} from "./provider.ts";
import { enforceActionWorkflow, resolveDeterministicContinuation, resolveReferencedFollowup } from "./workflow.ts";

type JsonRecord = Record<string, unknown>;
type RequestMode = "message" | "confirm" | "cancel" | "history" | "clear";
type SupabaseClient = ReturnType<typeof authenticatedClient>;
type AdminClient = ReturnType<typeof adminClient>;

const MAX_REQUEST_BYTES = 24_000;
const MAX_MESSAGE_CHARS = 2_000;
const OUT_OF_SCOPE_MESSAGE = "Posso conversar um pouco com você, mas não consigo orientar esse assunto com a profundidade necessária. Meu foco é ajudar com organização financeira e com os recursos do FinFlow.";
const ANALYTIC_INTENTS = new Set(["category_analysis", "budget_analysis", "financial_projection"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const PRE_CONTEXT_MODEL_BUDGET: ModelTokenBudget = {
  estimatedInputTokens: 1,
  maxOutputTokens: 1,
};
const CHAT_RETENTION_MS = 24 * 60 * 60 * 1_000;

function chatRetentionCutoff(): string {
  return new Date(Date.now() - CHAT_RETENTION_MS).toISOString();
}

async function purgeExpiredChat(admin: AdminClient, userId: string): Promise<void> {
  const cutoff = chatRetentionCutoff();
  const { error: messagesError } = await admin.from("ai_messages").delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff);
  if (messagesError) throw new Error("AI_HISTORY_FAILED");

  const { error: conversationsError } = await admin.from("ai_conversations").delete()
    .eq("user_id", userId)
    .lt("updated_at", cutoff);
  if (conversationsError) throw new Error("AI_HISTORY_FAILED");
}

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

type ClientMarketIndicators = {
  selic_rate_annual: number | null;
  selic_reference_date: string | null;
  cdi_rate_annual: number | null;
  cdi_reference_date: string | null;
  ipca_12m_percent: number | null;
  ipca_reference_date: string | null;
  source: "bcb_sgs";
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// market_indicators viaja dentro de compactJson (o texto que o modelo lê),
// não como campo solto de FinancialContext; o objeto ali pode trazer campos
// extras (valor/data anteriores) usados só pelo modelo, então o payload para
// o cliente precisa ser reduzido às 7 chaves que o contrato estrito aceita.
function clientMarketIndicators(compactJson: string): ClientMarketIndicators | null {
  let parsed: JsonRecord;
  try {
    parsed = asObject(JSON.parse(compactJson));
  } catch {
    return null;
  }
  const raw = parsed.market_indicators;
  if (!raw || typeof raw !== "object") return null;
  const source = raw as JsonRecord;
  if (source.source !== "bcb_sgs") return null;
  return {
    selic_rate_annual: numberOrNull(source.selic_rate_annual),
    selic_reference_date: stringOrNull(source.selic_reference_date),
    cdi_rate_annual: numberOrNull(source.cdi_rate_annual),
    cdi_reference_date: stringOrNull(source.cdi_reference_date),
    ipca_12m_percent: numberOrNull(source.ipca_12m_percent),
    ipca_reference_date: stringOrNull(source.ipca_reference_date),
    source: "bcb_sgs",
  };
}

type OperationalReferences = Pick<JsonRecord, "accounts" | "categories" | "goals" | "cards">;

async function loadOperationalReferences(client: SupabaseClient): Promise<OperationalReferences> {
  const [accounts, categories, goals, cards] = await Promise.all([
    client.from("contas").select("id,nome,arquivado,compartilhado").order("nome").limit(60),
    client.from("categorias").select("id,nome,tipo,ativa").order("nome").limit(100),
    client.from("caixinhas").select("id,nome,arquivado,saldo_atual").order("nome").limit(60),
    client.from("cartoes").select("id,nome,ativo,limite").order("nome").limit(40),
  ]);
  for (const result of [accounts, categories, goals, cards]) {
    if (result.error) throw new Error("AI_CONTEXT_QUERY_FAILED");
  }
  return {
    accounts: (accounts.data ?? []).map((row) => ({ id: row.id, name: row.nome, active: !row.arquivado, shared: Boolean(row.compartilhado) })),
    categories: (categories.data ?? []).map((row) => ({ id: row.id, name: row.nome, type: row.tipo, active: row.ativa !== false })),
    goals: (goals.data ?? []).map((row) => ({ id: row.id, name: row.nome, active: !row.arquivado, balance: row.saldo_atual })),
    cards: (cards.data ?? []).map((row) => ({ id: row.id, name: row.nome, active: row.ativo !== false, available_limit: row.limite })),
  };
}

function operationalContext(compactJson: string, references: OperationalReferences, maximum = 8_000): string {
  let source: JsonRecord;
  try {
    source = asObject(JSON.parse(compactJson));
  } catch {
    throw new Error("AI_CONTEXT_INVALID");
  }
  const take = (key: string, limit: number) => Array.isArray(source[key])
    ? (source[key] as unknown[]).slice(0, limit)
    : [];
  const minimal = (rows: unknown[], keys: string[]) => rows.map((item) => {
    const row = asObject(item);
    return Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
  });
  const compact: JsonRecord = {
    current_date: source.current_date,
    timezone: source.timezone,
    plan: source.plan,
    accounts: minimal((references.accounts as unknown[]).slice(0, 60), ["id", "name", "active", "shared"]),
    categories: minimal((references.categories as unknown[]).slice(0, 100), ["id", "name", "type", "active"]),
    goals: minimal((references.goals as unknown[]).slice(0, 60), ["id", "name", "active", "balance", "can_move_money"]),
    cards: minimal((references.cards as unknown[]).slice(0, 40), ["id", "name", "active", "available_limit"]),
    relevant_transactions: take("relevant_transactions", 8),
    relevant_invoice_items: take("relevant_invoice_items", 6),
    invoice_summaries: take("invoice_summaries", 4),
  };
  const keys = [
    "relevant_transactions", "relevant_invoice_items", "invoice_summaries",
    "goals", "cards",
  ];
  let encoded = JSON.stringify(compact);
  while (encoded.length > maximum) {
    const candidate = keys
      .map((key) => ({ key, rows: compact[key] as unknown[] }))
      .filter(({ rows }) => Array.isArray(rows) && rows.length > 1)
      .sort((left, right) => right.rows.length - left.rows.length)[0];
    if (!candidate) break;
    candidate.rows.pop();
    encoded = JSON.stringify(compact);
  }
  if (encoded.length > maximum) throw new Error("AI_CONTEXT_TOO_LARGE");
  return encoded;
}

function clarificationChoices(
  compactJson: string,
  missingFields: string[],
  state: Record<string, string>,
): string[] {
  const field = missingFields[0];
  const contextKey: Record<string, string> = {
    account_id: "accounts",
    destination_account_id: "accounts",
    category_id: "categories",
    goal_id: "goals",
    card_id: "cards",
    transaction_id: "relevant_transactions",
    purchase_id: "relevant_invoice_items",
  };
  const key = contextKey[field];
  if (!key) return [];
  let context: JsonRecord;
  try {
    context = asObject(JSON.parse(compactJson));
  } catch {
    return [];
  }
  const rows = Array.isArray(context[key]) ? context[key] as unknown[] : [];
  const expectedCategoryType = field === "category_id" ? state.type : "";
  return [...new Set(rows
    .map(asObject)
    .filter((row) => row.active !== false)
    .filter((row) => !expectedCategoryType || !row.type || row.type === expectedCategoryType)
    .map((row) => typeof row.name === "string"
      ? row.name.trim()
      : typeof row.description === "string" ? row.description.trim() : "")
    .filter((name) => name.length > 0 && name.length <= 100))]
    .slice(0, 30);
}

function deterministicDatedAnswer(message: string, compactJson: string): { message: string; intent: "cash_flow" | "list_transactions" } | null {
  let context: JsonRecord;
  try {
    context = asObject(JSON.parse(compactJson));
  } catch {
    return null;
  }
  const normalized = normalizeText(message);
  const daily = Array.isArray(context.daily_cash_flow) ? context.daily_cash_flow.map(asObject) : [];
  const monthNames: Record<string, string> = {
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
    julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
  };
  const explicitIso = normalized.match(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  const explicitBr = normalized.match(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?:\/((?:19|20)\d{2}))?\b/);
  const namedDay = normalized.match(/\bdia\s+(0?[1-9]|[12]\d|3[01])(?:\s+de\s+([a-z]+))?/);
  const contextYear = String(context.focus_month ?? context.current_date ?? "").slice(0, 4);
  let requestedDate = "";
  if (explicitIso) requestedDate = `${explicitIso[1]}-${explicitIso[2]}-${explicitIso[3]}`;
  else if (explicitBr) requestedDate = `${explicitBr[3] ?? contextYear}-${String(Number(explicitBr[2])).padStart(2, "0")}-${String(Number(explicitBr[1])).padStart(2, "0")}`;
  else if (namedDay) {
    const month = monthNames[namedDay[2] ?? ""] ?? String(context.focus_month ?? "").slice(5, 7);
    if (contextYear && month) requestedDate = `${contextYear}-${month}-${String(Number(namedDay[1])).padStart(2, "0")}`;
  }
  else if (/\b(?:ate\s+)?(?:o\s+)?fim\s+do\s+ano\b/.test(normalized) && contextYear) {
    requestedDate = `${contextYear}-12-31`;
  }

  const money = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
  const asksFutureExpenseByName = /\bquanto\b.*\b(?:vou\s+)?gastar\b/.test(normalized);
  if (asksFutureExpenseByName && requestedDate) {
    const ignoredWords = new Set([
      "quanto", "vou", "gastar", "gasto", "despesa", "despesas", "ate", "fim", "ano", "mes",
      "semana", "semanal", "conta", "minha", "meu", "de", "do", "da", "em", "com", "para", "o", "a",
    ]);
    const requestTokens = new Set((normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !ignoredWords.has(token)));
    const currentDate = String(context.current_date ?? "");
    const candidates = (Array.isArray(context.scenario_candidates) ? context.scenario_candidates : [])
      .map(asObject)
      .map((transaction) => {
        const description = normalizeText(String(transaction.description ?? ""));
        const score = [...requestTokens].filter((token) => description.includes(token)).length;
        return { transaction, description, score };
      })
      .filter(({ transaction, score }) => score > 0
        && String(transaction.type ?? "") === "despesa"
        && String(transaction.status ?? "") !== "paga"
        && String(transaction.scheduled_date ?? "") >= currentDate
        && String(transaction.scheduled_date ?? "") <= requestedDate)
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (best) {
      const bestTokens = new Set(best.description.match(/[a-z0-9]{3,}/g) ?? []);
      const matched = candidates.filter((candidate) => candidate.score === best.score
        || [...bestTokens].some((token) => token.length >= 4 && candidate.description.includes(token)));
      const total = matched.reduce((sum, candidate) => sum + (Number(candidate.transaction.value) || 0), 0);
      const label = String(best.transaction.description ?? "despesa recorrente");
      const displayDate = `${requestedDate.slice(8, 10)}/${requestedDate.slice(5, 7)}/${requestedDate.slice(0, 4)}`;
      return {
        message: `Você ainda gastará ${money(total)} com ${label} até ${displayDate}. O total considera ${matched.length} ${matched.length === 1 ? "lançamento pendente" : "lançamentos pendentes"} já cadastrados no FinFlow.`,
        intent: "list_transactions",
      };
    }
  }
  const row = (requestedDate ? daily.find((item) => String(item.date ?? "") === requestedDate) : null)
    ?? (daily.length === 1 ? daily[0] : null);
  if (!row) return null;
  const date = String(row.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const displayDate = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  const conditionalExclusion = /(nao\s+(?:vou\s+)?(?:gastar|pagar|receber)|\bsem\b|desconsider|retir|exclu)/.test(normalized);
  if (conditionalExclusion) {
    const ignoredWords = new Set([
      "quanto", "conta", "saldo", "sera", "terei", "gastar", "pagar", "receber", "dia", "mes",
      "ano", "nao", "sem", "com", "para", "meu", "minha", "vou", "ter", "de", "do", "da", "em", "e",
    ]);
    const requestTokens = new Set((normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !ignoredWords.has(token)));
    const sourceCandidates = [...new Map([
      ...(Array.isArray(context.scenario_candidates) ? context.scenario_candidates : []),
      ...(Array.isArray(context.relevant_transactions) ? context.relevant_transactions : []),
    ].map((item) => {
      const row = asObject(item);
      return [String(row.id ?? `${row.description}:${row.scheduled_date}`), row] as const;
    })).values()];
    const candidates = sourceCandidates
      .map(asObject)
      .map((transaction) => {
        const description = normalizeText(String(transaction.description ?? ""));
        const descriptionTokens = new Set(description.match(/[a-z0-9]{3,}/g) ?? []);
        const score = [...requestTokens].filter((token) => descriptionTokens.has(token)).length;
        return { transaction, description, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (best) {
      const bestTokens = new Set(best.description.match(/[a-z0-9]{3,}/g) ?? []);
      const matched = candidates.filter((candidate) => (
        candidate.score === best.score
        || [...bestTokens].some((token) => token.length >= 4 && candidate.description.includes(token))
      )).map((candidate) => candidate.transaction)
        .filter((transaction) => String(transaction.status ?? "") !== "paga")
        .filter((transaction) => String(transaction.scheduled_date ?? "") <= date);
      const projectedDelta = matched.reduce((total, transaction) => {
        const value = Number(transaction.value) || 0;
        return total + (String(transaction.type ?? "") === "receita" ? value : -value);
      }, 0);
      if (matched.length > 0) {
        const baseline = Number(row.account_balance) || 0;
        const scenarioBalance = baseline - projectedDelta;
        const label = String(best.transaction.description ?? "lançamento citado");
        const totalRemoved = Math.abs(projectedDelta);
        return {
          message: `Sem ${label}, seu saldo projetado em ${displayDate} seria ${money(scenarioBalance)}. Considerei ${matched.length} ${matched.length === 1 ? "ocorrência pendente" : "ocorrências pendentes"}, somando ${money(totalRemoved)}, que entrariam na projeção até essa data.`,
          intent: "cash_flow",
        };
      }
    }
    return null;
  }
  const asksItems = /(o que|quais|lancamento|agend|programad|calendario|agenda)/.test(normalized);

  if (asksItems) {
    const transactions = (Array.isArray(context.relevant_transactions) ? context.relevant_transactions : [])
      .map(asObject)
      .filter((transaction) => String(transaction.scheduled_date ?? "") === date);
    if (transactions.length === 0) {
      return { message: `Você não possui lançamentos agendados para ${displayDate}.`, intent: "list_transactions" };
    }
    const details = transactions.slice(0, 8).map((transaction) => {
      const type = String(transaction.type ?? "") === "receita" ? "Receita" : "Despesa";
      const status = String(transaction.status ?? "") === "paga" ? "realizada" : "pendente";
      return `${type}: ${String(transaction.description ?? "Lançamento")} — ${money(transaction.value)} (${status})`;
    });
    const suffix = transactions.length > details.length ? ` Além desses, há mais ${transactions.length - details.length}.` : "";
    return { message: `Em ${displayDate}: ${details.join("; ")}.${suffix}`, intent: "list_transactions" };
  }

  if (/(saldo|quanto terei|quanto vou ter|previs)/.test(normalized)) {
    const projected = Boolean(row.balance_is_projection);
    return {
      message: `Em ${displayDate}, seu saldo ${projected ? "projetado" : "realizado"} é ${money(row.account_balance)}.`,
      intent: "cash_flow",
    };
  }
  return null;
}

async function deterministicNamedFutureExpense(
  client: SupabaseClient,
  message: string,
): Promise<{ message: string; intent: "list_transactions" } | null> {
  const normalized = normalizeText(message);
  const match = normalized.match(/\bquanto\b.*?\b(?:vou\s+)?gastar\s+(?:de|com)?\s*([a-z0-9][a-z0-9\s-]*?)(?=\s+ate\b|\s+no\s+restante\b|[?.!]|$)/);
  if (!match) return null;
  const description = match[1].replace(/\b(?:o|a|os|as)\b/g, " ").replace(/\s+/g, " ").trim();
  if (description.length < 2 || description.length > 100) return null;
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const year = currentDate.slice(0, 4);
  const explicitDate = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  const endDate = /\bfim\s+do\s+ano\b/.test(normalized)
    ? `${year}-12-31`
    : explicitDate
      ? `${explicitDate[3] ?? year}-${String(Number(explicitDate[2])).padStart(2, "0")}-${String(Number(explicitDate[1])).padStart(2, "0")}`
      : "";
  if (!endDate || endDate < currentDate) return null;
  const { data, error } = await client.from("transacoes")
    .select("valor,descricao,data_vencimento")
    .eq("tipo", "despesa")
    .neq("status", "paga")
    .gte("data_vencimento", currentDate)
    .lte("data_vencimento", endDate)
    .ilike("descricao", `%${description}%`)
    .order("data_vencimento")
    .limit(500);
  if (error) throw new Error("FINANCIAL_CONTEXT_FAILED");
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0);
  const label = String(rows[0].descricao ?? description).replace(/\s*\[(?:[^\]]+)]\s*/g, " ").trim();
  const displayDate = `${endDate.slice(8, 10)}/${endDate.slice(5, 7)}/${endDate.slice(0, 4)}`;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total);
  return {
    message: `Você ainda gastará ${money} com ${label} até ${displayDate}. O total considera ${rows.length} ${rows.length === 1 ? "lançamento pendente" : "lançamentos pendentes"} já cadastrados no FinFlow.`,
    intent: "list_transactions",
  };
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
  return /^(cancelar?|cancela|desistir|desisto|deixa pra la|esquece|nao quero|vamos falar de outra coisa|quero mudar de assunto)(?:[.!\s]|$)/.test(normalizeText(message));
}

function isLikelyMutationRequest(message: string): boolean {
  const normalized = normalizeText(message);
  if (/\b(como|posso|onde|qual a forma)\b/.test(normalized)) return false;
  if (!/\b(quanto|qual|mostre|liste|compare)\b/.test(normalized)
      && /\b(gastei|paguei|comprei|recebi|ganhei)\b/.test(normalized)
      && /(?:r\$\s*)?\d/.test(normalized)) return true;
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

function aiRolloutMode(): string {
  // Enquanto os planos não estiverem ativos, a IA fica disponível para toda a
  // base. Os modos restritivos continuam disponíveis para uma futura ativação.
  return (optionalSecret("FINFLOW_AI_ROLLOUT_MODE") || "all").toLowerCase();
}

function aiPlansAreEnforced(quota: JsonRecord): boolean {
  return aiRolloutMode() === "plans" && Boolean(quota.limits_enabled);
}

function ensureRolloutAccess(email: string | undefined, quota: JsonRecord): void {
  const limitsEnabled = Boolean(quota.limits_enabled);
  const rollout = aiRolloutMode();
  if (rollout === "all" || rollout === "public") return;
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
  let query = admin.from("ai_conversations").select("id,state").eq("user_id", userId)
    .gte("updated_at", chatRetentionCutoff());
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
    .select("role,content,intent")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .gte("created_at", chatRetentionCutoff())
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(8);
  if (error) throw new Error("AI_HISTORY_FAILED");
  return (data ?? [])
    // Uma recusa de escopo no histórico tende a enviesar o modelo a repetir
    // o mesmo padrão de recusa nas próximas perguntas da conversa, mesmo
    // quando a nova pergunta é claramente válida por si só (regressão real:
    // depois de uma recusa indevida, as perguntas seguintes sobre outros
    // indicadores também passaram a ser recusadas). Sem conteúdo útil para
    // continuidade, omitir do histórico enviado ao modelo.
    .filter((row) => !(row.role === "assistant" && row.intent === "out_of_scope"))
    .reverse()
    .map((row) => ({
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
  marketIndicators?: ClientMarketIndicators | null;
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
    // Mesmo objeto de 7 chaves já exposto ao cliente na resposta ao vivo —
    // nunca o objeto interno maior com valores anteriores (só para o modelo
    // responder "mudou recentemente?"); o check da tabela reforça isso.
    market_indicators: args.marketIndicators ?? null,
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

function executionReferenceState(result: JsonRecord): Record<string, string> {
  const actionType = String(result.action_type ?? "");
  const execution = asObject(result.result);
  if (actionType === "create_transaction" || actionType === "transfer_between_accounts") {
    const ids = Array.isArray(execution.transaction_ids) ? execution.transaction_ids : [];
    const id = Number(ids.at(-1));
    if (Number.isSafeInteger(id) && id > 0) return { __last_transaction_id: String(id) };
  }
  const transactionId = Number(execution.transaction_id);
  if (Number.isSafeInteger(transactionId) && transactionId > 0) {
    return { __last_transaction_id: String(transactionId) };
  }
  return {};
}

function createdTransactionIds(result: JsonRecord): number[] {
  const actionType = String(result.action_type ?? "");
  if (!["create_transaction", "transfer_between_accounts", "move_goal", "pay_invoice"].includes(actionType)) return [];
  const execution = asObject(result.result);
  const candidates = [
    ...(Array.isArray(execution.transaction_ids) ? execution.transaction_ids : []),
    execution.transaction_id,
    execution.payment_transaction_id,
  ];
  return [...new Set(candidates.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

async function handleHistory(admin: AdminClient, userId: string, requestedId?: unknown): Promise<JsonRecord> {
  const conversation = await findConversation(admin, userId, requestedId);
  if (!conversation) return { conversationId: null, messages: [] };
  const { data, error } = await admin.from("ai_messages").select("id,role,content,created_at,intent,market_indicators")
    .eq("user_id", userId).eq("conversation_id", conversation.id)
    .gte("created_at", chatRetentionCutoff())
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) throw new Error("AI_HISTORY_FAILED");
  return {
    conversationId: conversation.id,
    messages: (data ?? []).reverse().map((row) => ({
      id: String(row.id), role: row.role, text: row.content, createdAt: row.created_at, intent: row.intent,
      ...(row.market_indicators ? { marketIndicators: row.market_indicators as ClientMarketIndicators } : {}),
    })),
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
    await purgeExpiredChat(admin, user.id);

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
        const transactionIds = createdTransactionIds(result);
        if (transactionIds.length > 0) {
          const { error: originError } = await admin.from("ai_transaction_origins").upsert(
            transactionIds.map((transactionId) => ({ transaction_id: transactionId, user_id: user.id, source: "ai" })),
            { onConflict: "transaction_id" },
          );
          if (originError) console.error("finance-ai transaction origin", originError.message);
        }
        const conversation = await findConversation(admin, user.id, body.conversationId);
        if (conversation) {
          await updateConversationState(admin, user.id, conversation.id, executionReferenceState(result));
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
    // Respostas curtas como "Carteira", "Alimentação" ou "pendente" não
    // repetem o verbo da solicitação original. Enquanto houver um rascunho
    // de escrita ativo, a conversa precisa continuar no prompt operacional.
    const mutationRequested = isLikelyMutationRequest(message)
      || isDirectAction(existingState.__intent);
    const plansAreEnforced = aiPlansAreEnforced(quota);
    if (analyticsRequested && plansAreEnforced && quota.plan !== "premium") throw new Error("AI_ANALYTICS_PLAN_REQUIRED");
    if (mutationRequested && !hasRemainingActionQuota(quota.remaining)) {
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
    let workflowContextJson: string;
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
      const recentUserContext = storedHistory
        .filter((item) => item.role === "user")
        .slice(-3)
        .map((item) => redactSensitiveText(item.content));
      const semanticMessage = [...recentUserContext, safeMessage].join("\nContinuação do usuário: ");
      const contextRequest = `${semanticMessage}\n${JSON.stringify(safeState)}`.slice(-3_000);
      financialContext = await buildFinancialContext(
        client,
        String(quota.plan ?? "free"),
        plansAreEnforced,
        contextRequest,
        user.id,
        safeMessage,
      );
      const operationalReferences = mutationRequested
        ? await loadOperationalReferences(client)
        : null;
      workflowContextJson = mutationRequested
        ? operationalContext(financialContext.compactJson, operationalReferences!)
        : financialContext.compactJson;
      if (analyticsRequested && !financialContext.analyticsAllowed) throw new Error("AI_ANALYTICS_PLAN_REQUIRED");

      const deterministicContinuation = mutationRequested
        ? resolveDeterministicContinuation(existingState, workflowContextJson, safeMessage)
        : null;
      if (deterministicContinuation) {
        conversation = existingConversation ?? await getOrCreateConversation(admin, user.id, body.conversationId);
        await saveMessage(admin, { userId: user.id, conversationId: conversation.id, role: "user", content: safeMessage });
        await finalizeModelRequest(admin, {
          usageId, provider: "not_called", model: "not_called", inputTokens: 0, outputTokens: 0,
          status: "failed", latencyMs: monitoringLatencyMs(requestStartedAt), errorCode: "AI_DETERMINISTIC_CONTINUATION",
        });
        const nextState = fieldsToPayload(deterministicContinuation.data);
        nextState.__intent = deterministicContinuation.intent;
        await updateConversationState(admin, user.id, conversation.id, nextState);
        await saveMessageBestEffort(admin, {
          userId: user.id, conversationId: conversation.id, role: "assistant",
          content: deterministicContinuation.message, intent: deterministicContinuation.intent,
          provider: "deterministic", model: "finflow-form-v1",
        });
        return json({
          kind: deterministicContinuation.kind,
          conversationId: conversation.id,
          message: deterministicContinuation.message,
          intent: deterministicContinuation.intent,
          missingFields: deterministicContinuation.missing_fields,
          choices: clarificationChoices(workflowContextJson, deterministicContinuation.missing_fields, nextState),
          quota: await getQuota(client),
        }, 200, req);
      }

      const referencedFollowup = mutationRequested
        ? resolveReferencedFollowup(existingState, safeMessage)
        : null;
      if (referencedFollowup) {
        const output = enforceActionWorkflow(referencedFollowup, existingState, workflowContextJson, safeMessage);
        if (output.kind !== "propose_action" || !isDirectAction(output.intent)) throw new Error("INVALID_MODEL_OUTPUT");
        conversation = existingConversation ?? await getOrCreateConversation(admin, user.id, body.conversationId);
        await saveMessage(admin, { userId: user.id, conversationId: conversation.id, role: "user", content: safeMessage });
        await finalizeModelRequest(admin, {
          usageId, provider: "not_called", model: "not_called", inputTokens: 0, outputTokens: 0,
          status: "failed", latencyMs: monitoringLatencyMs(requestStartedAt), errorCode: "AI_DETERMINISTIC_FOLLOWUP",
        });
        const quotaAfterFollowup = await getQuota(client);
        if (!hasRemainingActionQuota(quotaAfterFollowup.remaining)) throw new Error("AI_DAILY_QUOTA_EXCEEDED");
        await updateConversationState(admin, user.id, conversation.id, {});
        const { data, error } = await client.rpc("ai_create_pending_action", {
          p_action_type: output.intent,
          p_payload: fieldsToPayload(output.data),
          p_idempotency_key: `conversation:${conversation.id}:${requestId}`,
          p_ttl_seconds: 600,
        });
        if (error) throw new Error(errorCodeFromRpc(error, "INVALID_REQUEST"));
        const action = normalizeRpcObject(data);
        if (!action.ok || !action.id || !action.confirmation_token) throw new Error(String(action.error_code || "INVALID_REQUEST"));
        const rawPreview = asObject(action.preview);
        const summaryCandidate = typeof rawPreview.summary === "string" ? rawPreview.summary : output.message;
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
        await saveMessageBestEffort(admin, {
          userId: user.id, conversationId: conversation.id, role: "assistant", content: summary,
          intent: output.intent, provider: "deterministic", model: "finflow-followup-v1",
        });
        return json({
          kind: "proposal", conversationId: conversation.id, message: summary, intent: output.intent,
          pendingAction: {
            id: action.id, confirmationToken: action.confirmation_token, actionType: action.action_type,
            expiresAt: action.expires_at, preview,
          },
          quota: quotaAfterFollowup,
        }, 200, req);
      }

      const deterministicAnswer = fallbackProductGuidance(safeMessage)
        ?? await deterministicNamedFutureExpense(client, safeMessage)
        ?? deterministicDatedAnswer(semanticMessage, financialContext.compactJson);
      if (deterministicAnswer) {
        conversation = existingConversation ?? await getOrCreateConversation(admin, user.id, body.conversationId);
        await saveMessage(admin, { userId: user.id, conversationId: conversation.id, role: "user", content: safeMessage });
        await finalizeModelRequest(admin, {
          usageId,
          provider: "not_called",
          model: "not_called",
          inputTokens: 0,
          outputTokens: 0,
          status: "failed",
          latencyMs: monitoringLatencyMs(requestStartedAt),
          errorCode: "AI_DETERMINISTIC_RESPONSE",
        });
        await updateConversationState(admin, user.id, conversation.id, {});
        await saveMessageBestEffort(admin, {
          userId: user.id,
          conversationId: conversation.id,
          role: "assistant",
          content: deterministicAnswer.message,
          intent: deterministicAnswer.intent,
          provider: "deterministic",
          model: "finflow-daily-v1",
        });
        return json({
          kind: "answer",
          conversationId: conversation.id,
          message: deterministicAnswer.message,
          intent: deterministicAnswer.intent,
          quota: await getQuota(client),
        }, 200, req);
      }

      prompt = mutationRequested
        ? buildSystemPrompt({
          financialContext: workflowContextJson,
          conversationState: safeState,
          analyticsAllowed: financialContext.analyticsAllowed,
          outputCanary,
        })
        : buildReadOnlySystemPrompt({
          financialContext: financialContext.compactJson,
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
    const { output: rawOutput } = modelResult;
    let { provider, model } = modelResult;
    let output = enforceActionWorkflow(rawOutput, existingState, workflowContextJson, history.at(-1)?.content ?? "");
    let outputMessage = safeAssistantMessage(output.message, output.intent, output.kind, outputCanary);

    // O modelo (com esforço de raciocínio baixo) às vezes classifica uma
    // pergunta legítima sobre os dados do próprio usuário como fora de
    // escopo na primeira tentativa e acerta ao repetir a mesma pergunta —
    // confirmado em produção pelo usuário. O mesmo vale quando a resposta é
    // kind=answer mas safeAssistantMessage a descarta por violar uma regra
    // de segurança que nem fazia parte do pedido (ex.: uma explicação sobre
    // fundos imobiliários que cita um ticker real como exemplo, o que o
    // guard corretamente bloqueia): sem essa segunda chance, o usuário via
    // a mesma recusa genérica de "fora de escopo" para um tema que está
    // explicitamente dentro do escopo. Uma única tentativa extra, silenciosa,
    // evita que a pessoa precise reenviar manualmente. Fica restrito ao modo
    // somente leitura, onde a regra 1 do prompt já proíbe explicitamente
    // out_of_scope para dados básicos do usuário; mutações têm cota própria
    // e um escopo operacional testado há mais tempo.
    if ((output.kind === "out_of_scope" || !outputMessage) && !mutationRequested) {
      const retryStartedAt = Date.now();
      let retryUsageId: string | null = null;
      try {
        retryUsageId = await reserveModelRequest(admin, user.id, PRE_CONTEXT_MODEL_BUDGET);
        await adjustModelRequest(admin, retryUsageId, estimateModelTokenBudget(prompt, history));
        const retryResult = await requestModel(prompt, history, safetyId);
        await finalizeModelRequest(admin, {
          usageId: retryUsageId,
          provider: retryResult.provider,
          model: retryResult.model,
          inputTokens: retryResult.usage.inputTokens,
          outputTokens: retryResult.usage.outputTokens,
          status: "completed",
          latencyMs: monitoringLatencyMs(retryStartedAt),
          errorCode: null,
        });
        const retryOutput = enforceActionWorkflow(retryResult.output, existingState, workflowContextJson, history.at(-1)?.content ?? "");
        const retryMessage = safeAssistantMessage(retryOutput.message, retryOutput.intent, retryOutput.kind, outputCanary);
        // Só adota a segunda tentativa se ela de fato resolveu o problema
        // (não é out_of_scope e a mensagem passou pelas regras de
        // segurança); caso contrário mantém a resposta original.
        if (retryOutput.kind !== "out_of_scope" && retryMessage) {
          output = retryOutput;
          outputMessage = retryMessage;
          provider = retryResult.provider;
          model = retryResult.model;
        }
      } catch (retryError) {
        if (retryUsageId) {
          await finalizeModelRequest(admin, {
            usageId: retryUsageId,
            provider: "not_called",
            model: "not_called",
            inputTokens: 0,
            outputTokens: 0,
            status: "failed",
            latencyMs: monitoringLatencyMs(retryStartedAt),
            errorCode: monitoringErrorCode(retryError, "AI_PROVIDER_FAILED"),
          }).catch(() => undefined);
        }
        // Tentativa extra é só um bônus best-effort (ex.: cota de mensagens
        // por minuto já consumida pela primeira chamada não pode travar a
        // solicitação): mantém a resposta original.
      }
    }

    const quotaAfterModel = await getQuota(client);

    if (output.kind === "out_of_scope" || !outputMessage) {
      // Diagnóstico temporário: nunca loga conteúdo (mensagem, contexto),
      // só a classificação (kind/intent são enums curtos, não dado
      // sensível) — para distinguir se a recusa veio do próprio modelo
      // (kind=out_of_scope) ou de uma regra de segurança descartando uma
      // resposta kind=answer depois (safeAssistantMessage retornou null).
      console.error("finance-ai scope rejection", JSON.stringify({
        modelKind: output.kind,
        modelIntent: output.intent,
        guardRejectedAnswer: output.kind !== "out_of_scope" && !outputMessage,
      }));
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
      return json({
        kind: "clarify", conversationId: conversation.id, message: outputMessage,
        intent: output.intent, missingFields: output.missing_fields,
        choices: clarificationChoices(workflowContextJson, output.missing_fields, state),
        quota: quotaAfterModel,
      }, 200, req);
    }

    if (output.kind === "answer") {
      await updateConversationState(admin, user.id, conversation.id, {});
      // Indicadores de mercado (Selic/CDI/IPCA) só existem quando a pergunta
      // pediu educação sobre investimentos e a consulta ao BCB deu certo.
      // Expostos à parte da mensagem para o cliente poder desenhar um cartão
      // visual em vez de deixar os números presos no texto corrido. Salvos
      // junto da mensagem para o cartão continuar aparecendo ao recarregar
      // o histórico, não só na resposta ao vivo.
      const marketIndicators = clientMarketIndicators(financialContext.compactJson);
      await saveMessageBestEffort(admin, { userId: user.id, conversationId: conversation.id, role: "assistant", content: outputMessage, intent: output.intent, provider, model, marketIndicators });
      return json({
        kind: "answer", conversationId: conversation.id, message: outputMessage, intent: output.intent, quota: quotaAfterModel,
        ...(marketIndicators ? { marketIndicators } : {}),
      }, 200, req);
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
    const code = extracted === "INVALID_MODEL_OUTPUT" ? "AI_MODEL_WORKFLOW_INVALID" : extracted;
    if (["AI_PROVIDER_FAILED", "AI_CONFIGURATION_FAILED", "AI_HISTORY_FAILED"].includes(code)) console.error("finance-ai", original);
    return json({ error: code, message: publicErrorMessage(code) }, errorStatus(code), req);
  }
});
