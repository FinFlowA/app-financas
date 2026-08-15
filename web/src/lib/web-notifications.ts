export const WEB_NOTIFICATION_PREFERENCES_LEGACY_KEY = "finflow_web_notification_preferences_v1";
export const WEB_NOTIFICATION_PREFERENCES_KEY_PREFIX = "finflow_web_notification_preferences_v2";
export const WEB_NOTIFICATION_DEDUP_KEY_PREFIX = "finflow_web_notification_seen_v1";
export const WEB_NOTIFICATION_PREFERENCES_CHANGED_EVENT = "finflow:web-notification-preferences-changed";

export type WebNotificationPreferenceKey =
  | "overdue"
  | "today"
  | "invoiceClosing"
  | "invoiceDue"
  | "cardLimit"
  | "goalDeadline";

export type WebNotificationPreferences = Record<WebNotificationPreferenceKey, boolean>;

export const WEB_NOTIFICATION_DEFAULTS: WebNotificationPreferences = {
  overdue: true,
  today: true,
  invoiceClosing: true,
  invoiceDue: true,
  cardLimit: true,
  goalDeadline: true,
};

export const WEB_NOTIFICATION_ITEMS: Array<{
  key: WebNotificationPreferenceKey;
  title: string;
  description: string;
}> = [
  { key: "overdue", title: "Lançamentos vencidos", description: "Avisos de receitas e despesas que passaram do prazo." },
  { key: "today", title: "Vencimentos do dia", description: "Lembretes dos agendamentos que vencem hoje." },
  { key: "invoiceClosing", title: "Fechamento da fatura", description: "Avisos dois dias antes e no dia do fechamento do cartão." },
  { key: "invoiceDue", title: "Vencimento da fatura", description: "Avisos três dias antes, um dia antes e no vencimento de faturas pendentes." },
  { key: "cardLimit", title: "Uso do limite", description: "Alerta quando o cartão ultrapassar 80% do limite." },
  { key: "goalDeadline", title: "Prazos dos objetivos", description: "Avisos 30, 7, 3 e 1 dia antes e no prazo da meta." },
];

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function notificationPreferencesKey(userId: string): string {
  return `${WEB_NOTIFICATION_PREFERENCES_KEY_PREFIX}:${userId}`;
}

export function parseWebNotificationPreferences(value: unknown): WebNotificationPreferences {
  const candidate = isRecord(value) ? value : {};
  return {
    overdue: typeof candidate.overdue === "boolean" ? candidate.overdue : WEB_NOTIFICATION_DEFAULTS.overdue,
    today: typeof candidate.today === "boolean" ? candidate.today : WEB_NOTIFICATION_DEFAULTS.today,
    invoiceClosing: typeof candidate.invoiceClosing === "boolean" ? candidate.invoiceClosing : WEB_NOTIFICATION_DEFAULTS.invoiceClosing,
    invoiceDue: typeof candidate.invoiceDue === "boolean" ? candidate.invoiceDue : WEB_NOTIFICATION_DEFAULTS.invoiceDue,
    cardLimit: typeof candidate.cardLimit === "boolean" ? candidate.cardLimit : WEB_NOTIFICATION_DEFAULTS.cardLimit,
    goalDeadline: typeof candidate.goalDeadline === "boolean" ? candidate.goalDeadline : WEB_NOTIFICATION_DEFAULTS.goalDeadline,
  };
}

function parseStoredPreferences(serialized: string | null): WebNotificationPreferences | null {
  if (!serialized) return null;
  try {
    return parseWebNotificationPreferences(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function readWebNotificationPreferences(storage: StorageReader, userId: string): WebNotificationPreferences {
  return parseStoredPreferences(storage.getItem(notificationPreferencesKey(userId)))
    ?? parseStoredPreferences(storage.getItem(WEB_NOTIFICATION_PREFERENCES_LEGACY_KEY))
    ?? { ...WEB_NOTIFICATION_DEFAULTS };
}

export function saveWebNotificationPreferences(
  storage: StorageWriter,
  userId: string,
  preferences: WebNotificationPreferences,
): void {
  storage.setItem(notificationPreferencesKey(userId), JSON.stringify(parseWebNotificationPreferences(preferences)));
}

export function notificationDeduplicationKey(userId: string, eventKey: string, today: string): string {
  return `${WEB_NOTIFICATION_DEDUP_KEY_PREFIX}:${userId}:${today}:${eventKey}`;
}

export function notificationWasShown(
  storage: StorageReader,
  userId: string,
  eventKey: string,
  today: string,
): boolean {
  return storage.getItem(notificationDeduplicationKey(userId, eventKey, today)) === "1";
}

export function markNotificationAsShown(
  storage: Pick<Storage, "setItem">,
  userId: string,
  eventKey: string,
  today: string,
): void {
  // Somente o marcador do evento é persistido. Títulos, valores, saldos e
  // descrições financeiras nunca são gravados no localStorage.
  storage.setItem(notificationDeduplicationKey(userId, eventKey, today), "1");
}

export type WebNotificationTransaction = {
  id: number;
  status: string;
  tipo: string;
  data_vencimento: string;
};

export type WebNotificationCard = {
  id: number;
  nome: string;
  limite: number | string;
  dia_vencimento: number;
  dia_fechamento: number;
  ativo: boolean;
};

export type WebNotificationInvoiceItem = {
  cartao_id: number;
  mes_fatura: string;
  valor: number | string;
  pago: boolean;
  descricao?: string;
};

export type WebNotificationGoal = {
  id: number;
  nome: string;
  meta_valor: number | string;
  saldo_atual: number | string;
  data_prazo: string | null;
  arquivado?: boolean;
};

export type FinancialNotificationEvent = {
  key: string;
  title: string;
  body: string;
  route: "/transacoes?quick=overdue" | "/transacoes?quick=today" | "/cartoes" | "/objetivos";
};

export type FinancialNotificationInput = {
  today: string;
  preferences: WebNotificationPreferences;
  transactions: WebNotificationTransaction[];
  cards: WebNotificationCard[];
  invoiceItems: WebNotificationInvoiceItem[];
  goals: WebNotificationGoal[];
};

const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const INVOICE_OFFSETS = [3, 1, 0] as const;
const CLOSING_OFFSETS = [2, 0] as const;
const GOAL_OFFSETS = [30, 7, 3, 1, 0] as const;

function validIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isoDayNumber(value: string): number | null {
  if (!validIsoDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function daysFromToday(target: string, today: string): number | null {
  const targetDay = isoDayNumber(target);
  const currentDay = isoDayNumber(today);
  return targetDay === null || currentDay === null ? null : targetDay - currentDay;
}

function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateForMonthDay(month: string, requestedDay: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0, 12)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(Math.trunc(requestedDay), 1), lastDay)).padStart(2, "0")}`;
}

function safeName(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 60);
}

function amount(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Avalia somente as condições financeiras. O acesso ao Supabase, a sessão e a
 * exibição pelo Service Worker ficam fora desta função para que as regras sejam
 * determinísticas e testáveis.
 */
export function evaluateFinancialNotificationEvents(input: FinancialNotificationInput): FinancialNotificationEvent[] {
  if (!validIsoDate(input.today)) return [];

  const events: FinancialNotificationEvent[] = [];
  const pending = input.transactions.filter((transaction) => transaction.status === "pendente");
  const overdue = pending.filter((transaction) => validIsoDate(transaction.data_vencimento) && transaction.data_vencimento < input.today);
  const dueToday = pending.filter((transaction) => transaction.data_vencimento === input.today);

  if (input.preferences.overdue && overdue.length > 0) {
    const expenses = overdue.filter((transaction) => transaction.tipo === "despesa").length;
    const revenues = overdue.filter((transaction) => transaction.tipo === "receita").length;
    const parts = [
      expenses > 0 ? plural(expenses, "despesa", "despesas") : "",
      revenues > 0 ? plural(revenues, "receita", "receitas") : "",
    ].filter(Boolean);
    events.push({
      key: "transactions-overdue",
      title: "Lançamentos vencidos",
      body: `Você tem ${parts.join(" e ")} aguardando conclusão.`,
      route: "/transacoes?quick=overdue",
    });
  }

  if (input.preferences.today && dueToday.length > 0) {
    const expenses = dueToday.filter((transaction) => transaction.tipo === "despesa").length;
    const revenues = dueToday.filter((transaction) => transaction.tipo === "receita").length;
    const parts = [
      expenses > 0 ? plural(expenses, "despesa", "despesas") : "",
      revenues > 0 ? plural(revenues, "receita", "receitas") : "",
    ].filter(Boolean);
    events.push({
      key: "transactions-today",
      title: "Agendamentos vencendo hoje",
      body: `Confira ${parts.join(" e ")} previstas para hoje.`,
      route: "/transacoes?quick=today",
    });
  }

  const currentMonth = input.today.slice(0, 7);
  const relevantMonths = [currentMonth, addMonths(currentMonth, 1)];
  const openInvoiceTotals = new Map<string, number>();
  for (const item of input.invoiceItems) {
    if (item.pago) continue;
    const key = `${item.cartao_id}:${item.mes_fatura}`;
    openInvoiceTotals.set(key, (openInvoiceTotals.get(key) ?? 0) + amount(item.valor));
  }

  for (const card of input.cards.filter((candidate) => candidate.ativo)) {
    const cardName = safeName(card.nome, "Cartão");
    for (const invoiceMonth of relevantMonths) {
      if (input.preferences.invoiceClosing) {
        const closingDate = dateForMonthDay(invoiceMonth, card.dia_fechamento);
        const offset = daysFromToday(closingDate, input.today);
        if (offset !== null && CLOSING_OFFSETS.includes(offset as (typeof CLOSING_OFFSETS)[number])) {
          events.push({
            key: `card-${card.id}-closing-${invoiceMonth}-${offset}`,
            title: offset === 0 ? `${cardName}: fatura fechou hoje` : `${cardName}: fatura fecha em 2 dias`,
            body: offset === 0
              ? "As próximas compras serão lançadas na fatura seguinte."
              : "Confira suas compras antes do fechamento.",
            route: "/cartoes",
          });
        }
      }

      if (input.preferences.invoiceDue && (openInvoiceTotals.get(`${card.id}:${invoiceMonth}`) ?? 0) > 0.005) {
        const dueDate = dateForMonthDay(invoiceMonth, card.dia_vencimento);
        const offset = daysFromToday(dueDate, input.today);
        if (offset !== null && INVOICE_OFFSETS.includes(offset as (typeof INVOICE_OFFSETS)[number])) {
          events.push({
            key: `card-${card.id}-due-${invoiceMonth}-${offset}`,
            title: offset === 0
              ? `${cardName}: fatura vence hoje`
              : `${cardName}: fatura vence em ${offset === 1 ? "1 dia" : "3 dias"}`,
            body: "Existe saldo pendente nesta fatura.",
            route: "/cartoes",
          });
        }
      }
    }

    if (input.preferences.cardLimit) {
      const limit = amount(card.limite);
      const used = Math.max(0, input.invoiceItems
        .filter((item) => item.cartao_id === card.id && !item.pago && item.mes_fatura >= currentMonth)
        .filter((item) => !item.descricao?.endsWith("(Fixa)") || item.mes_fatura === currentMonth)
        .reduce((total, item) => total + amount(item.valor), 0));
      if (limit > 0 && used / limit > 0.8) {
        events.push({
          key: `card-${card.id}-limit-over-80`,
          title: `${cardName}: atenção ao limite`,
          body: `O uso do cartão chegou a ${Math.round((used / limit) * 100)}% do limite.`,
          route: "/cartoes",
        });
      }
    }
  }

  if (input.preferences.goalDeadline) {
    for (const goal of input.goals) {
      if (goal.arquivado || !goal.data_prazo || amount(goal.saldo_atual) >= amount(goal.meta_valor)) continue;
      const offset = daysFromToday(goal.data_prazo, input.today);
      if (offset === null || !GOAL_OFFSETS.includes(offset as (typeof GOAL_OFFSETS)[number])) continue;
      const goalName = safeName(goal.nome, "Objetivo");
      events.push({
        key: `goal-${goal.id}-deadline-${goal.data_prazo}-${offset}`,
        title: offset === 0 ? `${goalName}: prazo hoje` : `${goalName}: faltam ${offset} ${offset === 1 ? "dia" : "dias"}`,
        body: "Revise o andamento deste objetivo financeiro.",
        route: "/objetivos",
      });
    }
  }

  return events;
}
