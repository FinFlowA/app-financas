import {
  FINANCE_AI_MUTATION_INTENTS,
  type FinanceAiIntent,
  type FinanceAiMutationIntent,
  type FinanceAiNavigationIntent,
  type FinanceAiReadIntent,
} from "../finance-ai/types";
import type { LocalDemoDatabase, LocalDemoRow, LocalDemoUser } from "./fixtures";

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  intent: FinanceAiIntent | null;
};

type ActionData = Record<string, unknown>;

type Draft = {
  intent: FinanceAiMutationIntent;
  data: ActionData;
  missingField: string;
};

type Proposal = {
  id: string;
  confirmationToken: string;
  conversationId: string;
  intent: FinanceAiMutationIntent;
  data: ActionData;
  summary: string;
  expiresAt: string;
  status: "pending" | "executed" | "cancelled";
  result?: Record<string, unknown>;
};

type FinanceAiContext = {
  database: LocalDemoDatabase;
  currentUser: () => LocalDemoUser | null;
};

const DEMO_TODAY = "2026-08-02";
const DEMO_MONTH = "2026-08";
const MUTATIONS = new Set<string>(FINANCE_AI_MUTATION_INTENTS);

const DEMO_COLOR_CHOICES = [
  { color: "#2A9D8F", names: ["verde", "verde agua", "turquesa", "padrao"] },
  { color: "#E9C46A", names: ["amarelo", "dourado"] },
  { color: "#F4A261", names: ["laranja", "laranja claro"] },
  { color: "#E76F51", names: ["coral", "vermelho claro"] },
  { color: "#264653", names: ["azul petroleo"] },
  { color: "#8AB17D", names: ["verde claro"] },
  { color: "#457B9D", names: ["azul", "azul claro"] },
  { color: "#8A05BE", names: ["roxo", "violeta"] },
  { color: "#E63946", names: ["vermelho"] },
  { color: "#1D3557", names: ["azul escuro"] },
] as const;

const DEMO_ICON_CHOICES = [
  { icon: "label", names: ["etiqueta", "label", "padrao"] },
  { icon: "savings", names: ["economia", "poupanca", "cofrinho", "savings"] },
  { icon: "home", names: ["casa", "moradia", "home"] },
  { icon: "flight", names: ["viagem", "aviao", "flight"] },
  { icon: "laptop", names: ["notebook", "computador", "laptop"] },
  { icon: "school", names: ["educacao", "escola", "estudo", "school"] },
  { icon: "restaurant", names: ["alimentacao", "comida", "restaurante", "restaurant"] },
  { icon: "directions-car", names: ["carro", "transporte"] },
  { icon: "shopping-cart", names: ["compras", "carrinho"] },
  { icon: "payments", names: ["dinheiro", "pagamento", "payments"] },
] as const;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

function typoTolerance(target: string): number {
  if (target.length <= 4) return 1;
  if (target.length <= 8) return 2;
  return 3;
}

function approximatelyEqual(left: string, right: string): boolean {
  if (left === right) return true;
  const distance = editDistance(left, right);
  const maximumLength = Math.max(left.length, right.length);
  const similarity = maximumLength > 0 ? 1 - (distance / maximumLength) : 1;
  return distance <= Math.min(typoTolerance(left), typoTolerance(right))
    && (similarity >= 0.75 || (left[0] === right[0] && similarity >= 0.7));
}

function tokens(value: unknown): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function hasApproximateToken(value: unknown, targets: readonly string[]): boolean {
  const source = tokens(value);
  return targets.some((target) => source.some((token) => approximatelyEqual(token, normalize(target))));
}

function approximateTokenIndex(value: unknown, targets: readonly string[]): number {
  const source = tokens(value);
  for (let index = 0; index < source.length; index += 1) {
    if (targets.some((target) => approximatelyEqual(source[index], normalize(target)))) return index;
  }
  return -1;
}

function fuzzyContainsName(message: string, name: unknown): boolean {
  const messageTokens = tokens(message);
  const ignored = new Set(["de", "da", "do", "das", "dos", "a", "o"]);
  const nameTokens = tokens(name).filter((token) => !ignored.has(token));
  return nameTokens.length > 0 && nameTokens.every((nameToken) => (
    messageTokens.some((messageToken) => approximatelyEqual(messageToken, nameToken))
  ));
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function nextId(rows: LocalDemoRow[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, Number(row.id) || 0), 0) + 1;
}

function parseBrazilianNumber(raw: string): number | null {
  const compact = raw.replace(/\s/g, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let normalized = compact;
  if (comma > dot) normalized = compact.replace(/\./g, "").replace(",", ".");
  else if (dot >= 0 && comma >= 0) normalized = compact.replace(/,/g, "");
  else if (dot >= 0 && /^\d{1,3}(?:\.\d{3})+$/.test(compact)) normalized = compact.replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function moneyFrom(message: string, allowPlain = false): number | null {
  const explicit = message.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i)?.[1];
  if (explicit) return parseBrazilianNumber(explicit);
  const writtenCurrency = message.match(/\b([\d.]+(?:,\d{1,2})?)\s*(?:reais|real)\b/i)?.[1];
  if (writtenCurrency) return parseBrazilianNumber(writtenCurrency);
  const contextual = message.match(/(?:valor|saldo(?:\s+inicial)?|limite|meta|total)\s*(?:de|e|é|:|=)?\s*([\d.]+(?:,\d{1,2})?)/i)?.[1];
  if (contextual) return parseBrazilianNumber(contextual);
  if (allowPlain) {
    const plain = message.trim().match(/^([\d.]+(?:,\d{1,2})?)$/)?.[1];
    if (plain) return parseBrazilianNumber(plain);
  }
  return null;
}

function moneyAfterLabel(message: string, labels: string): number | null {
  const match = message.match(new RegExp(`(?:${labels})\\s*(?:de|e|é|:|=)?\\s*(?:r\\$\\s*)?([\\d.]+(?:,\\d{1,2})?)`, "i"));
  return match?.[1] ? parseBrazilianNumber(match[1]) : null;
}

function colorFrom(message: string, defaultColor = "#2A9D8F"): string | null {
  const hex = message.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) return hex.toUpperCase();
  const text = normalize(message);
  if (/\b(cor )?padrao\b/.test(text)) return defaultColor;
  const aliases = DEMO_COLOR_CHOICES
    .flatMap((choice) => choice.names.map((name) => ({ color: choice.color, name: normalize(name) })))
    .sort((left, right) => right.name.length - left.name.length);
  for (const alias of aliases) {
    if (text.includes(alias.name)) return alias.color;
  }
  return null;
}

function iconFrom(message: string, defaultIcon = "label"): string | null {
  const text = normalize(message);
  if (/\b(icone )?padrao\b/.test(text)) return defaultIcon;
  for (const choice of DEMO_ICON_CHOICES) {
    if (choice.names.some((name) => hasApproximateToken(text, [name]) || text.includes(normalize(name)))) return choice.icon;
  }
  return null;
}

function booleanFrom(message: string): boolean | null {
  const text = normalize(message);
  if (/\b(sim|conjunta|conjunto|compartilhada|compartilhado)\b/.test(text)) return true;
  if (/\b(nao|individual|somente minha|so minha)\b/.test(text)) return false;
  return null;
}

function noDeadline(message: string): boolean {
  return /\b(sem prazo|sem data|nao quero prazo|nenhuma data)\b/.test(normalize(message));
}

function integerFrom(message: string): number | null {
  const value = Number(message.match(/\b(\d{1,3})\b/)?.[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function parseDate(message: string): string | null {
  const text = normalize(message);
  if (/\bhoje\b|\bagora\b/.test(text)) return DEMO_TODAY;
  if (/\bamanha\b/.test(text)) return "2026-08-03";
  const iso = message.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const br = message.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  if (date.getUTCFullYear() !== Number(parts[0]) || date.getUTCMonth() + 1 !== Number(parts[1]) || date.getUTCDate() !== Number(parts[2])) return null;
  return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
}

function dateWithMonthOffset(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function dateWithDayOffset(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function namedValue(message: string): string | null {
  const quoted = message.match(/["“”']([^"“”']{2,80})["“”']/)?.[1]?.trim();
  if (quoted) return quoted;
  const anchored = message.match(/(?:chamad[oa]|com\s+o\s+nome|nome(?:ad[oa])?|descri(?:cao|ção))\s*(?:de|:)?\s*([^,]+?)(?=\s+(?:(?:para|de)\s+(?:receita|despesa)|(?:na|no|para|com|da|do)\s+(?:categoria|conta|cartao|cartão|objetivo|saldo|valor|limite|meta))|,|$)/i)?.[1]?.trim();
  return anchored || null;
}

function statusFrom(message: string): "paga" | "pendente" | null {
  const text = normalize(message);
  if (/\b(a pagar|a receber|ainda nao)\b/.test(text) || hasApproximateToken(text, ["pendente", "agendado", "agendada"])) return "pendente";
  if (/\b(ja|acabei)\b/.test(text) && hasApproximateToken(text, ["paga", "pago", "recebida", "recebido", "concluida", "concluido", "realizada", "realizado", "quitada", "quitado"])) return "paga";
  if (hasApproximateToken(text, ["paga", "pago", "recebida", "recebido", "concluida", "concluido", "realizada", "realizado", "quitada", "quitado"])) return "paga";
  return null;
}

function frequencyFrom(message: string): "unica" | "parcelada" | "semanal" | "mensal" | "anual" | null {
  const text = normalize(message);
  if (/\bparcel/.test(text) || /\b\d+\s*x\b/.test(text) || hasApproximateToken(text, ["parcelada", "parcelado"])) return "parcelada";
  if (/\btoda semana|por semana\b/.test(text) || hasApproximateToken(text, ["semanal"])) return "semanal";
  if (/\btodo mes\b/.test(text) || hasApproximateToken(text, ["mensal", "recorrente"])) return "mensal";
  if (/\btodo ano\b/.test(text) || hasApproximateToken(text, ["anual"])) return "anual";
  if (/\buma vez|a vista\b/.test(text) || hasApproximateToken(text, ["unica", "unico"])) return "unica";
  return null;
}

function installmentsFrom(message: string): number | null {
  const value = Number(message.match(/\b(\d{1,3})\s*(?:x|parcelas?)\b/i)?.[1]);
  return Number.isSafeInteger(value) && value >= 2 ? value : null;
}

function recurrenceCountFrom(message: string): number | null {
  const value = Number(message.match(/\b(?:por|durante|em)\s+(\d{1,3})\s+(?:semanas?|meses|anos|vezes)\b/i)?.[1]);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function typeFrom(message: string): "receita" | "despesa" | null {
  const text = normalize(message);
  if (hasApproximateToken(text, ["receita", "entrada", "recebimento"])) return "receita";
  if (hasApproximateToken(text, ["despesa", "saida", "gasto"])) return "despesa";
  return null;
}

function operationFrom(message: string): "guardar" | "resgatar" | null {
  const text = normalize(message);
  if (hasApproximateToken(text, ["resgatar", "resgate", "resgatei", "retirar", "retirada", "retirei", "tirar", "tirei", "sacar", "saque", "saquei"])) return "resgatar";
  if (hasApproximateToken(text, ["guardar", "guarde", "guardei", "depositar", "deposito", "depositei", "adicionar", "adicionei", "colocar", "coloquei", "aporte"])) return "guardar";
  return null;
}

function isPastGoalMovement(message: string): boolean {
  const text = normalize(message);
  return hasApproximateToken(text, ["resgatei", "retirei", "tirei", "saquei", "guardei", "depositei", "adicionei", "coloquei"])
    || /\b(fiz|realizei|efetuei)\b.*\b(retirada|resgate|saque|aporte|deposito)\b/.test(text);
}

function active(row: LocalDemoRow): boolean {
  return row.arquivado !== true && row.ativo !== false && row.ativa !== 0 && row.ativa !== false;
}

function rowsMentioned(rows: LocalDemoRow[], message: string, predicate: (row: LocalDemoRow) => boolean = () => true): LocalDemoRow[] {
  const messageTokens = tokens(message);
  return rows
    .filter((row) => predicate(row) && normalize(row.nome).length >= 2 && fuzzyContainsName(message, row.nome))
    .sort((left, right) => {
      const leftFirst = tokens(left.nome).find((token) => token.length > 1) ?? "";
      const rightFirst = tokens(right.nome).find((token) => token.length > 1) ?? "";
      const leftIndex = messageTokens.findIndex((token) => approximatelyEqual(token, leftFirst));
      const rightIndex = messageTokens.findIndex((token) => approximatelyEqual(token, rightFirst));
      return leftIndex - rightIndex;
    });
}

function transactionMentioned(
  rows: LocalDemoRow[],
  message: string,
  status: "pending" | "completed" | "any" = "any",
): LocalDemoRow | null {
  const messageTokens = tokens(message);
  const ignored = new Set(["fixa", "fixo", "parcela", "parcelado", "mensal", "anual", "semanal"]);
  return rows
    .filter((row) => {
      if (status === "pending" && row.status === "paga") return false;
      if (status === "completed" && row.status !== "paga") return false;
      const descriptionTokens = tokens(String(row.descricao ?? "")
        .replace(/\s*\[[^\]]+\]/g, "")
        .replace(/\([^)]*(?:fixa|fixo|\d+\s*\/\s*\d+)[^)]*\)/gi, ""))
        .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d+$/.test(token));
      return descriptionTokens.length > 0 && descriptionTokens.every((descriptionToken) => (
        messageTokens.some((messageToken) => approximatelyEqual(messageToken, descriptionToken))
      ));
    })
    .sort((left, right) => {
      const leftDistance = Math.abs(Date.parse(`${String(left.data_vencimento)}T12:00:00Z`) - Date.parse(`${DEMO_TODAY}T12:00:00Z`));
      const rightDistance = Math.abs(Date.parse(`${String(right.data_vencimento)}T12:00:00Z`) - Date.parse(`${DEMO_TODAY}T12:00:00Z`));
      return leftDistance - rightDistance;
    })[0] ?? null;
}

function purchaseMentioned(rows: LocalDemoRow[], message: string): LocalDemoRow | null {
  const messageTokens = tokens(message);
  return rows
    .filter((row) => {
      const descriptionTokens = tokens(row.descricao).filter((token) => token.length >= 3 && !/^\d+$/.test(token));
      return descriptionTokens.length > 0 && descriptionTokens.every((descriptionToken) => (
        messageTokens.some((messageToken) => approximatelyEqual(messageToken, descriptionToken))
      ));
    })
    .sort((left, right) => String(right.data_compra ?? "").localeCompare(String(left.data_compra ?? "")))[0] ?? null;
}

function valueAfterPara(message: string): string | null {
  const value = message.match(/\bpara\s+(.+?)\s*$/i)?.[1]?.trim();
  return value && value.length >= 1 ? value : null;
}

function updateFieldFromMessage(intent: FinanceAiMutationIntent, message: string): string | null {
  const text = normalize(message);
  if (/\brenome|\bnome\b/.test(text)) return intent === "update_transaction" || intent === "update_card_purchase" ? "description" : "name";
  if (hasApproximateToken(text, ["descricao"])) return "description";
  if (/\bsaldo inicial\b/.test(text)) return "initialBalance";
  if (hasApproximateToken(text, ["limite"])) return "value";
  if (/\bvalor da meta\b/.test(text) || (intent === "update_goal" && hasApproximateToken(text, ["meta"]))) return "targetAmount";
  if (hasApproximateToken(text, ["vencimento"])) return "dueDay";
  if (hasApproximateToken(text, ["fechamento"])) return "closingDay";
  if (hasApproximateToken(text, ["cor"])) return "color";
  if (hasApproximateToken(text, ["icone"])) return "icon";
  if (hasApproximateToken(text, ["data", "prazo"])) return intent === "update_goal" ? "targetDate" : "scheduledDate";
  if (intent === "update_transaction" && hasApproximateToken(text, ["conta"])) return "accountId";
  if ((intent === "update_transaction" || intent === "update_card_purchase") && hasApproximateToken(text, ["categoria"])) return "categoryId";
  if (hasApproximateToken(text, ["valor", "saldo"])) return "value";
  return null;
}

function remainderModeFrom(message: string): "full" | "keep_open" | "carry" | null {
  const text = normalize(message);
  if (/\b(proxima fatura|levar|carregar|rolar)\b/.test(text)) return "carry";
  if (/\b(manter aberta|pagamento parcial|parcial)\b/.test(text)) return "keep_open";
  if (/\b(total|integral|quitar tudo)\b/.test(text)) return "full";
  return null;
}

function explicitMutationIntent(message: string): FinanceAiMutationIntent | null {
  const text = normalize(message);
  const question = /^(quanto|quantos|quanta|quantas|qual|quais|como|quando|onde|por que)\b/.test(text) || message.trim().endsWith("?");
  const create = hasApproximateToken(text, ["crie", "criar", "cadastre", "cadastrar", "adicione", "adicionar", "registre", "registrar", "lance", "lancar", "inclua", "incluir", "nova", "novo"]);
  const update = hasApproximateToken(text, ["edite", "editar", "altere", "alterar", "atualize", "atualizar", "renomeie", "renomear"]);
  const remove = hasApproximateToken(text, ["exclua", "excluir", "apague", "apagar", "remova", "remover", "delete", "deletar"]);
  const archive = hasApproximateToken(text, ["arquive", "arquivar"]);
  const reactivate = hasApproximateToken(text, ["reative", "reativar", "desarquive", "desarquivar"]);

  if (!question && hasApproximateToken(text, ["estorne", "estornar", "reverta", "reverter"]) && hasApproximateToken(text, ["fatura"])) return "reverse_invoice_payment";
  if (!question && hasApproximateToken(text, ["pague", "pagar", "quite", "quitar"]) && hasApproximateToken(text, ["fatura"])) return "pay_invoice";
  if (!question && hasApproximateToken(text, ["transfira", "transferir", "transferencia"]) && (create || hasApproximateToken(text, ["transfira", "transferir"]))) return "transfer_between_accounts";
  if (operationFrom(message) && /\b(objetivo|caixinha|meta)\b/.test(text)) return "move_goal";
  if (!question && hasApproximateToken(text, ["reabra", "reabrir"])) {
    if (hasApproximateToken(text, ["conta"])) return "reactivate_account";
    if (hasApproximateToken(text, ["categoria"])) return "reactivate_category";
    if (hasApproximateToken(text, ["objetivo", "caixinha", "meta"])) return "reactivate_goal";
    if (hasApproximateToken(text, ["cartao"])) return "reactivate_card";
    return "reopen_transaction";
  }
  const completionStatement = /\bacabei\s+de\b/.test(text)
    || /\bja\b/.test(text)
    || hasApproximateToken(text, ["paguei", "recebi", "quitei", "conclui"]);
  const completionVerb = hasApproximateToken(text, ["paguei", "pagar", "pago", "recebi", "receber", "recebido", "quitei", "quitar", "conclui", "concluir", "realizado"]);
  if (!question && !create && !update && !remove && !archive && !reactivate && completionStatement && completionVerb && !hasApproximateToken(text, ["fatura"])) return "complete_transaction";
  if (!question && !create && !update && !remove && !archive && !reactivate && hasApproximateToken(text, ["marque", "marcar", "conclua", "concluir"]) && completionVerb) return "complete_transaction";

  const action = remove ? "delete" : archive ? "archive" : reactivate ? "reactivate" : update ? "update" : create ? "create" : null;
  if (!action) return null;
  const cardIndex = approximateTokenIndex(text, ["cartao"]);
  const entityCandidates = [
    { entity: "card_purchase", index: cardIndex >= 0 ? approximateTokenIndex(text, ["compra", "fatura"]) : -1 },
    { entity: "transaction", index: approximateTokenIndex(text, ["transacao", "lancamento", "despesa", "receita", "gasto", "entrada", "saida"]) },
    { entity: "category", index: approximateTokenIndex(text, ["categoria"]) },
    { entity: "goal", index: approximateTokenIndex(text, ["objetivo", "caixinha", "meta"]) },
    { entity: "account", index: approximateTokenIndex(text, ["conta"]) },
    { entity: "card", index: cardIndex },
  ].filter((candidate) => candidate.index >= 0).sort((left, right) => left.index - right.index);
  const entity = entityCandidates[0]?.entity;
  if (entity === "card_purchase") return `${action === "archive" || action === "reactivate" ? "update" : action}_card_purchase` as FinanceAiMutationIntent;
  if (entity) return `${action}_${entity}` as FinanceAiMutationIntent;
  return null;
}

function navigationIntent(message: string): { intent: FinanceAiNavigationIntent; route: string } | null {
  const text = normalize(message);
  if (!/\b(abra|abrir|va para|navegue|mostre a tela)\b/.test(text)) return null;
  if (text.includes("histor")) return { intent: "open_history", route: "/transacoes" };
  if (/\bobjet|caixinha/.test(text)) return { intent: "open_goals", route: "/caixinhas" };
  if (text.includes("fluxo")) return { intent: "open_cash_flow", route: "/relatorios" };
  if (text.includes("cart")) return { intent: "open_cards", route: "/cartoes" };
  if (text.includes("categor")) return { intent: "open_categories", route: "/?abrirCategorias=1" };
  if (/\binicio|home\b/.test(text)) return { intent: "open_home", route: "/" };
  return null;
}

function readIntent(message: string): FinanceAiReadIntent | "out_of_scope" {
  const text = normalize(message);
  if (hasApproximateToken(text, ["cartao", "fatura", "limite"])) return "card_summary";
  if (hasApproximateToken(text, ["objetivo", "caixinha", "meta", "guardado", "reserva"])) return "goal_progress";
  if (hasApproximateToken(text, ["categoria"])) return "category_analysis";
  if (hasApproximateToken(text, ["fluxo"])) return "cash_flow";
  if (/\bfim do (?:mes|ano)\b|\bfinal do ano\b|\bvai sobrar\b|\b(?:vou ter|terei|teremos)\b/.test(text) || hasApproximateToken(text, ["projecao", "previsao", "previsto"])) return "financial_projection";
  if (/\bmaior despesa\b/.test(text) || hasApproximateToken(text, ["orcamento", "gasto", "economizar", "poupar"])) return "budget_analysis";
  if (hasApproximateToken(text, ["transacao", "lancamento", "despesa", "receita", "entrada", "saida", "pendente", "atrasado", "vence", "vencido"])) return "list_transactions";
  if (hasApproximateToken(text, ["saldo", "financeiro", "financas", "dinheiro", "conta", "contas"])) return "financial_summary";
  if (/\bcomo funciona|controle financeiro|organizar\b/.test(text)) return "explain_financial_control";
  return "out_of_scope";
}

function titleFor(intent: FinanceAiMutationIntent): string {
  const labels: Partial<Record<FinanceAiMutationIntent, string>> = {
    create_account: "Criar conta", create_category: "Criar categoria", create_goal: "Criar objetivo",
    create_transaction: "Criar lançamento", transfer_between_accounts: "Criar transferência",
    create_card: "Criar cartão", create_card_purchase: "Lançar compra no cartão", move_goal: "Movimentar objetivo",
    complete_transaction: "Concluir lançamento", reopen_transaction: "Reabrir lançamento",
  };
  return labels[intent] ?? "Revisar ação financeira";
}

export class LocalDemoOperationalFinanceAi {
  private sequence = 1;
  private messageSequence = 1;
  private modelUsed = 0;
  private actionsUsed = 0;
  private activeConversationId: string | null = null;
  private readonly conversations = new Map<string, StoredMessage[]>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly drafts = new Map<string, Draft>();
  private readonly completionReceipts = new Map<number, Array<{
    paymentId: string;
    paymentTransactionId: number;
    expectedValue: number;
    realizedValue: number;
    remainingValue: number;
    realizationDate: string;
    usedRootAsPayment: boolean;
    reopened: boolean;
  }>>();

  constructor(private readonly context: FinanceAiContext) {}

  private uuid(prefix: string): string {
    return `${prefix}0000000-0000-4000-8000-${String(this.sequence++).padStart(12, "0")}`;
  }

  private quota() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return {
      plan: "premium", limits_enabled: false, limit: 50, used: this.actionsUsed,
      remaining: Math.max(0, 50 - this.actionsUsed), model_limit: 200, model_used: this.modelUsed,
      model_remaining: Math.max(0, 200 - this.modelUsed), window_start: start.toISOString(),
      window_end: end.toISOString(), timezone: "America/Sao_Paulo" as const,
    };
  }

  private isInternalMovement(row: LocalDemoRow | undefined): boolean {
    const description = String(row?.descricao ?? "");
    return row !== undefined && (
      row.categoria_id == null
      || description.startsWith("[Transf.]")
      || /\[(?:Destino:|Objetivo:|PagFatura:)/.test(description)
    );
  }

  private activePayments(rootTransactionId: number) {
    return (this.completionReceipts.get(rootTransactionId) ?? []).filter((receipt) => !receipt.reopened);
  }

  private paidTotal(rootTransactionId: number): number {
    return Math.round(this.activePayments(rootTransactionId)
      .reduce((total, receipt) => total + receipt.realizedValue, 0) * 100) / 100;
  }

  private rootTransaction(row: LocalDemoRow | null | undefined): LocalDemoRow | undefined {
    if (!row) return undefined;
    const parentId = Number(row.transacao_pai_id);
    if (!Number.isInteger(parentId) || parentId <= 0) return row;
    return this.rows("transacoes").find((candidate) => Number(candidate.id) === parentId);
  }

  private ensureConversation(candidate?: unknown): string {
    if (typeof candidate === "string" && this.conversations.has(candidate)) return candidate;
    const id = this.uuid("4");
    this.conversations.set(id, []);
    this.activeConversationId = id;
    return id;
  }

  private addMessage(conversationId: string, role: "user" | "assistant", text: string, intent: FinanceAiIntent | null): void {
    this.conversations.get(conversationId)?.push({ id: String(this.messageSequence++), role, text, createdAt: new Date().toISOString(), intent });
  }

  private rows(table: string): LocalDemoRow[] {
    return this.context.database[table] ?? (this.context.database[table] = []);
  }

  private hasPartner(): boolean {
    return this.rows("parcerias").some((row) => {
      const status = normalize(row.status ?? row.situacao ?? "");
      return status === "ativa" || status === "ativo" || status === "aceita" || status === "aceito";
    });
  }

  private inferredMutationIntent(message: string): FinanceAiMutationIntent | null {
    const text = normalize(message);
    const question = /^(quanto|quantos|quanta|quantas|qual|quais|como|quando|onde|por que)\b/.test(text) || message.trim().endsWith("?");
    if (question || !operationFrom(message)) return null;

    const mentionsKnownGoal = rowsMentioned(this.rows("caixinhas"), message, active).length > 0;
    return mentionsKnownGoal || isPastGoalMovement(message) ? "move_goal" : null;
  }

  private parseNewValue(intent: FinanceAiMutationIntent, field: string, message: string): unknown {
    const tail = valueAfterPara(message) ?? message.trim();
    if (["value", "targetAmount", "initialBalance"].includes(field)) return moneyFrom(tail, true);
    if (["dueDay", "closingDay"].includes(field)) return integerFrom(tail);
    if (["scheduledDate", "targetDate"].includes(field)) return /\b(remover|limpar|sem prazo)\b/.test(normalize(tail)) ? null : parseDate(tail);
    if (field === "accountId") return rowsMentioned(this.rows("contas"), tail, active)[0]?.id ?? null;
    if (field === "categoryId") {
      const expectedType = intent === "update_card_purchase" ? "despesa" : undefined;
      return rowsMentioned(this.rows("categorias"), tail, (row) => active(row) && (!expectedType || row.tipo === expectedType))[0]?.id ?? null;
    }
    return tail.length >= 1 ? tail : null;
  }

  private resolveEntities(intent: FinanceAiMutationIntent, message: string, data: ActionData): void {
    const accounts = rowsMentioned(this.rows("contas"), message, active);
    const categories = rowsMentioned(this.rows("categorias"), message, (row) => active(row) && (!data.type || row.tipo === data.type));
    const goals = rowsMentioned(this.rows("caixinhas"), message, active);
    const cards = rowsMentioned(this.rows("cartoes"), message, active);
    if (accounts[0] && data.accountId === undefined) { data.accountId = accounts[0].id; data.accountName = accounts[0].nome; }
    if (intent === "transfer_between_accounts" && accounts[1] && data.destinationAccountId === undefined) { data.destinationAccountId = accounts[1].id; data.destinationAccountName = accounts[1].nome; }
    if (categories[0] && data.categoryId === undefined) { data.categoryId = categories[0].id; data.categoryName = categories[0].nome; }
    if (goals[0] && data.goalId === undefined) { data.goalId = goals[0].id; data.goalName = goals[0].nome; }
    if (cards[0] && data.cardId === undefined) { data.cardId = cards[0].id; data.cardName = cards[0].nome; }

    if (/transaction$/.test(intent) || intent === "complete_transaction" || intent === "reopen_transaction") {
      const requiredStatus = intent === "complete_transaction" ? "pending" : intent === "reopen_transaction" ? "completed" : "any";
      const transactionRows = intent === "reopen_transaction"
        ? this.rows("transacoes")
        : this.rows("transacoes").filter((item) => item.transacao_pai_id === null || item.transacao_pai_id === undefined);
      const mentioned = transactionMentioned(transactionRows, message, requiredStatus);
      const row = intent === "reopen_transaction" ? this.rootTransaction(mentioned) : mentioned;
      if (row && data.transactionId === undefined) {
        data.transactionId = row.id;
        data.transactionName = String(row.descricao ?? "Lançamento").replace(/\s*\[[^\]]+\]/g, "");
      }
    }
    if (intent === "complete_transaction" && data.transactionId !== undefined) {
      const selected = this.rows("transacoes").find((item) => item.id === data.transactionId);
      data.expectedValue = Number(selected?.valor ?? 0);
    }
    if (intent === "update_card_purchase" || intent === "delete_card_purchase") {
      const row = purchaseMentioned(this.rows("fatura_itens"), message);
      if (row && data.purchaseId === undefined) { data.purchaseId = row.id; data.purchaseName = row.descricao; }
    }
    if (intent === "reverse_invoice_payment") {
      const payments = this.rows("transacoes").filter((row) => String(row.descricao ?? "").includes("[PagFatura:"));
      const row = transactionMentioned(payments, message, "completed") ?? (payments.length === 1 ? payments[0] : null);
      if (row) { data.transactionId = row.id; data.transactionName = row.descricao; }
    }
  }

  private parseInitial(intent: FinanceAiMutationIntent, message: string): ActionData {
    const data: ActionData = {};
    const normalizedMessage = normalize(message);
    const name = namedValue(message);
    const money = moneyFrom(message);
    const date = parseDate(message);
    const frequency = frequencyFrom(message);
    const type = typeFrom(message);
    const status = statusFrom(message);
    const installments = installmentsFrom(message);
    if (type) data.type = type;
    if (status) data.status = status;
    if (frequency) data.frequency = frequency;
    if (date) { data.scheduledDate = date; data.purchaseDate = date; if (status === "paga") data.realizationDate = date; }
    if (installments) data.installments = installments;
    const recurrenceCount = recurrenceCountFrom(message);
    if (recurrenceCount) data.recurrenceCount = recurrenceCount;

    if (intent === "create_account") {
      if (name) data.name = name;
      else {
        const match = message.match(/\bconta\s+([^,]+?)(?=\s+com\s+saldo|,|$)/i)?.[1]?.replace(/^chamada\s+/i, "").trim();
        if (match && !/^(uma|nova)$/i.test(match)) data.name = match;
      }
      const initialBalance = moneyAfterLabel(message, "saldo(?:\\s+inicial)?") ?? money;
      if (initialBalance !== null) data.initialBalance = initialBalance;
      if (/\bcor\b/.test(normalizedMessage)) data.color = colorFrom(message, "#457B9D") ?? undefined;
      if (this.hasPartner()) {
        const shared = booleanFrom(message);
        if (shared !== null && /\b(conjunta|conjunto|compartilhada|compartilhado|individual)\b/.test(normalizedMessage)) data.shared = shared;
      } else data.shared = false;
    } else if (intent === "create_category") {
      if (name) data.name = name;
      else {
        const match = message.match(/\bcategoria\s+([^,]+?)(?=\s+(?:para|de)\s+(?:receita|despesa)|,|$)/i)?.[1]?.replace(/^chamada\s+/i, "").trim();
        if (match && !/^(uma|nova)$/i.test(match)) data.name = match;
      }
      if (/\bcor\b/.test(normalizedMessage)) data.color = colorFrom(message) ?? undefined;
      if (/\bicone\b/.test(normalizedMessage)) data.icon = iconFrom(message, "label") ?? undefined;
    } else if (intent === "create_goal") {
      if (name) data.name = name;
      else {
        const match = message.match(/\b(?:objetivo|caixinha)\s+([^,]+?)(?=\s+(?:com\s+)?meta|\s+de\s+r\$|,|$)/i)?.[1]?.replace(/^chamad[oa]\s+/i, "").trim();
        if (match && !/^(um|uma|novo|nova)$/i.test(match)) data.name = match;
      }
      const targetAmount = moneyAfterLabel(message, "(?:valor\\s+da\\s+)?meta") ?? money;
      const initialBalance = moneyAfterLabel(message, "saldo(?:\\s+inicial)?|ja\\s+guardado");
      if (targetAmount !== null) data.targetAmount = targetAmount;
      if (initialBalance !== null) data.initialBalance = initialBalance;
      const targetDate = message.match(/(?:ate|até|prazo)\s+([^,]+)/i)?.[1];
      if (targetDate && parseDate(targetDate)) { data.targetDate = parseDate(targetDate); data.targetDateProvided = true; }
      else if (noDeadline(message)) { data.targetDate = null; data.targetDateProvided = true; }
      if (/\bcor\b/.test(normalizedMessage)) data.color = colorFrom(message) ?? undefined;
      if (/\bicone\b/.test(normalizedMessage)) data.icon = iconFrom(message, "savings") ?? undefined;
      if (this.hasPartner()) {
        const shared = booleanFrom(message);
        if (shared !== null && /\b(conjunto|conjunta|compartilhado|compartilhada|individual)\b/.test(normalizedMessage)) data.shared = shared;
      } else data.shared = false;
    } else if (intent === "create_card") {
      if (name) data.name = name;
      else {
        const match = message.match(/\bcart(?:a|ã)o\s+([^,]+?)(?=\s+(?:com\s+)?limite|,|$)/i)?.[1]?.replace(/^chamado\s+/i, "").trim();
        if (match && !/^(um|novo)$/i.test(match)) data.name = match;
      }
      if (money !== null) data.value = money;
      const due = Number(message.match(/vencimento\s*(?:no\s+dia|dia|:)?\s*(\d{1,2})/i)?.[1]);
      const close = Number(message.match(/fechamento\s*(?:no\s+dia|dia|:)?\s*(\d{1,2})/i)?.[1]);
      if (due >= 1 && due <= 31) data.dueDay = due;
      if (close >= 1 && close <= 31) data.closingDay = close;
      if (/\bcor\b/.test(normalizedMessage)) data.color = colorFrom(message, "#457B9D") ?? undefined;
    } else if (intent === "create_transaction") {
      if (money !== null) data.value = money;
      if (name) data.description = name;
    } else if (intent === "transfer_between_accounts") {
      if (money !== null) data.value = money;
      data.description = name ?? "Transferência";
    } else if (intent === "create_card_purchase") {
      if (money !== null) data.value = money;
      if (name) data.description = name;
    } else if (intent === "move_goal") {
      if (money !== null) data.value = money;
      data.operation = operationFrom(message);
      data.description = name ?? (data.operation === "resgatar" ? "Resgate do objetivo" : "Aporte no objetivo");
      data.frequency = frequency ?? "unica";
      if (date) data.realizationDate = date;
      else if (isPastGoalMovement(message)) data.realizationDate = DEMO_TODAY;
    } else if (intent === "complete_transaction") {
      const completionStatement = /\bacabei\s+de\b/.test(normalize(message))
        || /\bja\b/.test(normalize(message))
        || hasApproximateToken(message, ["paguei", "recebi", "quitei", "conclui"]);
      data.realizationDate = date ?? (completionStatement ? DEMO_TODAY : undefined);
      if (money !== null) data.realizedValue = money;
    } else if (intent === "pay_invoice") {
      if (money !== null) data.paymentAmount = money;
      data.invoiceMonth = date?.slice(0, 7) ?? DEMO_MONTH;
      data.remainderMode = remainderModeFrom(message);
    }
    this.resolveEntities(intent, message, data);
    if (intent.startsWith("update_")) {
      const field = updateFieldFromMessage(intent, message);
      if (field) {
        data.field = field;
        const next = this.parseNewValue(intent, field, message);
        if (next !== null && next !== undefined) data.newValue = next;
      }
      if (intent === "update_transaction") {
        data.updateScope = /\b(?:toda?s?|todos?)\s+(?:(?:a|as|o|os)\s+)?(?:serie|recorrencia|parcelas?|agendamentos?)\b|\b(?:serie|recorrencia)\s+inteira\b/u.test(normalizedMessage)
          ? "series"
          : "single";
      }
    }
    if (intent === "pay_invoice" && data.cardId !== undefined) {
      const total = this.rows("fatura_itens")
        .filter((row) => row.cartao_id === data.cardId && row.mes_fatura === data.invoiceMonth && row.pago !== true)
        .reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
      data.invoiceOpenAmount = total;
      if (Number(data.paymentAmount) === total && total > 0) data.remainderMode = "full";
    }
    if (installments && money !== null && /\b\d{1,3}\s*x\s*de\s*r\$/i.test(message)) {
      data.installmentValue = money;
      data.value = Math.round(money * installments * 100) / 100;
    }
    return data;
  }

  private applyField(intent: FinanceAiMutationIntent, field: string, message: string, data: ActionData): boolean {
    const trimmed = message.trim().replace(/^["“”']|["“”']$/g, "");
    if (field === "name" || field === "description") { if (trimmed.length >= 2) data[field] = trimmed; }
    else if (field === "type") data.type = typeFrom(message);
    else if (field === "value" || field === "targetAmount" || field === "initialBalance" || field === "realizedValue") {
      const value = moneyFrom(message, true);
      const valid = value !== null
        && (field === "initialBalance" ? value >= 0 : value > 0)
        && !(field === "initialBalance" && intent === "create_goal" && value > Number(data.targetAmount));
      if (valid) data[field] = value;
    }
    else if (field === "status") data.status = statusFrom(message);
    else if (field === "frequency") data.frequency = frequencyFrom(message);
    else if (field === "targetDate") {
      if (noDeadline(message)) { data.targetDate = null; data.targetDateProvided = true; }
      else {
        const date = parseDate(message);
        if (date && date >= DEMO_TODAY) { data.targetDate = date; data.targetDateProvided = true; }
      }
    }
    else if (field === "scheduledDate" || field === "purchaseDate" || field === "realizationDate") data[field] = parseDate(message);
    else if (field === "installments" || field === "recurrenceCount" || field === "dueDay" || field === "closingDay") {
      const value = integerFrom(message);
      const valid = value !== null
        && (field === "dueDay" || field === "closingDay" ? value >= 1 && value <= 31
          : field === "installments" ? value >= 2 && (intent !== "create_card_purchase" || value <= 48)
            : value >= 1);
      if (valid) data[field] = value;
    }
    else if (field === "color") data.color = colorFrom(message, intent === "create_account" || intent === "create_card" ? "#457B9D" : "#2A9D8F") ?? undefined;
    else if (field === "icon") data.icon = iconFrom(message, intent === "create_goal" ? "savings" : "label") ?? undefined;
    else if (field === "shared") {
      const shared = booleanFrom(message);
      if (shared !== null) data.shared = shared;
    }
    else if (field === "operation") data.operation = operationFrom(message);
    else if (field === "field") data.field = updateFieldFromMessage(intent, message);
    else if (field === "newValue" && typeof data.field === "string") data.newValue = this.parseNewValue(intent, data.field, message);
    else if (field === "paymentAmount") data.paymentAmount = moneyFrom(message, true);
    else if (field === "invoiceMonth") data.invoiceMonth = parseDate(message)?.slice(0, 7) ?? (/^20\d{2}-\d{2}$/.test(message.trim()) ? message.trim() : null);
    else if (field === "remainderMode") data.remainderMode = remainderModeFrom(message);
    else {
      this.resolveEntities(intent, message, data);
      if (field === "destinationAccountId" && data.destinationAccountId === undefined) {
        const row = rowsMentioned(this.rows("contas"), message, active)[0];
        if (row && row.id !== data.accountId) { data.destinationAccountId = row.id; data.destinationAccountName = row.nome; }
      }
    }
    return this.fieldAnswered(field, data);
  }

  private fieldAnswered(field: string, data: ActionData): boolean {
    if (field === "targetDate") return data.targetDateProvided === true;
    return data[field] !== undefined && data[field] !== null && data[field] !== "";
  }

  private requiredFields(intent: FinanceAiMutationIntent, data: ActionData): string[] {
    if (intent === "create_account") return ["name", "initialBalance", "color", ...(this.hasPartner() ? ["shared"] : [])];
    if (intent === "create_category") return ["type", "name", "color", "icon"];
    if (intent === "create_goal") return ["name", "targetAmount", "initialBalance", "targetDate", "color", "icon", ...(this.hasPartner() ? ["shared"] : [])];
    if (intent === "create_card") return ["name", "value", "dueDay", "closingDay", "color"];
    if (intent === "create_transaction") {
      const fields = ["type", "frequency", "scheduledDate", "description", "value", "accountId", "categoryId"];
      if (data.frequency === "unica") fields.splice(2, 0, "status");
      if (data.status === "paga") fields.push("realizationDate");
      if (data.frequency === "parcelada") fields.push("installments");
      return fields;
    }
    if (intent === "transfer_between_accounts") {
      const fields = ["frequency", "scheduledDate", "description", "value", "accountId", "destinationAccountId"];
      if (data.frequency === "unica") fields.splice(1, 0, "status");
      if (data.status === "paga") fields.push("realizationDate");
      if (data.frequency === "parcelada") fields.push("installments");
      return fields;
    }
    if (intent === "create_card_purchase") {
      const fields = ["cardId", "categoryId", "description", "value", "purchaseDate", "frequency"];
      if (data.frequency === "parcelada") fields.push("installments");
      return fields;
    }
    if (intent === "move_goal") return ["operation", "goalId", "accountId", "value", "description", "realizationDate"];
    if (intent === "complete_transaction") return ["transactionId", "realizationDate", "realizedValue"];
    if (intent === "reopen_transaction" || intent === "delete_transaction") return ["transactionId"];
    if (intent === "update_transaction") return ["transactionId", "field", "newValue"];
    if (intent === "update_card_purchase") return ["purchaseId", "field", "newValue"];
    if (intent === "delete_card_purchase") return ["purchaseId"];
    if (intent === "pay_invoice") return ["cardId", "invoiceMonth", "accountId", "paymentAmount", "remainderMode"];
    if (intent === "reverse_invoice_payment") return ["transactionId"];
    if (intent.startsWith("update_") && intent.endsWith("_account")) return ["accountId", "field", "newValue"];
    if (intent.startsWith("update_") && intent.endsWith("_category")) return ["categoryId", "field", "newValue"];
    if (intent.startsWith("update_") && intent.endsWith("_goal")) return ["goalId", "field", "newValue"];
    if (intent.startsWith("update_") && intent.endsWith("_card")) return ["cardId", "field", "newValue"];
    if (intent.endsWith("_account")) return ["accountId"];
    if (intent.endsWith("_category")) return ["categoryId"];
    if (intent.endsWith("_goal")) return ["goalId"];
    if (intent.endsWith("_card")) return ["cardId"];
    return [];
  }

  private firstMissing(intent: FinanceAiMutationIntent, data: ActionData): string | null {
    return this.requiredFields(intent, data).find((field) => !this.fieldAnswered(field, data)) ?? null;
  }

  private questionFor(field: string, data: ActionData): string {
    const accountNames = this.rows("contas").filter(active).map((row) => row.nome).join(", ");
    const categoryNames = this.rows("categorias").filter((row) => active(row) && (!data.type || row.tipo === data.type)).map((row) => row.nome).join(", ");
    const goalNames = this.rows("caixinhas").filter(active).map((row) => row.nome).join(", ");
    const cardNames = this.rows("cartoes").filter(active).map((row) => row.nome).join(", ");
    const accountQuestion = data.goalName && data.operation === "resgatar"
      ? `Em qual conta devo depositar os ${formatMoney(Number(data.value))} resgatados do objetivo ${data.goalName}? Opções: ${accountNames}.`
      : data.goalName && data.operation === "guardar"
        ? `De qual conta sairão os ${formatMoney(Number(data.value))} guardados no objetivo ${data.goalName}? Opções: ${accountNames}.`
        : `Qual conta? Opções: ${accountNames}.`;
    const questions: Record<string, string> = {
      realizedValue: `Quanto foi efetivamente pago ou recebido? Valor previsto: ${formatMoney(Number(data.expectedValue ?? 0))}.`,
      name: "Qual nome você quer usar?", type: "É uma receita ou uma despesa?",
      value: "Qual é o valor?", targetAmount: "Qual é o valor da meta?",
      initialBalance: "Qual é o saldo inicial? Se ainda estiver zerado, responda 0.",
      status: "Esse lançamento já foi realizado ou ficará pendente?",
      frequency: "Qual é a frequência: única, parcelada, semanal, mensal ou anual?",
      scheduledDate: "Qual é a data agendada? Você pode responder hoje ou DD/MM/AAAA.",
      purchaseDate: "Qual foi a data da compra?", realizationDate: "Qual foi a data de realização?",
      targetDate: "Qual é a data prevista para alcançar a meta? Responda DD/MM/AAAA ou sem prazo.", description: "Qual é a descrição?",
      color: "Qual cor você prefere? Opções: verde, amarelo, laranja, coral, azul, roxo ou vermelho. Você também pode responder padrão.",
      icon: "Qual ícone você prefere? Exemplos: economia, casa, viagem, notebook, escola, alimentação ou dinheiro. Você também pode responder padrão.",
      shared: "Este item será conjunto com seu parceiro? Responda sim ou não.",
      accountId: accountQuestion,
      destinationAccountId: `Qual é a conta de destino? Opções: ${accountNames}.`,
      categoryId: `Qual categoria? Opções compatíveis: ${categoryNames}.`,
      goalId: `Qual objetivo? Opções: ${goalNames}.`, cardId: `Qual cartão? Opções: ${cardNames}.`,
      transactionId: "Qual lançamento? Informe a descrição exibida no histórico.",
      purchaseId: "Qual compra do cartão? Informe a descrição exibida na fatura.",
      installments: "Em quantas parcelas?", recurrenceCount: "Por quantas ocorrências?",
      dueDay: "Qual é o dia de vencimento da fatura?", closingDay: "Qual é o dia de fechamento?",
      operation: "Você quer guardar ou resgatar dinheiro?",
      field: "O que você quer alterar: nome, valor, conta, categoria, data, cor, vencimento ou fechamento?",
      newValue: "Qual é o novo valor dessa informação?",
      paymentAmount: "Qual valor você pagou da fatura?",
      invoiceMonth: "Qual é o mês da fatura? Informe uma data desse mês.",
      remainderMode: "O pagamento é total, parcial mantendo a fatura aberta, ou o restante vai para a próxima fatura?",
    };
    return questions[field] ?? "Qual informação falta para concluir a solicitação?";
  }

  private summary(intent: FinanceAiMutationIntent, data: ActionData): string {
    if (intent === "create_account") return `Conta: ${data.name}\nSaldo inicial: ${formatMoney(Number(data.initialBalance))}\nCor: ${data.color}${this.hasPartner() ? `\nConjunta: ${data.shared ? "sim" : "não"}` : ""}`;
    if (intent === "create_category") return `Categoria: ${data.name}\nTipo: ${data.type}\nCor: ${data.color}\nÍcone: ${data.icon}`;
    if (intent === "create_goal") return `Objetivo: ${data.name}\nMeta: ${formatMoney(Number(data.targetAmount))}\nSaldo inicial: ${formatMoney(Number(data.initialBalance))}\nData prevista: ${data.targetDate ? formatDate(String(data.targetDate)) : "sem prazo"}\nCor: ${data.color}\nÍcone: ${data.icon}${this.hasPartner() ? `\nConjunto: ${data.shared ? "sim" : "não"}` : ""}`;
    if (intent === "create_card") return `Cartão: ${data.name}\nLimite: ${formatMoney(Number(data.value))}\nFechamento: dia ${data.closingDay}\nVencimento: dia ${data.dueDay}\nCor: ${data.color}`;
    if (intent === "create_transaction") return `${data.type === "receita" ? "Receita" : "Despesa"}: ${data.description}\nValor: ${formatMoney(Number(data.value))}\nConta: ${data.accountName}\nCategoria: ${data.categoryName}\nData agendada: ${formatDate(String(data.scheduledDate))}\nStatus: ${data.status}\nFrequência: ${data.frequency}`;
    if (intent === "transfer_between_accounts") return `Transferência: ${data.description}\nValor: ${formatMoney(Number(data.value))}\nDe: ${data.accountName}\nPara: ${data.destinationAccountName}\nData: ${formatDate(String(data.scheduledDate))}\nStatus: ${data.status}`;
    if (intent === "create_card_purchase") return `Compra: ${data.description}\nValor total: ${formatMoney(Number(data.value))}\nCartão: ${data.cardName}\nCategoria: ${data.categoryName}\nData: ${formatDate(String(data.purchaseDate))}\nFrequência: ${data.frequency}`;
    if (intent === "move_goal") return `${data.operation === "resgatar" ? "Resgatar de" : "Guardar em"}: ${data.goalName}\nValor: ${formatMoney(Number(data.value))}\nConta: ${data.accountName}\nData: ${formatDate(String(data.realizationDate))}`;
    if (intent === "complete_transaction") {
      const remaining = Math.max(0, Number(data.expectedValue) - Number(data.realizedValue));
      return `Concluir: ${data.transactionName}\nValor previsto: ${formatMoney(Number(data.expectedValue))}\nValor realizado: ${formatMoney(Number(data.realizedValue))}\nSaldo restante: ${formatMoney(remaining)}\nData de realização: ${formatDate(String(data.realizationDate))}`;
    }
    if (intent.startsWith("update_")) return `Item: ${data.accountName ?? data.categoryName ?? data.goalName ?? data.cardName ?? data.transactionName ?? data.purchaseName}\nCampo: ${data.field}\nNovo valor: ${String(data.newValue)}`;
    if (intent === "pay_invoice") return `Cartão: ${data.cardName}\nFatura: ${data.invoiceMonth}\nConta: ${data.accountName}\nPagamento: ${formatMoney(Number(data.paymentAmount))}\nTratamento do restante: ${data.remainderMode}`;
    if (intent === "delete_card_purchase") return `Excluir compra: ${data.purchaseName}`;
    return `${titleFor(intent)}: ${data.accountName ?? data.categoryName ?? data.goalName ?? data.cardName ?? data.transactionName ?? "item selecionado"}`;
  }

  private createProposal(conversationId: string, intent: FinanceAiMutationIntent, data: ActionData): Record<string, unknown> {
    if (intent === "move_goal" && data.operation === "resgatar") {
      const goal = this.rows("caixinhas").find((row) => row.id === data.goalId && active(row));
      const balance = Number(goal?.saldo_atual ?? 0);
      if (Number(data.value) > balance) {
        delete data.value;
        const message = `O objetivo ${String(goal?.nome ?? data.goalName ?? "selecionado")} tem ${formatMoney(balance)} dispon\u00edveis. Qual valor menor ou igual ao saldo voc\u00ea quer resgatar?`;
        this.drafts.set(conversationId, { intent, data, missingField: "value" });
        this.addMessage(conversationId, "assistant", message, intent);
        return { kind: "clarify", conversationId, message, intent, missingFields: ["value"], quota: this.quota() };
      }
    }
    if (intent === "complete_transaction") {
      const expected = Number(data.expectedValue);
      const realized = Number(data.realizedValue);
      if (!Number.isFinite(expected) || expected <= 0 || !Number.isFinite(realized) || realized <= 0 || realized > expected) {
        delete data.realizedValue;
        const message = `Informe um valor realizado maior que zero e de no máximo ${formatMoney(expected)}.`;
        this.drafts.set(conversationId, { intent, data, missingField: "realizedValue" });
        this.addMessage(conversationId, "assistant", message, intent);
        return { kind: "clarify", conversationId, message, intent, missingFields: ["realizedValue"], quota: this.quota() };
      }
      const transaction = this.rows("transacoes").find((row) => row.id === data.transactionId);
      if (this.isInternalMovement(transaction) && Math.abs(realized - expected) > 0.005) {
        delete data.realizedValue;
        const message = `Movimentações internas precisam ser concluídas pelo valor integral de ${formatMoney(expected)}, sem pagamento parcial.`;
        this.drafts.set(conversationId, { intent, data, missingField: "realizedValue" });
        this.addMessage(conversationId, "assistant", message, intent);
        return { kind: "clarify", conversationId, message, intent, missingFields: ["realizedValue"], quota: this.quota() };
      }
    }
    if ((intent === "update_transaction" || intent === "delete_transaction") && data.transactionId !== undefined) {
      const rootTransactionId = Number(data.transactionId);
      if (this.activePayments(rootTransactionId).length > 0) {
        if (intent === "delete_transaction") {
          const message = "Este agendamento já possui pagamentos concluídos. Estorne os pagamentos do mais recente para o mais antigo antes de excluí-lo.";
          this.addMessage(conversationId, "assistant", message, "explain_financial_control");
          return { kind: "answer", conversationId, message, intent: "explain_financial_control", quota: this.quota() };
        }
        if (data.updateScope === "series") {
          const message = "Este agendamento já possui pagamentos concluídos. Você pode editar individualmente somente o saldo restante, mas não toda a série.";
          this.addMessage(conversationId, "assistant", message, "explain_financial_control");
          return { kind: "answer", conversationId, message, intent: "explain_financial_control", quota: this.quota() };
        }
      }
    }
    const id = this.uuid("5");
    const confirmationToken = this.uuid("6");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const summary = this.summary(intent, data);
    this.proposals.set(id, { id, confirmationToken, conversationId, intent, data: { ...data }, summary, expiresAt, status: "pending" });
    const message = "Entendi o pedido e preparei a prévia abaixo. Confira todos os dados antes de confirmar.";
    this.addMessage(conversationId, "assistant", message, intent);
    return {
      kind: "proposal", conversationId, message, intent,
      pendingAction: {
        id, confirmationToken, actionType: intent, expiresAt,
        preview: {
          title: titleFor(intent), summary,
          consequences: ["A alteração ocorrerá somente nos dados fictícios desta aba.", "Atualizar a página restaura o cenário original."],
        },
      },
      quota: this.quota(),
    };
  }

  private addRow(table: string, values: LocalDemoRow): LocalDemoRow {
    const rows = this.rows(table);
    const row = { id: nextId(rows), user_id: this.context.currentUser()?.id, criado_em: new Date().toISOString(), ...values };
    rows.push(row);
    return row;
  }

  private executeCreateTransaction(data: ActionData, transfer = false): Record<string, unknown> {
    const frequency = String(data.frequency);
    const count = frequency === "parcelada" ? Number(data.installments)
      : frequency === "semanal" ? 260
        : frequency === "mensal" ? 60
          : frequency === "anual" ? 5 : 1;
    const total = Number(data.value);
    const perItem = frequency === "parcelada" ? Math.round((total / count) * 100) / 100 : total;
    const series = count > 1 ? `local-${Date.now()}-${this.sequence}` : null;
    const ids: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const date = frequency === "semanal"
        ? dateWithDayOffset(String(data.scheduledDate), index * 7)
        : ["mensal", "anual", "parcelada"].includes(frequency)
          ? dateWithMonthOffset(String(data.scheduledDate), index * (frequency === "anual" ? 12 : 1))
          : String(data.scheduledDate);
      const status = data.status === "paga" && index === 0 ? "paga" : "pendente";
      const description = transfer
        ? `[Transf.] ${data.description}${series ? ` (${index + 1}/${count}) [Serie:${series}]` : ""} [Destino:${data.destinationAccountId}]`
        : `${data.description}${series ? ` (${index + 1}/${count}) [Serie:${series}]` : ""}`;
      const row = this.addRow("transacoes", {
        conta_id: data.accountId, categoria_id: transfer ? null : data.categoryId,
        tipo: transfer ? "despesa" : data.type, valor: perItem, descricao: description,
        data_vencimento: date, data_realizacao: status === "paga" ? data.realizationDate : null, status,
      });
      ids.push(Number(row.id));
    }
    return { affected_ids: ids, occurrences: count };
  }

  private execute(proposal: Proposal): Record<string, unknown> {
    const data = proposal.data;
    const intent = proposal.intent;
    if (intent === "create_account") return this.addRow("contas", { nome: data.name, saldo_inicial: Number(data.initialBalance), cor: data.color, compartilhado: Boolean(data.shared), arquivado: false, bloqueado_plano: false });
    if (intent === "create_category") return this.addRow("categorias", { nome: data.name, tipo: data.type, cor: data.color, icone: data.icon, ativa: 1, bloqueado_plano: false });
    if (intent === "create_goal") return this.addRow("caixinhas", { nome: data.name, meta_valor: Number(data.targetAmount), saldo_atual: Number(data.initialBalance), data_prazo: data.targetDate ?? null, cor: data.color, icone: data.icon, compartilhado: Boolean(data.shared), arquivado: false, bloqueado_plano: false });
    if (intent === "create_card") return this.addRow("cartoes", { nome: data.name, limite: Number(data.value), dia_vencimento: Number(data.dueDay), dia_fechamento: Number(data.closingDay), cor: data.color, ativo: true, bloqueado_plano: false });
    if (intent === "create_transaction") return this.executeCreateTransaction(data);
    if (intent === "transfer_between_accounts") return this.executeCreateTransaction(data, true);
    if (intent === "create_card_purchase") {
      const count = data.frequency === "parcelada" ? Number(data.installments) : data.frequency === "mensal" ? 60 : 1;
      const value = Number(data.value);
      const perItem = data.frequency === "parcelada" ? Math.round((value / count) * 100) / 100 : value;
      const card = this.rows("cartoes").find((row) => row.id === data.cardId);
      const closingDay = Number(card?.dia_fechamento ?? 1);
      let firstInvoice = String(data.purchaseDate).slice(0, 7);
      if (Number(String(data.purchaseDate).slice(8, 10)) > closingDay) firstInvoice = dateWithMonthOffset(`${firstInvoice}-01`, 1).slice(0, 7);
      const group = nextId(this.rows("fatura_itens"));
      const ids: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const row = this.addRow("fatura_itens", {
          cartao_id: data.cardId, categoria_id: data.categoryId,
          descricao: count > 1 ? `${data.description} (${index + 1}/${count})` : data.description,
          valor: perItem, data_compra: data.purchaseDate,
          mes_fatura: dateWithMonthOffset(`${firstInvoice}-01`, index).slice(0, 7),
          parcela_atual: index + 1, total_parcelas: count, grupo_parcela_id: count > 1 ? group : null, pago: false,
        });
        ids.push(Number(row.id));
      }
      return { affected_ids: ids, installments: count };
    }
    if (intent === "move_goal") {
      const goal = this.rows("caixinhas").find((row) => row.id === data.goalId);
      if (!goal) return { affected_id: null };
      const change = data.operation === "resgatar" ? -Number(data.value) : Number(data.value);
      goal.saldo_atual = Math.max(0, Number(goal.saldo_atual ?? 0) + change);
      const row = this.addRow("transacoes", {
        conta_id: data.accountId, categoria_id: null, tipo: "despesa", valor: Number(data.value), status: "paga",
        data_vencimento: data.realizationDate, data_realizacao: data.realizationDate,
        descricao: `[Transf.] ${data.description} [Objetivo:${data.goalId}:${data.operation}]`,
      });
      return { affected_id: row.id, goal_id: goal.id, goal_balance: goal.saldo_atual };
    }
    if (intent === "complete_transaction" || intent === "reopen_transaction") {
      const root = this.rows("transacoes").find((item) => item.id === data.transactionId);
      if (!root) return { affected_id: null };
      const transactionId = Number(root.id);
      if (intent === "complete_transaction") {
        const originalValue = Number(root.valor ?? 0);
        const realizedValue = Number(data.realizedValue);
        if (this.isInternalMovement(root) && Math.abs(realizedValue - originalValue) > 0.005) {
          throw new Error("Movimentações internas exigem conclusão pelo valor integral.");
        }
        const remainingValue = Math.round((originalValue - realizedValue) * 100) / 100;
        const paymentId = this.uuid("8");
        let paymentTransactionId = transactionId;
        const usedRootAsPayment = remainingValue <= 0;
        if (remainingValue > 0) {
          const payment = this.addRow("transacoes", {
            tipo: root.tipo,
            conta_id: root.conta_id,
            categoria_id: root.categoria_id,
            data_vencimento: root.data_vencimento,
            valor: realizedValue,
            status: "paga",
            data_realizacao: data.realizationDate,
            descricao: String(root.descricao ?? "Lançamento"),
            transacao_pai_id: transactionId,
          });
          paymentTransactionId = Number(payment.id);
          root.valor = remainingValue;
          root.status = "pendente";
          root.data_realizacao = null;
        } else {
          root.valor = realizedValue;
          root.status = "paga";
          root.data_realizacao = data.realizationDate;
        }
        const receipt = {
          paymentId,
          paymentTransactionId,
          expectedValue: originalValue,
          realizedValue,
          remainingValue,
          realizationDate: String(data.realizationDate),
          usedRootAsPayment,
          reopened: false,
        };
        this.completionReceipts.set(transactionId, [
          ...(this.completionReceipts.get(transactionId) ?? []),
          receipt,
        ]);
        return {
          affected_id: transactionId,
          transaction_id: transactionId,
          payment_id: paymentId,
          payment_transaction_id: paymentTransactionId,
          realized_value: realizedValue,
          paid_total: this.paidTotal(transactionId),
          remaining_value: remainingValue,
          remaining_transaction_id: null,
          status: usedRootAsPayment ? "paga" : "pendente",
          is_fully_paid: usedRootAsPayment,
        };
      }

      const activePayments = this.activePayments(transactionId);
      const receipt = activePayments[activePayments.length - 1];
      let reopenedPaymentId: string | null = null;
      let reopenedPaymentTransactionId: number | null = null;
      if (receipt) {
        reopenedPaymentId = receipt.paymentId;
        reopenedPaymentTransactionId = receipt.paymentTransactionId;
        if (!receipt.usedRootAsPayment) {
          const transactions = this.rows("transacoes");
          const paymentIndex = transactions.findIndex((item) => Number(item.id) === receipt.paymentTransactionId);
          if (paymentIndex >= 0) transactions.splice(paymentIndex, 1);
          const restoredValue = Math.round((Number(root.valor) + receipt.expectedValue - receipt.remainingValue) * 100) / 100;
          if (!Number.isFinite(restoredValue) || restoredValue <= 0 || Math.abs(restoredValue) > 999_999_999_999.99) {
            throw new Error("O saldo editado não permite estornar este pagamento com segurança.");
          }
          root.valor = restoredValue;
        } else {
          root.valor = receipt.expectedValue;
        }
        receipt.reopened = true;
      }
      root.status = "pendente";
      root.data_realizacao = null;
      return {
        affected_id: root.id,
        transaction_id: transactionId,
        payment_id: reopenedPaymentId,
        reopened_payment_transaction_id: reopenedPaymentTransactionId,
        restored_value: Number(root.valor),
        paid_total: this.paidTotal(transactionId),
        remaining_value: Number(root.valor),
        status: "pendente",
        is_fully_paid: false,
      };
    }
    if (intent === "delete_transaction") {
      const rows = this.rows("transacoes");
      const index = rows.findIndex((row) => row.id === data.transactionId);
      const removed = index >= 0 ? rows.splice(index, 1)[0] : null;
      return { affected_id: removed?.id ?? null };
    }
    if (intent.startsWith("update_")) {
      const target = intent === "update_account" ? { table: "contas", id: data.accountId }
        : intent === "update_category" ? { table: "categorias", id: data.categoryId }
          : intent === "update_goal" ? { table: "caixinhas", id: data.goalId }
            : intent === "update_card" ? { table: "cartoes", id: data.cardId }
              : intent === "update_transaction" ? { table: "transacoes", id: data.transactionId }
                : intent === "update_card_purchase" ? { table: "fatura_itens", id: data.purchaseId } : null;
      const row = target ? this.rows(target.table).find((item) => item.id === target.id) : null;
      if (!row) return { affected_id: null };
      const fieldMap: Record<string, string> = {
        name: "nome", description: "descricao", initialBalance: "saldo_inicial", targetAmount: "meta_valor",
        targetDate: "data_prazo", scheduledDate: "data_vencimento", value: intent === "update_card" ? "limite" : "valor",
        dueDay: "dia_vencimento", closingDay: "dia_fechamento", color: "cor", icon: "icone",
        accountId: "conta_id", categoryId: "categoria_id",
      };
      const databaseField = fieldMap[String(data.field)];
      if (!databaseField) return { affected_id: row.id, changed: false };
      row[databaseField] = data.newValue;
      return { affected_id: row.id, field: databaseField, new_value: data.newValue };
    }
    if (intent === "delete_card_purchase") {
      const rows = this.rows("fatura_itens");
      const index = rows.findIndex((row) => row.id === data.purchaseId);
      const removed = index >= 0 ? rows.splice(index, 1)[0] : null;
      return { affected_id: removed?.id ?? null };
    }
    if (intent === "pay_invoice") {
      const items = this.rows("fatura_itens").filter((row) => row.cartao_id === data.cardId && row.mes_fatura === data.invoiceMonth && row.pago !== true);
      const total = items.reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
      const payment = Number(data.paymentAmount);
      const remaining = Math.max(0, total - payment);
      if (data.remainderMode === "full" || data.remainderMode === "carry") items.forEach((row) => { row.pago = true; });
      if (data.remainderMode === "carry" && remaining > 0) {
        const nextMonth = dateWithMonthOffset(`${String(data.invoiceMonth)}-01`, 1).slice(0, 7);
        this.addRow("fatura_itens", {
          cartao_id: data.cardId, categoria_id: null, descricao: "Saldo da fatura anterior",
          valor: remaining, data_compra: DEMO_TODAY, mes_fatura: nextMonth,
          parcela_atual: 1, total_parcelas: 1, grupo_parcela_id: null, pago: false, sintetico: true,
        });
      }
      const transaction = this.addRow("transacoes", {
        conta_id: data.accountId, categoria_id: null, tipo: "despesa", valor: payment,
        descricao: `Pagamento da fatura [PagFatura:${data.cardId}:${data.invoiceMonth}:${data.remainderMode}]`,
        data_vencimento: DEMO_TODAY, data_realizacao: DEMO_TODAY, status: "paga",
      });
      return { affected_id: transaction.id, paid_amount: payment, open_amount: remaining };
    }
    if (intent === "reverse_invoice_payment") {
      const rows = this.rows("transacoes");
      const index = rows.findIndex((row) => row.id === data.transactionId);
      const transaction = index >= 0 ? rows[index] : null;
      const marker = String(transaction?.descricao ?? "").match(/\[PagFatura:(\d+):(\d{4}-\d{2}):/);
      if (transaction && marker) {
        this.rows("fatura_itens").forEach((row) => {
          if (row.cartao_id === Number(marker[1]) && row.mes_fatura === marker[2]) row.pago = false;
        });
        rows.splice(index, 1);
      }
      return { affected_id: transaction?.id ?? null, reversed: Boolean(transaction && marker) };
    }

    const resource = intent.endsWith("_account") ? { table: "contas", id: "accountId", active: "arquivado" }
      : intent.endsWith("_category") ? { table: "categorias", id: "categoryId", active: "ativa" }
        : intent.endsWith("_goal") ? { table: "caixinhas", id: "goalId", active: "arquivado" }
          : intent.endsWith("_card") ? { table: "cartoes", id: "cardId", active: "ativo" } : null;
    if (resource) {
      const rows = this.rows(resource.table);
      const index = rows.findIndex((row) => row.id === data[resource.id]);
      const row = index >= 0 ? rows[index] : null;
      if (!row) return { affected_id: null };
      if (intent.startsWith("archive_")) row[resource.active] = resource.active === "ativa" ? 0 : resource.active === "ativo" ? false : true;
      else if (intent.startsWith("reactivate_")) row[resource.active] = resource.active === "ativa" ? 1 : resource.active === "ativo" ? true : false;
      else if (intent.startsWith("delete_")) {
        const referenced = resource.table === "contas" ? this.rows("transacoes").some((item) => item.conta_id === row.id)
          : resource.table === "categorias" ? this.rows("transacoes").some((item) => item.categoria_id === row.id) || this.rows("fatura_itens").some((item) => item.categoria_id === row.id)
            : resource.table === "caixinhas" ? Number(row.saldo_atual ?? 0) > 0
              : this.rows("fatura_itens").some((item) => item.cartao_id === row.id);
        if (referenced) row[resource.active] = resource.active === "ativa" ? 0 : resource.active === "ativo" ? false : true;
        else rows.splice(index, 1);
      }
      return { affected_id: row.id };
    }
    return { simulated: true, intent };
  }

  private answer(intent: FinanceAiReadIntent | "out_of_scope", message: string): string {
    if (intent === "out_of_scope") return "Posso responder exclusivamente sobre controle financeiro e executar as funções financeiras disponíveis no FinFlow.";
    const transactions = this.rows("transacoes");
    const visibleTransactions = transactions.filter((row) => row.transacao_pai_id === null || row.transacao_pai_id === undefined);
    const operational = transactions.filter((row) => !String(row.descricao ?? "").includes("[Transf.]"));
    const completedMonth = operational.filter((row) => row.status === "paga" && String(row.data_realizacao ?? row.data_vencimento).startsWith(DEMO_MONTH));
    const income = completedMonth.filter((row) => row.tipo === "receita").reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
    const expense = completedMonth.filter((row) => row.tipo === "despesa").reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
    const pendingMonth = operational.filter((row) => row.status !== "paga" && String(row.data_vencimento).startsWith(DEMO_MONTH));
    const pendingIncome = pendingMonth.filter((row) => row.tipo === "receita").reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
    const pendingExpense = pendingMonth.filter((row) => row.tipo === "despesa").reduce((sum, row) => sum + Number(row.valor ?? 0), 0);

    if (intent === "financial_summary") {
      const activeAccounts = this.rows("contas").filter(active);
      const balance = activeAccounts.reduce((sum, account) => {
        const movements = transactions.filter((row) => row.conta_id === account.id && row.status === "paga" && !String(row.descricao ?? "").includes("[Transf.]"));
        return sum + Number(account.saldo_inicial ?? 0) + movements.reduce((value, row) => value + (row.tipo === "receita" ? Number(row.valor) : -Number(row.valor)), 0);
      }, 0);
      return `Saldo atual nas ${activeAccounts.length} contas ativas: ${formatMoney(balance)}. Em agosto, foram realizados ${formatMoney(income)} em receitas e ${formatMoney(expense)} em despesas.`;
    }
    if (intent === "list_transactions") {
      const text = normalize(message);
      if (text.includes("atrasad") || text.includes("vencid")) {
        const overdue = transactions.filter((row) => row.status !== "paga" && String(row.data_vencimento) < DEMO_TODAY);
        return overdue.length ? `Há ${overdue.length} lançamento(s) atrasado(s): ${overdue.slice(0, 5).map((row) => `${row.descricao} (${formatMoney(Number(row.valor))}, ${formatDate(String(row.data_vencimento))})`).join("; ")}.` : "Não há lançamentos atrasados no cenário local.";
      }
      if (text.includes("receita")) return `Em agosto há ${formatMoney(income)} em receitas realizadas e ${formatMoney(pendingIncome)} ainda pendentes.`;
      if (text.includes("despesa") || text.includes("gasto")) return `Em agosto há ${formatMoney(expense)} em despesas realizadas e ${formatMoney(pendingExpense)} ainda pendentes.`;
      return `O cenário possui ${visibleTransactions.length} lançamentos: ${visibleTransactions.filter((row) => row.status === "paga").length} concluídos e ${visibleTransactions.filter((row) => row.status !== "paga").length} pendentes.`;
    }
    if (intent === "card_summary") {
      const open = this.rows("fatura_itens").filter((row) => row.pago !== true && row.mes_fatura === DEMO_MONTH);
      return `A fatura aberta de agosto soma ${formatMoney(open.reduce((sum, row) => sum + Number(row.valor ?? 0), 0))} em ${open.length} compra(s).`;
    }
    if (intent === "goal_progress") {
      const goals = this.rows("caixinhas").filter(active);
      return goals.map((row) => `${row.nome}: ${formatMoney(Number(row.saldo_atual))} de ${formatMoney(Number(row.meta_valor))}`).join("; ") + ".";
    }
    if (intent === "category_analysis" || intent === "budget_analysis") {
      const categories = this.rows("categorias");
      const totals = new Map<number, number>();
      completedMonth.filter((row) => row.tipo === "despesa").forEach((row) => totals.set(Number(row.categoria_id), (totals.get(Number(row.categoria_id)) ?? 0) + Number(row.valor)));
      const ranked = [...totals].sort((left, right) => right[1] - left[1]).map(([id, value]) => `${categories.find((row) => row.id === id)?.nome ?? "Sem categoria"}: ${formatMoney(value)}`);
      return ranked.length ? `Despesas realizadas por categoria em agosto: ${ranked.join("; ")}.` : "Ainda não há despesas realizadas por categoria em agosto.";
    }
    if (intent === "financial_projection") {
      const text = normalize(message);
      if (/\bfim do ano\b|\bfinal do ano\b|\bterei\b.*\bano\b|\bteremos\b.*\bano\b/.test(text)) {
        const activeAccounts = this.rows("contas").filter(active);
        const currentBalance = activeAccounts.reduce((sum, account) => {
          const movements = transactions.filter((row) => row.conta_id === account.id && row.status === "paga" && !String(row.descricao ?? "").includes("[Transf.]"));
          return sum + Number(account.saldo_inicial ?? 0) + movements.reduce((value, row) => value + (row.tipo === "receita" ? Number(row.valor) : -Number(row.valor)), 0);
        }, 0);
        const pendingUntilYearEnd = operational.filter((row) => row.status !== "paga" && String(row.data_vencimento) >= DEMO_TODAY && String(row.data_vencimento) <= "2026-12-31");
        const projectedChange = pendingUntilYearEnd.reduce((sum, row) => sum + (row.tipo === "receita" ? Number(row.valor ?? 0) : -Number(row.valor ?? 0)), 0);
        return `Considerando os lançamentos pendentes cadastrados até o fim de 2026, o saldo projetado é ${formatMoney(currentBalance + projectedChange)}.`;
      }
      return `Mantendo os agendamentos de agosto, o resultado realizado de ${formatMoney(income - expense)} passará para ${formatMoney(income + pendingIncome - expense - pendingExpense)} até o fim do mês.`;
    }
    if (intent === "cash_flow") return `Fluxo de agosto: entradas realizadas ${formatMoney(income)}, saídas realizadas ${formatMoney(expense)}, entradas pendentes ${formatMoney(pendingIncome)} e saídas pendentes ${formatMoney(pendingExpense)}.`;
    return "O FinFlow separa a data agendada da data de realização, usa apenas receitas e despesas no balanço e mantém transferências como movimentações neutras.";
  }

  async invoke(body: unknown): Promise<Record<string, unknown>> {
    const request = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const mode = request.mode;
    if (mode === "history") {
      const requested = typeof request.conversationId === "string" ? request.conversationId : this.activeConversationId;
      const conversationId = requested && this.conversations.has(requested) ? requested : null;
      return { conversationId, messages: conversationId ? [...(this.conversations.get(conversationId) ?? [])] : [], quota: this.quota() };
    }
    if (mode === "clear") {
      const target = typeof request.conversationId === "string" ? request.conversationId : this.activeConversationId;
      if (target) { this.conversations.delete(target); this.drafts.delete(target); }
      if (!target || target === this.activeConversationId) this.activeConversationId = null;
      return { cleared: true, conversationId: null, messages: [], quota: this.quota() };
    }
    if (mode === "cancel") {
      const proposal = typeof request.actionId === "string" ? this.proposals.get(request.actionId) : undefined;
      if (!proposal) return { error: "AI_ACTION_NOT_FOUND", message: "A proposta local não foi encontrada." };
      const replayed = proposal.status === "cancelled";
      proposal.status = "cancelled";
      return { kind: "cancelled", message: "Ação cancelada. Nenhuma informação local foi alterada.", action: { ok: true, action_id: proposal.id, action_type: proposal.intent, status: "cancelled", cancelled_at: new Date().toISOString(), replayed }, quota: this.quota() };
    }
    if (mode === "confirm") {
      const proposal = typeof request.actionId === "string" ? this.proposals.get(request.actionId) : undefined;
      if (!proposal || request.confirmationToken !== proposal.confirmationToken) return { error: "AI_ACTION_NOT_FOUND", message: "A proposta local não foi encontrada." };
      if (proposal.status === "cancelled") return { error: "AI_ACTION_CANCELLED", message: "A proposta já foi cancelada." };
      const replayed = proposal.status === "executed";
      if (!replayed) { proposal.result = this.execute(proposal); proposal.status = "executed"; this.actionsUsed += 1; }
      const message = replayed ? "Essa ação local já havia sido confirmada; nada foi duplicado." : `${titleFor(proposal.intent)} concluído somente na memória local. Dados aplicados: ${proposal.summary.replace(/\n/g, "; ")}.`;
      this.addMessage(proposal.conversationId, "assistant", message, proposal.intent);
      return { kind: "executed", message, result: { ok: true, action_id: proposal.id, action_type: proposal.intent, status: "succeeded", result: proposal.result ?? {}, replayed }, quota: this.quota() };
    }
    if (mode !== "message" || typeof request.message !== "string" || !request.message.trim()) return { error: "INVALID_REQUEST", message: "Envie uma mensagem financeira válida." };

    this.modelUsed += 1;
    const conversationId = this.ensureConversation(request.conversationId);
    const message = request.message.trim();
    const normalized = normalize(message);
    const existingDraft = this.drafts.get(conversationId);
    const detected = explicitMutationIntent(message) ?? this.inferredMutationIntent(message);
    const intent = detected ?? existingDraft?.intent ?? readIntent(message);
    this.addMessage(conversationId, "user", message, intent);

    if (existingDraft && /^\b(cancelar|cancela|desistir|pare)\b/.test(normalized) && !detected) {
      this.drafts.delete(conversationId);
      const response = "Certo, cancelei a coleta. Nenhum dado foi alterado.";
      this.addMessage(conversationId, "assistant", response, "explain_financial_control");
      return { kind: "answer", conversationId, message: response, intent: "explain_financial_control", quota: this.quota() };
    }

    if (existingDraft && !detected) {
      const accepted = this.applyField(existingDraft.intent, existingDraft.missingField, message, existingDraft.data);
      const missing = accepted ? this.firstMissing(existingDraft.intent, existingDraft.data) : existingDraft.missingField;
      if (missing) {
        existingDraft.missingField = missing;
        const question = `${accepted ? "Ótimo. " : "Não consegui identificar essa informação. "}${this.questionFor(missing, existingDraft.data)}`;
        this.addMessage(conversationId, "assistant", question, existingDraft.intent);
        return { kind: "clarify", conversationId, message: question, intent: existingDraft.intent, missingFields: [missing], quota: this.quota() };
      }
      this.drafts.delete(conversationId);
      return this.createProposal(conversationId, existingDraft.intent, existingDraft.data);
    }

    const navigation = navigationIntent(message);
    if (navigation && !detected) {
      const response = "Abrindo a área solicitada no modo local.";
      this.addMessage(conversationId, "assistant", response, navigation.intent);
      return { kind: "navigate", conversationId, message: response, intent: navigation.intent, route: navigation.route, quota: this.quota() };
    }

    if (detected && MUTATIONS.has(detected)) {
      const data = this.parseInitial(detected, message);
      const missing = this.firstMissing(detected, data);
      if (missing) {
        this.drafts.set(conversationId, { intent: detected, data, missingField: missing });
        const question = this.questionFor(missing, data);
        this.addMessage(conversationId, "assistant", question, detected);
        return { kind: "clarify", conversationId, message: question, intent: detected, missingFields: [missing], quota: this.quota() };
      }
      return this.createProposal(conversationId, detected, data);
    }

    const read = readIntent(message);
    const response = this.answer(read, message);
    this.addMessage(conversationId, "assistant", response, read);
    return { kind: "answer", conversationId, message: response, intent: read, quota: this.quota() };
  }

  reset(): void {
    this.sequence = 1;
    this.messageSequence = 1;
    this.modelUsed = 0;
    this.actionsUsed = 0;
    this.activeConversationId = null;
    this.conversations.clear();
    this.proposals.clear();
    this.drafts.clear();
    this.completionReceipts.clear();
  }
}

export function createLocalDemoOperationalFinanceAi(context: FinanceAiContext): LocalDemoOperationalFinanceAi {
  return new LocalDemoOperationalFinanceAi(context);
}
