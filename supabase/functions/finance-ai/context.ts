import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import { redactSensitiveText } from "./guard.ts";
export { redactSensitiveText } from "./guard.ts";

export type FinancialRow = Record<string, unknown>;
type DetailResult = {
  rows: FinancialRow[];
  queryScope: "not_requested" | "bounded_relevance";
};

const TRANSACTION_DETAIL_LIMIT = 60;
const PERIOD_DETAIL_LIMIT = 80;
const SEARCH_DETAIL_LIMIT = 24;
const INVOICE_DETAIL_LIMIT = 80;
const ACCOUNT_LIMIT = 500;
const CATEGORY_LIMIT = 500;
const GOAL_LIMIT = 500;
const CARD_LIMIT = 200;
// Mantém os agregados e os recursos mais relevantes dentro do teto de 8K TPM
// da Groq. Quando necessário, os sinalizadores dataset_complete orientam a IA a
// pedir um filtro em vez de inventar uma conclusão abrangente.
export const MAX_PROVIDER_CONTEXT_CHARS = 4_000;
const ACCOUNT_TRANSFER_DESTINATION = /\s*\[Destino:(\d+)\]\s*$/;
const GOAL_TRANSFER = /\[Objetivo:(\d+):(guardar|resgatar)\]\s*$/;
const SERIES_METADATA = /\[Serie:([A-Za-z0-9_-]+)\]/;
const INVOICE_PAYMENT_METADATA = /\[PagFatura:(\d+):(\d{4}-\d{2}):([^:\]]+)(?::(\d+))?\]/;
const INTERNAL_METADATA = /\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:\d+|Objetivo:\d+:(?:guardar|resgatar)|PagFatura:[^\]]+)\]\s*)+$/;
const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "eu",
  "me", "meu", "minha", "no", "nos", "na", "nas", "o", "os", "ou", "para", "por", "que",
  "quero", "se", "um", "uma", "valor", "conta", "categoria", "objetivo", "cartao", "fatura",
  "lancamento", "transacao", "despesa", "receita", "transferencia", "editar", "excluir", "apagar",
  "criar", "mostrar", "listar", "qual", "quanto", "quando",
]);
const MONTHS_PT: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

function text(value: unknown, max = 120): string {
  return redactSensitiveText(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function activeFlag(value: unknown, defaultValue = true): boolean {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  return !["0", "false", "f"].includes(normalized);
}

function normalize(value: unknown, max = 3_000): string {
  return redactSensitiveText(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .slice(0, max)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function visibleDescription(value: unknown): string {
  return text(value, 400)
    .replace(INTERNAL_METADATA, "")
    .replace(/^\[Transf\.\]\s*/, "")
    .trim();
}

function isInternalTransfer(description: string): boolean {
  return description.includes("[Transf.]");
}

function isInvoicePayment(description: string): boolean {
  return INVOICE_PAYMENT_METADATA.test(description);
}

function effectiveDate(transaction: FinancialRow): string {
  return transaction.status === "paga"
    ? text(transaction.data_realizacao || transaction.data_vencimento, 10)
    : text(transaction.data_vencimento, 10);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function endOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentDateInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function selectedMonth(request: string, fallback: string): string {
  const normalized = normalize(request);
  const explicit = normalized.match(/\b(19\d{2}|20\d{2})-(0[1-9]|1[0-2])\b/);
  if (explicit) return `${explicit[1]}-${explicit[2]}`;
  const year = normalized.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? fallback.slice(0, 4);
  for (const [name, month] of Object.entries(MONTHS_PT)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) return `${year}-${month}`;
  }
  return fallback;
}

async function selectOrThrow<T = FinancialRow[]>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`FINANCIAL_CONTEXT_FAILED:${error.message}`);
  return (data ?? []) as T;
}

const TRANSACTION_FIELDS = "id,tipo,valor,descricao,status,categoria_id,conta_id,data_vencimento,data_realizacao,user_id";
const INVOICE_FIELDS = "id,cartao_id,categoria_id,descricao,valor,data_compra,mes_fatura,pago,parcela_atual,total_parcelas,grupo_parcela_id";

function mergeRows(groups: FinancialRow[][], maximum: number): FinancialRow[] {
  const rows = new Map<number, FinancialRow>();
  for (const group of groups) {
    for (const row of group) {
      const id = number(row.id);
      if (id > 0 && !rows.has(id)) rows.set(id, row);
      if (rows.size >= maximum) return [...rows.values()];
    }
  }
  return [...rows.values()];
}

function safeSearchTerms(request: string): string[] {
  const words = redactSensitiveText(request).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const unique = new Map<string, string>();
  for (const word of words) {
    const key = normalize(word, 80);
    if (!STOP_WORDS.has(key) && !unique.has(key)) unique.set(key, word.slice(0, 80));
    if (unique.size >= 3) break;
  }
  return [...unique.values()];
}

function explicitResourceIds(request: string, resource: "transaction" | "invoice_item"): number[] {
  const keys = resource === "transaction"
    ? ["transaction_id", "transacao_id", "lancamento_id"]
    : ["purchase_id", "item_id", "compra_id"];
  const result = new Set<number>();
  for (const key of keys) {
    const expression = new RegExp(`(?:"${key}"\\s*:\\s*"?|\\b${key}\\s*[=:]\\s*)(\\d{1,15})`, "gi");
    for (const match of request.matchAll(expression)) result.add(Number(match[1]));
  }
  const label = resource === "transaction"
    ? /\b(?:transa[cç][aã]o|lan[cç]amento)\s*#?\s*(\d{1,15})\b/gi
    : /\b(?:compra|item)\s*#?\s*(\d{1,15})\b/gi;
  for (const match of request.matchAll(label)) result.add(Number(match[1]));
  return [...result].filter(Number.isSafeInteger).slice(0, 20);
}

async function fetchTransactionDetails(
  client: SupabaseClient,
  request: string,
  focusMonth: string,
  enabled: boolean,
): Promise<DetailResult> {
  if (!enabled) return { rows: [], queryScope: "not_requested" };
  const monthEnd = endOfMonth(focusMonth);
  const ids = explicitResourceIds(request, "transaction");
  const searches = safeSearchTerms(request);
  const queries: PromiseLike<{ data: FinancialRow[] | null; error: { message: string } | null }>[] = [
    client.from("transacoes").select(TRANSACTION_FIELDS)
      .order("id", { ascending: false })
      .limit(TRANSACTION_DETAIL_LIMIT),
    client.from("transacoes").select(TRANSACTION_FIELDS)
      .gte("data_vencimento", `${focusMonth}-01`).lte("data_vencimento", monthEnd)
      .order("data_vencimento", { ascending: false }).order("id", { ascending: false })
      .limit(PERIOD_DETAIL_LIMIT),
    client.from("transacoes").select(TRANSACTION_FIELDS)
      .eq("status", "paga").gte("data_realizacao", `${focusMonth}-01`).lte("data_realizacao", monthEnd)
      .order("data_realizacao", { ascending: false }).order("id", { ascending: false })
      .limit(PERIOD_DETAIL_LIMIT),
  ];
  if (ids.length > 0) {
    queries.push(client.from("transacoes").select(TRANSACTION_FIELDS).in("id", ids).limit(ids.length));
  }
  for (const term of searches) {
    queries.push(client.from("transacoes").select(TRANSACTION_FIELDS)
      .ilike("descricao", `%${term}%`).order("data_vencimento", { ascending: false })
      .limit(SEARCH_DETAIL_LIMIT));
  }
  const groups = await Promise.all(queries.map((query) => selectOrThrow(query)));
  return {
    rows: mergeRows(groups, 320),
    queryScope: "bounded_relevance",
  };
}

async function fetchInvoiceDetails(
  client: SupabaseClient,
  request: string,
  focusMonth: string,
  enabled: boolean,
): Promise<DetailResult> {
  if (!enabled) return { rows: [], queryScope: "not_requested" };
  const ids = explicitResourceIds(request, "invoice_item");
  const searches = safeSearchTerms(request);
  const queries: PromiseLike<{ data: FinancialRow[] | null; error: { message: string } | null }>[] = [
    client.from("fatura_itens").select(INVOICE_FIELDS)
      .order("mes_fatura", { ascending: false }).order("id", { ascending: false })
      .limit(INVOICE_DETAIL_LIMIT),
    client.from("fatura_itens").select(INVOICE_FIELDS)
      .eq("mes_fatura", focusMonth).order("id", { ascending: false })
      .limit(INVOICE_DETAIL_LIMIT),
  ];
  if (ids.length > 0) {
    queries.push(client.from("fatura_itens").select(INVOICE_FIELDS).in("id", ids).limit(ids.length));
  }
  for (const term of searches) {
    queries.push(client.from("fatura_itens").select(INVOICE_FIELDS)
      .ilike("descricao", `%${term}%`).order("mes_fatura", { ascending: false })
      .limit(SEARCH_DETAIL_LIMIT));
  }
  const groups = await Promise.all(queries.map((query) => selectOrThrow(query)));
  return {
    rows: mergeRows(groups, 240),
    queryScope: "bounded_relevance",
  };
}

function queryTokens(request: string): string[] {
  return [...new Set(normalize(request)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))]
    .slice(0, 12);
}

function matchesRequest(
  row: FinancialRow,
  tokens: string[],
  request: string,
  relatedText = "",
): boolean {
  if (tokens.length === 0) return false;
  const haystack = normalize([
    row.id,
    row.descricao,
    row.nome,
    row.data_vencimento,
    row.data_realizacao,
    row.data_compra,
    row.mes_fatura,
    relatedText,
  ].join(" "));
  const numericIds: string[] = request.match(/\b\d{1,18}\b/g) ?? [];
  if (numericIds.includes(String(row.id))) return true;
  return tokens.some((token) => haystack.includes(token));
}

function selectedYears(request: string, currentYear: number): Set<number> {
  const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
  for (const match of request.matchAll(/\b(20\d{2}|19\d{2})\b/g)) {
    years.add(Number(match[1]));
    if (years.size >= 6) break;
  }
  return years;
}

export function selectRelevantRows(
  rows: FinancialRow[],
  isActive: (row: FinancialRow) => boolean,
  baselineLimit: number,
  maximum: number,
  tokens: string[],
  request: string,
): FinancialRow[] {
  const selected = new Map<number, FinancialRow>();
  const activeRows = rows.filter(isActive);
  // Correspondências explícitas entram primeiro: o serializador reduz arrays
  // pelo fim, portanto o recurso citado continua presente mesmo no teto reduzido.
  // A busca percorre também arquivados para viabilizar as intents reactivate_*;
  // somente o baseline automático permanece restrito aos recursos ativos.
  for (const row of rows) {
    if (selected.size >= maximum) break;
    if (matchesRequest(row, tokens, request)) selected.set(number(row.id), row);
  }
  for (const row of activeRows.slice(0, baselineLimit)) {
    if (selected.size >= maximum) break;
    selected.set(number(row.id), row);
  }
  return [...selected.values()];
}

function informationalRequest(request: string): boolean {
  const normalized = normalize(request);
  return /\b(o que e|como funciona|explique|qual a diferenca|para que serve)\b/.test(normalized)
    && !/\b(meu|minha|meus|minhas|saldo|lanc|gasto|recebi|paguei|crie|criar|edite|exclua|apague)\b/.test(normalized);
}

function goalsByNormalizedName(goals: FinancialRow[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const goal of goals) {
    const name = normalize(goal.nome);
    const id = number(goal.id);
    const current = result.get(name);
    // Transferências legadas não carregam ID. O menor ID torna a resolução
    // estável e evita que objetivos homônimos dupliquem a movimentação.
    if (name && id > 0 && (current == null || id < current)) result.set(name, id);
  }
  return result;
}

type GoalMovement = {
  goalId: number | null;
  operation: "guardar" | "resgatar";
  legacyName: string | null;
};

function parseGoalMovement(description: string): GoalMovement | null {
  const marker = description.match(GOAL_TRANSFER);
  if (marker) {
    return {
      goalId: Number(marker[1]),
      operation: marker[2] as GoalMovement["operation"],
      legacyName: null,
    };
  }
  if (!isInternalTransfer(description)) return null;
  const cleaned = visibleDescription(description)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
  const legacy = cleaned.match(/^(Guardar em|Resgate de):\s*(.+)$/i);
  if (!legacy) return null;
  return {
    goalId: null,
    operation: normalize(legacy[1]).startsWith("guardar") ? "guardar" : "resgatar",
    legacyName: text(legacy[2], 120),
  };
}

type InvoicePayment = {
  cardId: number;
  invoiceMonth: string;
  mode: string;
  linkedItemId: number | null;
};

function parseInvoicePayment(description: string): InvoicePayment | null {
  const marker = description.match(INVOICE_PAYMENT_METADATA);
  if (!marker) return null;
  return {
    cardId: Number(marker[1]),
    invoiceMonth: marker[2],
    mode: text(marker[3], 40),
    linkedItemId: marker[4] ? Number(marker[4]) : null,
  };
}

type ScopedEvent = {
  row: FinancialRow;
  accountId: number;
  sourceAccountId: number;
  destinationAccountId: number | null;
  type: "receita" | "despesa";
  value: number;
  delta: number;
  status: string;
  date: string;
  accountTransfer: boolean;
  goalTransfer: boolean;
  goalId: number | null;
  goalOperation: GoalMovement["operation"] | null;
  invoicePayment: boolean;
};

function eventFromRow(
  row: FinancialRow,
  accountId: number,
  type: ScopedEvent["type"],
  metadata: Partial<ScopedEvent> = {},
): ScopedEvent {
  const value = number(row.valor);
  return {
    row,
    accountId,
    sourceAccountId: number(row.conta_id),
    destinationAccountId: null,
    type,
    value,
    delta: type === "receita" ? value : -value,
    status: text(row.status, 20),
    date: effectiveDate(row),
    accountTransfer: false,
    goalTransfer: false,
    goalId: null,
    goalOperation: null,
    invoicePayment: false,
    ...metadata,
  };
}

export function buildScopedBalanceEvents(
  transactions: FinancialRow[],
  accountIds: Iterable<number>,
  goals: FinancialRow[] = [],
): ScopedEvent[] {
  const scope = new Set(accountIds);
  const goalsByName = goalsByNormalizedName(goals);
  const events: ScopedEvent[] = [];
  const pairedLegacyRowsInsideScope = new Set<number>();
  const legacyGroups = new Map<string, { income: FinancialRow[]; expenses: FinancialRow[] }>();

  // Transferências antigas eram gravadas em duas linhas. Quando as duas contas
  // pertencem ao escopo, elas se anulam também nas barras; quando apenas uma
  // ponta pertence ao escopo, a linha selecionada representa a fronteira.
  for (const row of transactions) {
    const description = text(row.descricao, 500);
    if (
      !isInternalTransfer(description)
      || description.match(ACCOUNT_TRANSFER_DESTINATION)
      || parseGoalMovement(description)
    ) continue;
    const key = [
      normalize(visibleDescription(description)),
      number(row.valor),
      text(row.status, 20),
      text(row.data_vencimento, 10),
      text(row.data_realizacao, 10),
    ].join("|");
    const group = legacyGroups.get(key) ?? { income: [], expenses: [] };
    if (row.tipo === "receita") group.income.push(row);
    else group.expenses.push(row);
    legacyGroups.set(key, group);
  }
  for (const group of legacyGroups.values()) {
    group.income.sort((a, b) => number(a.id) - number(b.id));
    group.expenses.sort((a, b) => number(a.id) - number(b.id));
    const pairs = Math.min(group.income.length, group.expenses.length);
    for (let index = 0; index < pairs; index += 1) {
      const income = group.income[index];
      const expense = group.expenses[index];
      if (scope.has(number(income.conta_id)) && scope.has(number(expense.conta_id))) {
        pairedLegacyRowsInsideScope.add(number(income.id));
        pairedLegacyRowsInsideScope.add(number(expense.id));
      }
    }
  }

  for (const row of transactions) {
    const sourceAccountId = number(row.conta_id);
    const description = text(row.descricao, 500);
    const destinationMatch = description.match(ACCOUNT_TRANSFER_DESTINATION);
    const goalMovement = parseGoalMovement(description);

    if (destinationMatch) {
      const destinationAccountId = Number(destinationMatch[1]);
      const sourceSelected = scope.has(sourceAccountId);
      const destinationSelected = scope.has(destinationAccountId);
      if (sourceSelected === destinationSelected) continue;
      if (sourceSelected) {
        events.push(eventFromRow(row, sourceAccountId, "despesa", {
          destinationAccountId,
          accountTransfer: true,
        }));
      } else {
        events.push(eventFromRow(row, destinationAccountId, "receita", {
          destinationAccountId,
          accountTransfer: true,
        }));
      }
      continue;
    }

    if (goalMovement) {
      if (!scope.has(sourceAccountId)) continue;
      const goalId = goalMovement.goalId
        ?? (goalMovement.legacyName ? goalsByName.get(normalize(goalMovement.legacyName)) ?? null : null);
      const type = goalMovement.operation === "guardar" ? "despesa" : "receita";
      events.push(eventFromRow(row, sourceAccountId, type, {
        goalTransfer: true,
        goalId,
        goalOperation: goalMovement.operation,
      }));
      continue;
    }

    if (!scope.has(sourceAccountId)) continue;
    if (pairedLegacyRowsInsideScope.has(number(row.id))) continue;
    const type = row.tipo === "receita" ? "receita" : "despesa";
    events.push(eventFromRow(row, sourceAccountId, type, {
      accountTransfer: isInternalTransfer(description),
      invoicePayment: isInvoicePayment(description),
    }));
  }
  return events;
}

export function calculateAccountBalances(
  accounts: FinancialRow[],
  transactions: FinancialRow[],
): Map<number, number> {
  const balances = new Map(accounts.map((account) => [number(account.id), number(account.saldo_inicial)]));
  for (const row of transactions) {
    if (row.status !== "paga") continue;
    const sourceAccountId = number(row.conta_id);
    const description = text(row.descricao, 500);
    const value = number(row.valor);
    const destination = description.match(ACCOUNT_TRANSFER_DESTINATION)?.[1];
    const goalMovement = parseGoalMovement(description);

    if (destination) {
      if (balances.has(sourceAccountId)) {
        balances.set(sourceAccountId, (balances.get(sourceAccountId) ?? 0) - value);
      }
      const destinationAccountId = Number(destination);
      if (balances.has(destinationAccountId)) {
        balances.set(destinationAccountId, (balances.get(destinationAccountId) ?? 0) + value);
      }
      continue;
    }

    if (goalMovement) {
      if (!balances.has(sourceAccountId)) continue;
      const delta = goalMovement.operation === "guardar" ? -value : value;
      balances.set(sourceAccountId, (balances.get(sourceAccountId) ?? 0) + delta);
      continue;
    }

    if (!balances.has(sourceAccountId)) continue;
    const delta = row.tipo === "receita" ? value : -value;
    balances.set(sourceAccountId, (balances.get(sourceAccountId) ?? 0) + delta);
  }
  for (const [id, balance] of balances) balances.set(id, number(balance));
  return balances;
}

type MonthFlow = {
  month: string;
  realized_income: number;
  realized_expense: number;
  pending_income: number;
  pending_expense: number;
  account_balance: number;
  balance_is_projection: boolean;
};

type CategorySummary = {
  category_id: number | null;
  name: string;
  type: "receita" | "despesa";
  actual: number;
  forecast: number;
};

type InvoiceSummary = {
  card_id: number;
  invoice_month: string;
  open: number;
  closed_items_total: number;
  payments_total: number;
};

type CardMetric = {
  card_id: number;
  used_limit: number;
  available_limit: number;
  displayed_invoice_month: string;
  displayed_invoice_open: number;
};

export type FinancialSnapshotInput = {
  accounts: FinancialRow[];
  categories: FinancialRow[];
  goals?: FinancialRow[];
  cards?: FinancialRow[];
  transactions: FinancialRow[];
  invoiceItems?: FinancialRow[];
  currentDate: string;
  focusMonth?: string;
  years?: Iterable<number>;
  analyticsAllowed?: boolean;
  scopeAccountIds?: Iterable<number>;
};

export type FinancialSnapshot = {
  accountBalances: Map<number, number>;
  globalActiveBalance: number;
  scopeAccountIds: number[];
  currentBalance: number;
  predictedEndBalance: number;
  dashboardFlow: Omit<MonthFlow, "account_balance" | "balance_is_projection">;
  monthlyCashFlow: MonthFlow[];
  categoriesByYear: { year: number; income: CategorySummary[]; expenses: CategorySummary[] }[];
  cardPurchasesByMonth: Map<string, number>;
  goalForecasts: Map<number, { expectedByYearEnd: number; expectedByTargetDate: number | null }>;
  invoiceSummaries: InvoiceSummary[];
  cardMetrics: Map<number, CardMetric>;
};

function emptyFlow(month: string): Omit<MonthFlow, "account_balance" | "balance_is_projection"> {
  return { month, realized_income: 0, realized_expense: 0, pending_income: 0, pending_expense: 0 };
}

function addEventToFlow(
  flow: Omit<MonthFlow, "account_balance" | "balance_is_projection">,
  event: ScopedEvent,
): void {
  const pending = event.status !== "paga";
  if (event.type === "receita") {
    if (pending) flow.pending_income += event.value;
    else flow.realized_income += event.value;
  } else if (pending) flow.pending_expense += event.value;
  else flow.realized_expense += event.value;
}

function isSyntheticInvoiceLedgerItem(item: FinancialRow): boolean {
  const description = normalize(item.descricao);
  const noCategory = item.categoria_id == null;
  return noCategory && (
    (description === "pagamento parcial da fatura" && number(item.valor) < 0)
    || description.startsWith("saldo da fatura anterior (")
  );
}

export function calculateFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const goals = input.goals ?? [];
  const cards = input.cards ?? [];
  const invoiceItems = input.invoiceItems ?? [];
  const currentMonth = input.currentDate.slice(0, 7);
  const focusMonth = input.focusMonth ?? currentMonth;
  const activeAccountIds = new Set(
    input.accounts.filter((account) => !activeFlag(account.arquivado, false)).map((account) => number(account.id)),
  );
  const requestedScope = input.scopeAccountIds ? new Set(input.scopeAccountIds) : activeAccountIds;
  const scopeAccountIds = [...requestedScope].filter((id) => input.accounts.some((account) => number(account.id) === id));
  const scope = new Set(scopeAccountIds);
  const yearSet = new Set(input.years ?? [Number(currentMonth.slice(0, 4))]);
  yearSet.add(Number(focusMonth.slice(0, 4)));

  const accountBalances = calculateAccountBalances(input.accounts, input.transactions);
  const globalActiveBalance = number([...activeAccountIds].reduce(
    (sum, id) => sum + (accountBalances.get(id) ?? 0),
    0,
  ));
  const initialBalance = input.accounts.reduce(
    (sum, account) => sum + (scope.has(number(account.id)) ? number(account.saldo_inicial) : 0),
    0,
  );
  const events = buildScopedBalanceEvents(input.transactions, scope, goals);
  const currentBalance = number(initialBalance + events.reduce(
    (sum, event) => sum + (event.status === "paga" ? event.delta : 0),
    0,
  ));
  const focusEnd = endOfMonth(focusMonth);
  const predictedEndBalance = number(initialBalance + events.reduce((sum, event) => (
    validDate(event.date) && event.date <= focusEnd ? sum + event.delta : sum
  ), 0));

  const dashboardFlow = emptyFlow(focusMonth);
  for (const event of events) {
    if (!validDate(event.date) || !event.date.startsWith(`${focusMonth}-`)) continue;
    if (event.goalTransfer || event.invoicePayment) continue;
    addEventToFlow(dashboardFlow, event);
  }

  const flows = new Map<string, Omit<MonthFlow, "account_balance" | "balance_is_projection">>();
  for (const year of [...yearSet].sort((a, b) => a - b)) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      flows.set(key, emptyFlow(key));
    }
  }
  for (const event of events) {
    if (event.goalTransfer || !validDate(event.date)) continue;
    const month = event.date.slice(0, 7);
    const flow = flows.get(month);
    if (flow) addEventToFlow(flow, event);
  }

  const paidEvents = events.filter((event) => event.status === "paga" && validDate(event.date));
  const pendingEvents = events.filter((event) => event.status !== "paga" && validDate(event.date));
  const monthlyCashFlow = [...flows.values()].map((flow) => {
    const monthEnd = endOfMonth(flow.month);
    const isPast = flow.month < currentMonth;
    const balance = isPast
      ? initialBalance + paidEvents.reduce((sum, event) => event.date <= monthEnd ? sum + event.delta : sum, 0)
      : currentBalance + pendingEvents.reduce((sum, event) => event.date <= monthEnd ? sum + event.delta : sum, 0);
    return {
      ...flow,
      realized_income: number(flow.realized_income),
      realized_expense: number(flow.realized_expense),
      pending_income: number(flow.pending_income),
      pending_expense: number(flow.pending_expense),
      account_balance: number(balance),
      balance_is_projection: !isPast && (
        flow.month !== currentMonth || pendingEvents.some((event) => event.date <= monthEnd)
      ),
    };
  });

  const categoryById = new Map(input.categories.map((category) => [number(category.id), text(category.nome)]));
  const categoryTotals = new Map<string, CategorySummary & { year: number }>();
  const cardPurchasesByMonth = new Map<string, number>();
  const addCategory = (
    year: number,
    categoryId: number | null,
    type: CategorySummary["type"],
    value: number,
    actual: boolean,
  ) => {
    if (!yearSet.has(year)) return;
    const key = `${year}:${type}:${categoryId ?? "none"}`;
    const summary = categoryTotals.get(key) ?? {
      year,
      category_id: categoryId,
      name: categoryId == null ? "Sem categoria" : categoryById.get(categoryId) ?? "Sem categoria",
      type,
      actual: 0,
      forecast: 0,
    };
    summary.forecast += value;
    if (actual) summary.actual += value;
    categoryTotals.set(key, summary);
  };

  const allActiveSelected = scope.size === activeAccountIds.size
    && [...activeAccountIds].every((id) => scope.has(id));
  if (input.analyticsAllowed !== false) {
    for (const event of events) {
      if (event.accountTransfer || event.goalTransfer || event.invoicePayment || !validDate(event.date)) continue;
      const categoryId = event.row.categoria_id == null ? null : number(event.row.categoria_id);
      addCategory(Number(event.date.slice(0, 4)), categoryId, event.type, event.value, event.status === "paga");
    }
  }
  if (allActiveSelected) {
    for (const item of invoiceItems) {
      if (isSyntheticInvoiceLedgerItem(item)) continue;
      const purchaseDate = text(item.data_compra, 10);
      if (!validDate(purchaseDate)) continue;
      const purchaseMonth = purchaseDate.slice(0, 7);
      cardPurchasesByMonth.set(
        purchaseMonth,
        number((cardPurchasesByMonth.get(purchaseMonth) ?? 0) + number(item.valor)),
      );
      if (input.analyticsAllowed !== false) {
        const categoryId = item.categoria_id == null ? null : number(item.categoria_id);
        addCategory(Number(purchaseDate.slice(0, 4)), categoryId, "despesa", number(item.valor), true);
      }
    }
  }

  const categoriesByYear = [...yearSet].sort((a, b) => a - b).map((year) => {
    const values = [...categoryTotals.values()].filter((item) => item.year === year);
    const compact = (type: CategorySummary["type"]) => values
      .filter((item) => item.type === type)
      .sort((a, b) => b.forecast - a.forecast || b.actual - a.actual || a.name.localeCompare(b.name, "pt-BR"))
      .map((item) => ({
        category_id: item.category_id,
        name: item.name,
        type: item.type,
        actual: number(item.actual),
        forecast: number(item.forecast),
      }));
    return { year, income: compact("receita"), expenses: compact("despesa") };
  });

  const goalsByName = goalsByNormalizedName(goals);
  const goalForecasts = new Map<number, { expectedByYearEnd: number; expectedByTargetDate: number | null }>();
  for (const goal of goals) {
    const goalId = number(goal.id);
    const balance = number(goal.saldo_atual);
    const targetDate = goal.data_prazo ? text(goal.data_prazo, 10) : null;
    const endOfYear = `${input.currentDate.slice(0, 4)}-12-31`;
    let byYearEnd = 0;
    let byTarget = 0;
    for (const transaction of input.transactions) {
      if (transaction.status === "paga") continue;
      const movement = parseGoalMovement(text(transaction.descricao, 500));
      if (!movement || movement.operation !== "guardar") continue;
      const movementGoalId = movement.goalId
        ?? (movement.legacyName ? goalsByName.get(normalize(movement.legacyName)) ?? null : null);
      if (movementGoalId !== goalId) continue;
      const scheduled = text(transaction.data_vencimento, 10);
      if (!validDate(scheduled)) continue;
      if (scheduled <= endOfYear) byYearEnd += number(transaction.valor);
      if (targetDate && scheduled <= targetDate) byTarget += number(transaction.valor);
    }
    goalForecasts.set(goalId, {
      expectedByYearEnd: number(balance + byYearEnd),
      expectedByTargetDate: targetDate && targetDate >= input.currentDate && byTarget > 0
        ? number(balance + byTarget)
        : null,
    });
  }

  const invoiceSummaryMap = new Map<string, InvoiceSummary>();
  for (const item of invoiceItems) {
    const invoiceMonth = text(item.mes_fatura, 7);
    if (!/^\d{4}-\d{2}$/.test(invoiceMonth)) continue;
    const cardId = number(item.cartao_id);
    const key = `${cardId}:${invoiceMonth}`;
    const summary = invoiceSummaryMap.get(key) ?? {
      card_id: cardId,
      invoice_month: invoiceMonth,
      open: 0,
      closed_items_total: 0,
      payments_total: 0,
    };
    if (activeFlag(item.pago, false)) summary.closed_items_total += number(item.valor);
    else summary.open += number(item.valor);
    invoiceSummaryMap.set(key, summary);
  }
  for (const transaction of input.transactions) {
    if (transaction.status !== "paga") continue;
    const payment = parseInvoicePayment(text(transaction.descricao, 500));
    if (!payment) continue;
    const key = `${payment.cardId}:${payment.invoiceMonth}`;
    const summary = invoiceSummaryMap.get(key) ?? {
      card_id: payment.cardId,
      invoice_month: payment.invoiceMonth,
      open: 0,
      closed_items_total: 0,
      payments_total: 0,
    };
    summary.payments_total += number(transaction.valor);
    invoiceSummaryMap.set(key, summary);
  }
  const invoiceSummaries = [...invoiceSummaryMap.values()].map((summary) => ({
    ...summary,
    open: number(summary.open),
    closed_items_total: number(summary.closed_items_total),
    payments_total: number(summary.payments_total),
  }));

  const cardMetrics = new Map<number, CardMetric>();
  for (const card of cards) {
    const cardId = number(card.id);
    const limit = number(card.limite);
    const usedLimit = number(invoiceItems.reduce((sum, item) => {
      if (number(item.cartao_id) !== cardId || activeFlag(item.pago, false)) return sum;
      const invoiceMonth = text(item.mes_fatura, 7);
      if (invoiceMonth < currentMonth) return sum;
      const fixedOutsideCurrent = text(item.descricao, 300).endsWith("(Fixa)") && invoiceMonth !== currentMonth;
      return fixedOutsideCurrent ? sum : sum + number(item.valor);
    }, 0));
    const currentItems = invoiceItems.filter((item) => (
      number(item.cartao_id) === cardId && text(item.mes_fatura, 7) === currentMonth
    ));
    const currentOpen = number(currentItems.reduce(
      (sum, item) => activeFlag(item.pago, false) ? sum : sum + number(item.valor),
      0,
    ));
    const currentPaidOrZero = currentItems.length === 0
      || currentOpen === 0
      || currentItems.every((item) => activeFlag(item.pago, false));
    const displayedInvoiceMonth = currentPaidOrZero ? nextMonth(currentMonth) : currentMonth;
    const displayedInvoiceOpen = number(invoiceItems.reduce((sum, item) => (
      number(item.cartao_id) === cardId
        && text(item.mes_fatura, 7) === displayedInvoiceMonth
        && !activeFlag(item.pago, false)
        ? sum + number(item.valor)
        : sum
    ), 0));
    cardMetrics.set(cardId, {
      card_id: cardId,
      used_limit: usedLimit,
      available_limit: number(Math.max(0, limit - usedLimit)),
      displayed_invoice_month: displayedInvoiceMonth,
      displayed_invoice_open: displayedInvoiceOpen,
    });
  }

  return {
    accountBalances,
    globalActiveBalance,
    scopeAccountIds,
    currentBalance,
    predictedEndBalance,
    dashboardFlow: {
      ...dashboardFlow,
      realized_income: number(dashboardFlow.realized_income),
      realized_expense: number(dashboardFlow.realized_expense),
      pending_income: number(dashboardFlow.pending_income),
      pending_expense: number(dashboardFlow.pending_expense),
    },
    monthlyCashFlow,
    categoriesByYear,
    cardPurchasesByMonth,
    goalForecasts,
    invoiceSummaries,
    cardMetrics,
  };
}

export type AggregatedFinancialSnapshot = {
  snapshot: FinancialSnapshot;
  aggregateComplete: boolean;
  sourceCounts: { transactions: number; invoiceItems: number };
  calculationVersion: number;
};

function aggregateRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`FINANCIAL_CONTEXT_AGGREGATE_INVALID:${label}`);
  }
  return value as Record<string, unknown>;
}

function aggregateRows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`FINANCIAL_CONTEXT_AGGREGATE_INVALID:${label}`);
  return value.map((row, index) => aggregateRecord(row, `${label}[${index}]`));
}

/**
 * Converte o contrato JSON da RPC em exatamente a mesma estrutura usada pelo
 * cálculo determinístico local. Não existe fallback para a antiga varredura:
 * um contrato incompleto falha de forma explícita, evitando responder com
 * totais parciais apresentados como verdadeiros.
 */
export function financialSnapshotFromAggregate(value: unknown): AggregatedFinancialSnapshot {
  const root = aggregateRecord(value, "root");
  const calculationVersion = number(root.calculation_version);
  if (calculationVersion !== 1 || root.complete !== true) {
    throw new Error("FINANCIAL_CONTEXT_AGGREGATE_INCOMPLETE");
  }
  const dashboard = aggregateRecord(root.dashboard_flow, "dashboard_flow");
  const counts = aggregateRecord(root.source_counts, "source_counts");
  const accountBalances = new Map<number, number>();
  for (const row of aggregateRows(root.account_balances, "account_balances")) {
    accountBalances.set(number(row.account_id), number(row.balance));
  }
  const cardPurchasesByMonth = new Map<string, number>();
  for (const row of aggregateRows(root.card_purchases_by_month, "card_purchases_by_month")) {
    cardPurchasesByMonth.set(text(row.month, 7), number(row.total));
  }
  const goalForecasts = new Map<number, { expectedByYearEnd: number; expectedByTargetDate: number | null }>();
  for (const row of aggregateRows(root.goal_forecasts, "goal_forecasts")) {
    goalForecasts.set(number(row.goal_id), {
      expectedByYearEnd: number(row.expected_by_year_end),
      expectedByTargetDate: row.expected_by_target_date == null ? null : number(row.expected_by_target_date),
    });
  }
  const cardMetrics = new Map<number, CardMetric>();
  for (const row of aggregateRows(root.card_metrics, "card_metrics")) {
    const cardId = number(row.card_id);
    cardMetrics.set(cardId, {
      card_id: cardId,
      used_limit: number(row.used_limit),
      available_limit: number(row.available_limit),
      displayed_invoice_month: text(row.displayed_invoice_month, 7),
      displayed_invoice_open: number(row.displayed_invoice_open),
    });
  }
  const monthlyCashFlow = aggregateRows(root.monthly_cash_flow, "monthly_cash_flow").map((row) => ({
    month: text(row.month, 7),
    realized_income: number(row.realized_income),
    realized_expense: number(row.realized_expense),
    pending_income: number(row.pending_income),
    pending_expense: number(row.pending_expense),
    account_balance: number(row.account_balance),
    balance_is_projection: Boolean(row.balance_is_projection),
  }));
  const categoriesByYear = aggregateRows(root.categories_by_year, "categories_by_year").map((entry) => {
    const compact = (raw: unknown, type: CategorySummary["type"]): CategorySummary[] => (
      aggregateRows(raw, `categories_by_year.${type}`).map((row) => ({
        category_id: row.category_id == null ? null : number(row.category_id),
        name: text(row.name),
        type,
        actual: number(row.actual),
        forecast: number(row.forecast),
      }))
    );
    return {
      year: number(entry.year),
      income: compact(entry.income, "receita"),
      expenses: compact(entry.expenses, "despesa"),
    };
  });
  const invoiceSummaries = aggregateRows(root.invoice_summaries, "invoice_summaries").map((row) => ({
    card_id: number(row.card_id),
    invoice_month: text(row.invoice_month, 7),
    open: number(row.open),
    closed_items_total: number(row.closed_items_total),
    payments_total: number(row.payments_total),
  }));

  return {
    calculationVersion,
    aggregateComplete: true,
    sourceCounts: {
      transactions: number(counts.transactions),
      invoiceItems: number(counts.invoice_items),
    },
    snapshot: {
      accountBalances,
      globalActiveBalance: number(root.global_active_balance),
      scopeAccountIds: Array.isArray(root.scope_account_ids)
        ? root.scope_account_ids.map((id) => number(id))
        : [],
      currentBalance: number(root.current_balance),
      predictedEndBalance: number(root.predicted_end_balance),
      dashboardFlow: {
        month: text(dashboard.month, 7),
        realized_income: number(dashboard.realized_income),
        realized_expense: number(dashboard.realized_expense),
        pending_income: number(dashboard.pending_income),
        pending_expense: number(dashboard.pending_expense),
      },
      monthlyCashFlow,
      categoriesByYear,
      cardPurchasesByMonth,
      goalForecasts,
      invoiceSummaries,
      cardMetrics,
    },
  };
}

function resolveRequestedIds(rows: FinancialRow[], request: string, keys: string[]): Set<number> {
  const normalizedRequest = normalize(request);
  const result = new Set<number>();
  for (const row of rows) {
    const name = normalize(row.nome);
    if (name.length >= 2 && normalizedRequest.includes(name)) result.add(number(row.id));
  }
  for (const key of keys) {
    const pattern = new RegExp(`(?:"${key}"\\s*:\\s*"?|\\b${key}\\s*[=:]\\s*)(\\d+)`, "gi");
    for (const match of request.matchAll(pattern)) result.add(Number(match[1]));
  }
  const valid = new Set(rows.map((row) => number(row.id)));
  return new Set([...result].filter((id) => valid.has(id)));
}

export function aggregateScopeArgument(ids: Iterable<number>): number[] | null {
  const explicit = [...new Set([...ids].filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (explicit.length === 0) return null;
  if (explicit.length > 100) throw new Error("FINANCIAL_CONTEXT_SCOPE_TOO_LARGE");
  return explicit;
}

function transactionRelevanceSort(currentDate: string) {
  const timestamp = (date: string): number => {
    if (!validDate(date)) return Number.NaN;
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const today = timestamp(currentDate);
  return (left: FinancialRow, right: FinancialRow): number => {
    const leftDate = timestamp(effectiveDate(left));
    const rightDate = timestamp(effectiveDate(right));
    const leftDistance = Number.isFinite(leftDate) ? Math.abs(leftDate - today) : Number.POSITIVE_INFINITY;
    const rightDistance = Number.isFinite(rightDate) ? Math.abs(rightDate - today) : Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const leftPast = Number.isFinite(leftDate) && leftDate < today;
    const rightPast = Number.isFinite(rightDate) && rightDate < today;
    if (leftPast !== rightPast) return leftPast ? -1 : 1;
    if (leftDate !== rightDate) return leftPast ? rightDate - leftDate : leftDate - rightDate;
    return number(right.id) - number(left.id);
  };
}

export type FinancialContext = {
  compactJson: string;
  analyticsAllowed: boolean;
};

type ContextNeeds = {
  route: "summary" | "history" | "cash_flow" | "categories" | "goals" | "cards" | "mutation";
  invoiceData: boolean;
  invoiceDetails: boolean;
  transactionDetails: boolean;
  monthlyCashFlow: boolean;
  categoryAnalytics: boolean;
  categories: boolean;
  goals: boolean;
  cards: boolean;
};

function contextNeeds(request: string, analyticsAllowed: boolean): ContextNeeds {
  const normalized = normalize(request);
  const mutation = /(crie|criar|adicione|adicionar|lance|lancar|registre|registrar|edite|editar|altere|alterar|apague|apagar|exclua|excluir|arquive|arquivar|reative|reativar|conclua|concluir|pague|pagar|transfira|transferir|guarde|guardar|resgate|resgatar|reabra|reabrir)/.test(normalized);
  const cardDomain = /(cartao|fatura|compra|parcela|credito)/.test(normalized);
  const goalDomain = /(objetiv|caixinha|guardar|resgatar|meta)/.test(normalized);
  const categoryDomain = /(categoria|gasto|despesa|receita|orcament|analis|econom)/.test(normalized);
  const cashFlowDomain = /(fluxo|projec|previs|cenario|fim do ano|quanto vou|quanto terei)/.test(normalized);
  const historyDomain = /(histor|extrato|lanc|transa|penden|atras|venc|recebi|paguei|gastei)/.test(normalized);
  const summaryDomain = /(resumo|balanco|resultado|como estao|minha situacao|visao geral)/.test(normalized);
  const transactionMutation = mutation && /(lanc|transa|receita|despesa|transfer|concl|reabr|pague|pagamento)/.test(normalized);
  const spendingDomain = /(gasto|despesa|categoria|orcament|balanco|resultado|resumo|econom)/.test(normalized);
  const route: ContextNeeds["route"] = mutation
    ? "mutation"
    : cardDomain
      ? "cards"
      : goalDomain
        ? "goals"
        : cashFlowDomain
          ? "cash_flow"
          : categoryDomain
            ? "categories"
            : historyDomain
              ? "history"
              : "summary";
  return {
    route,
    invoiceData: cardDomain || spendingDomain || (analyticsAllowed && categoryDomain),
    invoiceDetails: cardDomain,
    transactionDetails: historyDomain || transactionMutation || goalDomain || cardDomain,
    monthlyCashFlow: cashFlowDomain,
    categoryAnalytics: analyticsAllowed && (categoryDomain || summaryDomain),
    categories: categoryDomain || transactionMutation || cardDomain || summaryDomain,
    goals: goalDomain || summaryDomain,
    cards: cardDomain || spendingDomain || summaryDomain,
  };
}

export function serializeContextWithinBudget(
  value: Record<string, unknown>,
  maxCharacters = MAX_PROVIDER_CONTEXT_CHARS,
): string {
  if (maxCharacters < 2_000) throw new Error("FINANCIAL_CONTEXT_BUDGET_TOO_SMALL");
  const compact = JSON.parse(JSON.stringify(value)) as Record<string, any>;
  const dataset = (compact.dataset_complete ??= {}) as Record<string, any>;
  compact.context_budget = { max_characters: maxCharacters, truncated: false };
  const encode = () => JSON.stringify(compact);
  let encoded = encode();
  if (encoded.length <= maxCharacters) return encoded;

  compact.context_budget.truncated = true;
  const trimArray = (
    key: string,
    minimum: number,
    completenessKey?: string,
    countKey?: string,
  ) => {
    const rows = Array.isArray(compact[key]) ? compact[key] as unknown[] : [];
    while (encoded.length > maxCharacters && rows.length > minimum) {
      rows.pop();
      if (completenessKey) dataset[completenessKey] = false;
      if (countKey) dataset[countKey] = rows.length;
      encoded = encode();
    }
  };

  // Detalhes podem ser reconsultados. Totais e séries agregadas têm prioridade.
  trimArray("relevant_invoice_items", 0, "invoice_items", "invoice_items_in_context");
  trimArray("relevant_transactions", 12, "transactions", "transactions_in_context");

  const categoryYears = Array.isArray(compact.categories_by_year)
    ? compact.categories_by_year as Record<string, any>[]
    : [];
  let categoryTrimmed = false;
  while (encoded.length > maxCharacters) {
    const candidate = categoryYears
      .flatMap((year) => [year.income, year.expenses])
      .filter(Array.isArray)
      .sort((left, right) => right.length - left.length)
      .find((items) => items.length > 4) as unknown[] | undefined;
    if (!candidate) break;
    candidate.pop();
    categoryTrimmed = true;
    encoded = encode();
  }
  if (categoryTrimmed) dataset.category_analytics_in_context = false;

  trimArray("invoice_summaries", 12, "invoice_summaries_in_context");
  trimArray("accounts", 10, "accounts_in_context");
  trimArray("categories", 20, "categories_in_context");
  trimArray("goals", 10, "goals_in_context");
  trimArray("cards", 10, "cards_in_context");

  if (encoded.length > maxCharacters && Array.isArray(compact.monthly_cash_flow)) {
    const focusYear = String(compact.focus_month ?? compact.current_date ?? "").slice(0, 4);
    const focused = compact.monthly_cash_flow.filter((row: Record<string, unknown>) => (
      String(row.month ?? "").startsWith(`${focusYear}-`)
    ));
    if (focused.length > 0 && focused.length < compact.monthly_cash_flow.length) {
      compact.monthly_cash_flow = focused;
      dataset.monthly_cash_flow_in_context = false;
      encoded = encode();
    }
  }

  trimArray("relevant_transactions", 4, "transactions", "transactions_in_context");
  trimArray("invoice_summaries", 4, "invoice_summaries_in_context");

  if (encoded.length > maxCharacters && categoryYears.length > 0) {
    compact.categories_by_year = [];
    dataset.category_analytics_in_context = false;
    encoded = encode();
  }

  trimArray("accounts", 2, "accounts_in_context");
  trimArray("categories", 2, "categories_in_context");
  trimArray("goals", 2, "goals_in_context");
  trimArray("cards", 2, "cards_in_context");
  trimArray("relevant_transactions", 0, "transactions", "transactions_in_context");
  trimArray("invoice_summaries", 0, "invoice_summaries_in_context");

  if (encoded.length > maxCharacters) {
    const essential = {
      current_date: compact.current_date,
      focus_month: compact.focus_month,
      timezone: compact.timezone,
      plan: compact.plan,
      analytics_allowed: compact.analytics_allowed,
      personal_data_included: compact.personal_data_included,
      scope: compact.scope,
      dataset_complete: {
        ...dataset,
        transactions: false,
        invoice_items: false,
        transactions_in_context: 0,
        invoice_items_in_context: 0,
        invoice_summaries_in_context: false,
        accounts_in_context: false,
        categories_in_context: false,
        goals_in_context: false,
        cards_in_context: false,
        category_analytics_in_context: false,
        monthly_cash_flow_in_context: false,
      },
      month_summary: compact.month_summary,
      monthly_cash_flow: Array.isArray(compact.monthly_cash_flow)
        ? compact.monthly_cash_flow.filter((row: Record<string, unknown>) => row.month === compact.focus_month)
        : [],
      accounts: [],
      categories: [],
      goals: [],
      cards: [],
      relevant_transactions: [],
      relevant_invoice_items: [],
      invoice_summaries: [],
      categories_by_year: [],
      context_budget: { max_characters: maxCharacters, truncated: true },
    };
    encoded = JSON.stringify(essential);
  }

  if (encoded.length > maxCharacters) throw new Error("FINANCIAL_CONTEXT_BUDGET_EXCEEDED");
  return encoded;
}

export async function buildFinancialContext(
  client: SupabaseClient,
  plan: string,
  limitsEnabled: boolean,
  requestContext = "",
  currentUserId = "",
): Promise<FinancialContext> {
  const analyticsAllowed = !limitsEnabled || plan === "premium";
  const currentDate = currentDateInSaoPaulo();
  const currentMonth = currentDate.slice(0, 7);

  if (informationalRequest(requestContext)) {
    return {
      compactJson: JSON.stringify({
        current_date: currentDate,
        timezone: "America/Sao_Paulo",
        plan: text(plan, 40),
        analytics_allowed: analyticsAllowed,
        personal_data_included: false,
      }),
      analyticsAllowed,
    };
  }
  const needs = contextNeeds(requestContext, analyticsAllowed);
  const focusMonth = selectedMonth(requestContext, currentMonth);
  const years = selectedYears(requestContext, Number(currentMonth.slice(0, 4)));
  years.add(Number(focusMonth.slice(0, 4)));

  const [accounts, categories, goals, cards] = await Promise.all([
    selectOrThrow(client.from("contas").select("id,nome,saldo_inicial,cor,arquivado,compartilhado,user_id").order("nome").limit(ACCOUNT_LIMIT)),
    selectOrThrow(client.from("categorias").select("id,nome,tipo,cor,icone,ativa,user_id").order("nome").limit(CATEGORY_LIMIT)),
    selectOrThrow(client.from("caixinhas").select("id,nome,saldo_atual,meta_valor,data_prazo,arquivado,compartilhado,user_id").order("nome").limit(GOAL_LIMIT)),
    selectOrThrow(client.from("cartoes").select("id,nome,limite,dia_fechamento,dia_vencimento,ativo,user_id").order("nome").limit(CARD_LIMIT)),
  ]) as [FinancialRow[], FinancialRow[], FinancialRow[], FinancialRow[]];
  const tokens = queryTokens(requestContext);
  const accountById = new Map(accounts.map((row) => [number(row.id), text(row.nome)]));
  const categoryById = new Map(categories.map((row) => [number(row.id), text(row.nome)]));
  const goalById = new Map(goals.map((row) => [number(row.id), text(row.nome)]));
  const goalByName = goalsByNormalizedName(goals);
  const cardById = new Map(cards.map((row) => [number(row.id), text(row.nome)]));
  const requestedAccountIds = resolveRequestedIds(accounts, requestContext, ["account_id", "source_account_id", "destination_account_id"]);
  const requestedCategoryIds = resolveRequestedIds(categories, requestContext, ["category_id"]);
  const requestedGoalIds = resolveRequestedIds(goals, requestContext, ["goal_id"]);
  const requestedCardIds = resolveRequestedIds(cards, requestContext, ["card_id"]);
  const [aggregatePayload, transactionPage, invoicePage] = await Promise.all([
    selectOrThrow<Record<string, unknown>>(client.rpc("finance_ai_context_snapshot", {
      p_current_date: currentDate,
      p_focus_month: focusMonth,
      p_years: [...years],
      // Null significa "todas as contas ativas" no banco e não sofre com o
      // limite defensivo da lista explícita. IDs só são enviados quando o
      // usuário realmente restringiu o escopo na pergunta.
      p_scope_account_ids: aggregateScopeArgument(requestedAccountIds),
      p_analytics_allowed: needs.categoryAnalytics,
    })),
    fetchTransactionDetails(client, requestContext, focusMonth, needs.transactionDetails),
    fetchInvoiceDetails(client, requestContext, focusMonth, needs.invoiceDetails),
  ]);
  const aggregate = financialSnapshotFromAggregate(aggregatePayload);
  const snapshot = aggregate.snapshot;
  const transactions = transactionPage.rows;
  const invoiceItems = invoicePage.rows;
  const transactionDetailsComplete = aggregate.sourceCounts.transactions === transactions.length;
  const invoiceDetailsComplete = aggregate.sourceCounts.invoiceItems === invoiceItems.length;

  const contextAccounts = selectRelevantRows(
    accounts,
    (row) => !activeFlag(row.arquivado, false),
    30,
    60,
    tokens,
    requestContext,
  );
  const contextCategories = selectRelevantRows(
    categories,
    (row) => activeFlag(row.ativa, true),
    needs.categories ? 60 : 0,
    100,
    tokens,
    requestContext,
  );
  const contextGoals = selectRelevantRows(
    goals,
    (row) => !activeFlag(row.arquivado, false),
    needs.goals ? 30 : 0,
    60,
    tokens,
    requestContext,
  );
  const contextCards = selectRelevantRows(
    cards,
    (row) => activeFlag(row.ativo, true),
    needs.cards ? 20 : 0,
    40,
    tokens,
    requestContext,
  );

  const transactionRelatedText = (row: FinancialRow): string => {
    const description = text(row.descricao, 500);
    const destinationId = Number(description.match(ACCOUNT_TRANSFER_DESTINATION)?.[1] ?? 0);
    const movement = parseGoalMovement(description);
    const movementGoalId = movement?.goalId
      ?? (movement?.legacyName ? goalByName.get(normalize(movement.legacyName)) ?? null : null);
    return [
      accountById.get(number(row.conta_id)),
      categoryById.get(number(row.categoria_id)),
      destinationId ? accountById.get(destinationId) : "",
      movementGoalId ? goalById.get(movementGoalId) : movement?.legacyName,
    ].filter(Boolean).join(" ");
  };
  const sortedTransactions = [...transactions].sort(transactionRelevanceSort(currentDate));
  const selectedTransactions = new Map<number, FinancialRow>();
  if (needs.transactionDetails) {
    sortedTransactions.slice(0, 24).forEach((row) => selectedTransactions.set(number(row.id), row));
    for (const row of sortedTransactions) {
      if (selectedTransactions.size >= 40) break;
      if (matchesRequest(row, tokens, requestContext, transactionRelatedText(row))) {
        selectedTransactions.set(number(row.id), row);
      }
    }
  }

  const sortedInvoiceItems = [...invoiceItems].sort((left, right) => (
    text(right.mes_fatura, 7).localeCompare(text(left.mes_fatura, 7)) || number(right.id) - number(left.id)
  ));
  const selectedInvoiceItems = new Map<number, FinancialRow>();
  if (needs.invoiceDetails) {
    sortedInvoiceItems.slice(0, 18).forEach((row) => selectedInvoiceItems.set(number(row.id), row));
    for (const row of sortedInvoiceItems) {
      if (selectedInvoiceItems.size >= 30) break;
      const related = `${cardById.get(number(row.cartao_id)) ?? ""} ${categoryById.get(number(row.categoria_id)) ?? ""}`;
      if (matchesRequest(row, tokens, requestContext, related)) selectedInvoiceItems.set(number(row.id), row);
    }
  }
  const relevanceComparator = transactionRelevanceSort(currentDate);
  const selectedTransactionRows = [...selectedTransactions.values()].sort((left, right) => {
    const leftMatches = matchesRequest(left, tokens, requestContext, transactionRelatedText(left));
    const rightMatches = matchesRequest(right, tokens, requestContext, transactionRelatedText(right));
    if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
    return relevanceComparator(left, right);
  });
  const selectedInvoiceRows = [...selectedInvoiceItems.values()].sort((left, right) => {
    const leftRelated = `${cardById.get(number(left.cartao_id)) ?? ""} ${categoryById.get(number(left.categoria_id)) ?? ""}`;
    const rightRelated = `${cardById.get(number(right.cartao_id)) ?? ""} ${categoryById.get(number(right.categoria_id)) ?? ""}`;
    const leftMatches = matchesRequest(left, tokens, requestContext, leftRelated);
    const rightMatches = matchesRequest(right, tokens, requestContext, rightRelated);
    if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
    return text(right.mes_fatura, 7).localeCompare(text(left.mes_fatura, 7)) || number(right.id) - number(left.id);
  });

  const activeCardIds = new Set(cards.filter((row) => activeFlag(row.ativo, true)).map((row) => number(row.id)));
  const relevantInvoiceSummaries = snapshot.invoiceSummaries
    .filter((item) => years.has(Number(item.invoice_month.slice(0, 4))))
    .filter((item) => needs.cards && (activeCardIds.has(item.card_id) || requestedCardIds.has(item.card_id)))
    .sort((left, right) => right.invoice_month.localeCompare(left.invoice_month));
  const includedInvoiceSummaries = relevantInvoiceSummaries.slice(0, 60);

  const currentFlow = snapshot.dashboardFlow;
  const focusCardPurchases = number(snapshot.cardPurchasesByMonth.get(focusMonth) ?? 0);
  const compact = {
    current_date: currentDate,
    focus_month: focusMonth,
    timezone: "America/Sao_Paulo",
    plan: text(plan, 40),
    analytics_allowed: analyticsAllowed,
    personal_data_included: true,
    context_route: needs.route,
    scope: {
      type: requestedAccountIds.size > 0 ? "requested_accounts" : "active_accounts",
      account_ids: snapshot.scopeAccountIds,
      all_active_account_balance: snapshot.globalActiveBalance,
      matched_category_ids: [...requestedCategoryIds],
      matched_goal_ids: [...requestedGoalIds],
      matched_card_ids: [...requestedCardIds],
    },
    dataset_complete: {
      aggregate_source: "database_rpc_v1",
      aggregate_calculation_version: aggregate.calculationVersion,
      cash_aggregates: aggregate.aggregateComplete,
      card_aggregates: aggregate.aggregateComplete,
      transactions: transactionDetailsComplete && selectedTransactions.size === transactions.length,
      transactions_fetched_complete: transactionDetailsComplete,
      transactions_query_scope: transactionPage.queryScope,
      transactions_total_available: aggregate.sourceCounts.transactions,
      transactions_total_fetched: transactions.length,
      transactions_in_context: selectedTransactions.size,
      invoice_items: needs.invoiceDetails && invoiceDetailsComplete && selectedInvoiceItems.size === invoiceItems.length,
      invoice_items_included: needs.invoiceDetails,
      invoice_items_fetched_complete: needs.invoiceDetails && invoiceDetailsComplete,
      invoice_items_query_scope: invoicePage.queryScope,
      invoice_items_total_available: aggregate.sourceCounts.invoiceItems,
      invoice_items_total_fetched: invoiceItems.length,
      invoice_items_in_context: selectedInvoiceItems.size,
      invoice_summaries_in_context: needs.cards
        && includedInvoiceSummaries.length === relevantInvoiceSummaries.length,
      category_analytics_in_context: aggregate.aggregateComplete && needs.categoryAnalytics && (requestedCategoryIds.size > 0 || snapshot.categoriesByYear.every((entry) => (
        entry.income.length <= 20 && entry.expenses.length <= 20
      ))),
      monthly_cash_flow_in_context: aggregate.aggregateComplete && needs.monthlyCashFlow,
      accounts_fetched_complete: accounts.length < ACCOUNT_LIMIT,
      categories_fetched_complete: categories.length < CATEGORY_LIMIT,
      goals_fetched_complete: goals.length < GOAL_LIMIT,
      cards_fetched_complete: cards.length < CARD_LIMIT,
      accounts_in_context: contextAccounts.length === accounts.length,
      categories_in_context: contextCategories.length === categories.length,
      goals_in_context: contextGoals.length === goals.length,
      cards_in_context: contextCards.length === cards.length,
    },
    month_summary: {
      ...currentFlow,
      realized_balance: number(currentFlow.realized_income - currentFlow.realized_expense),
      card_purchase_expense: focusCardPurchases,
      realized_expense_including_card_purchases: number(currentFlow.realized_expense + focusCardPurchases),
      forecast_expense_including_card_purchases: number(
        currentFlow.realized_expense + currentFlow.pending_expense + focusCardPurchases,
      ),
      current_account_balance: snapshot.currentBalance,
      predicted_end_balance: snapshot.predictedEndBalance,
    },
    monthly_cash_flow: needs.monthlyCashFlow ? snapshot.monthlyCashFlow : [],
    accounts: contextAccounts.map((row) => {
      const owned = Boolean(currentUserId) && text(row.user_id, 50) === currentUserId;
      return {
        id: number(row.id),
        name: text(row.nome),
        active: !activeFlag(row.arquivado, false),
        balance: number(snapshot.accountBalances.get(number(row.id)) ?? number(row.saldo_inicial)),
        shared: Boolean(row.compartilhado),
        owned_by_user: owned,
        can_update: owned,
        can_archive: owned,
        can_delete: owned,
      };
    }),
    categories: contextCategories.map((row) => {
      const owned = Boolean(currentUserId) && text(row.user_id, 50) === currentUserId;
      return {
        id: number(row.id),
        name: text(row.nome),
        type: text(row.tipo, 20),
        active: activeFlag(row.ativa, true),
        owned_by_user: owned,
        can_update: owned,
        can_archive: owned,
        can_delete: owned,
      };
    }),
    goals: contextGoals.map((row) => {
      const forecast = snapshot.goalForecasts.get(number(row.id));
      const owned = Boolean(currentUserId) && text(row.user_id, 50) === currentUserId;
      const shared = Boolean(row.compartilhado);
      return {
        id: number(row.id),
        name: text(row.nome),
        active: !activeFlag(row.arquivado, false),
        shared,
        owned_by_user: owned,
        can_update: owned,
        can_move_money: owned || shared,
        can_archive: owned,
        can_delete: owned,
        balance: number(row.saldo_atual),
        target: number(row.meta_valor),
        target_date: row.data_prazo ? text(row.data_prazo, 10) : null,
        expected_by_year_end: forecast?.expectedByYearEnd ?? number(row.saldo_atual),
        expected_by_target_date: forecast?.expectedByTargetDate ?? null,
      };
    }),
    cards: contextCards.map((row) => {
      const metric = snapshot.cardMetrics.get(number(row.id));
      const owned = Boolean(currentUserId) && text(row.user_id, 50) === currentUserId;
      return {
        id: number(row.id),
        name: text(row.nome),
        active: activeFlag(row.ativo, true),
        owned_by_user: owned,
        can_update: owned,
        can_archive: owned,
        can_delete: owned,
        limit: number(row.limite),
        used_limit: metric?.used_limit ?? null,
        available_limit: metric?.available_limit ?? null,
        displayed_invoice_month: metric?.displayed_invoice_month ?? null,
        displayed_invoice_open: metric?.displayed_invoice_open ?? null,
        closing_day: number(row.dia_fechamento),
        due_day: number(row.dia_vencimento),
      };
    }),
    relevant_transactions: selectedTransactionRows.map((row) => {
      const description = text(row.descricao, 500);
      const destinationId = Number(description.match(ACCOUNT_TRANSFER_DESTINATION)?.[1] ?? 0) || null;
      const movement = parseGoalMovement(description);
      const movementGoalId = movement?.goalId
        ?? (movement?.legacyName ? goalByName.get(normalize(movement.legacyName)) ?? null : null);
      const payment = parseInvoicePayment(description);
      return {
        id: number(row.id),
        type: text(row.tipo, 20),
        value: number(row.valor),
        description: visibleDescription(description),
        status: text(row.status, 20),
        scheduled_date: text(row.data_vencimento, 10),
        realization_date: row.data_realizacao ? text(row.data_realizacao, 10) : null,
        account: accountById.get(number(row.conta_id)) ?? "",
        account_id: number(row.conta_id),
        category: categoryById.get(number(row.categoria_id)) ?? null,
        category_id: row.categoria_id == null ? null : number(row.categoria_id),
        internal_transfer: isInternalTransfer(description),
        destination_account_id: destinationId,
        destination_account: destinationId ? accountById.get(destinationId) ?? null : null,
        goal_id: movementGoalId,
        goal: movementGoalId ? goalById.get(movementGoalId) ?? movement?.legacyName ?? null : movement?.legacyName ?? null,
        goal_operation: movement?.operation ?? null,
        series_id: description.match(SERIES_METADATA)?.[1] ?? null,
        invoice_payment: payment !== null,
        invoice_payment_card_id: payment?.cardId ?? null,
        invoice_payment_month: payment?.invoiceMonth ?? null,
        invoice_payment_mode: payment?.mode ?? null,
      };
    }),
    relevant_invoice_items: selectedInvoiceRows.map((row) => ({
      id: number(row.id),
      card_id: number(row.cartao_id),
      card: cardById.get(number(row.cartao_id)) ?? "",
      category_id: row.categoria_id == null ? null : number(row.categoria_id),
      category: categoryById.get(number(row.categoria_id)) ?? null,
      description: visibleDescription(row.descricao),
      value: number(row.valor),
      purchase_date: text(row.data_compra, 10),
      invoice_month: text(row.mes_fatura, 7),
      paid: activeFlag(row.pago, false),
      synthetic_ledger_item: isSyntheticInvoiceLedgerItem(row),
      installment: `${number(row.parcela_atual)}/${number(row.total_parcelas)}`,
    })),
    invoice_summaries: includedInvoiceSummaries.map((item) => ({
      ...item,
      card: cardById.get(item.card_id) ?? "",
      active_card: activeCardIds.has(item.card_id),
    })),
    categories_by_year: needs.categoryAnalytics
      ? snapshot.categoriesByYear.map((entry) => {
        const selectCategories = (items: CategorySummary[]) => requestedCategoryIds.size > 0
          ? items.filter((item) => requestedCategoryIds.has(item.category_id ?? -1))
          : items.slice(0, 20);
        return {
          year: entry.year,
          income: selectCategories(entry.income),
          expenses: selectCategories(entry.expenses),
        };
      })
      : [],
  };

  return {
    compactJson: serializeContextWithinBudget(compact),
    analyticsAllowed,
  };
}
