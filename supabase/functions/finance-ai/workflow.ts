import {
  DATA_KEYS,
  isDirectAction,
  type DirectAction,
  type DataKey,
  type ModelField,
  type ModelOutput,
} from "./contracts.ts";

type CreateIntent = "create_account" | "create_category" | "create_goal" | "create_card";

const REQUIRED_FIELDS: Record<CreateIntent, readonly DataKey[]> = {
  create_account: ["name", "initial_balance", "color"],
  create_category: ["type", "name", "color", "icon"],
  create_goal: ["name", "target_amount", "initial_balance", "target_date", "color", "icon"],
  create_card: ["name", "value", "due_day", "closing_day", "color"],
};

const QUESTIONS: Record<DataKey, string> = {
  account_id: "Qual conta?", destination_account_id: "Qual conta de destino?", category_id: "Qual categoria?",
  goal_id: "Qual objetivo?", card_id: "Qual cartão?", transaction_id: "Qual lançamento?", purchase_id: "Qual compra?",
  invoice_month: "Qual mês da fatura?", name: "Qual nome?", description: "Qual descrição?", type: "É receita ou despesa?",
  status: "Qual status?", value: "Qual valor?", expected_value: "Qual valor previsto?",
  realized_value: "Quanto foi efetivamente pago ou recebido?", initial_balance: "Qual é o saldo inicial?",
  target_amount: "Qual é o valor da meta?", target_date: "Qual é a data da meta? Responda DD/MM/AAAA ou sem prazo.",
  scheduled_date: "Qual é a data agendada?", realization_date: "Qual é a data de realização?", purchase_date: "Qual é a data da compra?",
  color: "Qual cor deseja usar?", icon: "Qual ícone deseja usar?", frequency: "Qual frequência?", recurrence_count: "Quantas recorrências?",
  installments: "Quantas parcelas?", installment_value: "Qual o valor da parcela?", series_scope: "Aplicar a qual parte da série?",
  operation: "Qual operação?", due_day: "Qual é o dia do vencimento?", closing_day: "Qual é o dia do fechamento?",
  payment_amount: "Qual valor será pago?", remainder_mode: "O que fazer com o restante?", interest_value: "Qual valor dos juros?",
  interest_percent: "Qual percentual de juros?", field: "Qual campo deseja alterar?", new_value: "Qual é o novo valor?",
  query: "O que deseja consultar?", date_from: "Qual é a data inicial?", date_to: "Qual é a data final?",
  account_ids: "Quais contas?", category_ids: "Quais categorias?", transaction_type: "Qual tipo de lançamento?",
  overdue_only: "Mostrar somente atrasados?", next_days: "Quantos dias à frente?", page: "Qual página?", page_size: "Quantos itens?",
  year: "Qual ano?", selected_month: "Qual mês?", basis: "Qual base de cálculo?", include_budget_rule: "Incluir regra de orçamento?",
  view: "Qual visualização?",
};

const dataKeys = new Set<string>(DATA_KEYS);

type FinancialContext = {
  current_date?: unknown;
  accounts?: unknown;
  categories?: unknown;
  goals?: unknown;
  cards?: unknown;
  relevant_transactions?: unknown;
  relevant_invoice_items?: unknown;
  invoice_summaries?: unknown;
};

type ContextRow = Record<string, unknown>;

const ACTION_REQUIRED_FIELDS: Partial<Record<DirectAction, readonly DataKey[]>> = {
  update_account: ["account_id", "field", "new_value"],
  archive_account: ["account_id"],
  delete_account: ["account_id"],
  reactivate_account: ["account_id"],
  update_category: ["category_id", "field", "new_value"],
  archive_category: ["category_id"],
  delete_category: ["category_id"],
  reactivate_category: ["category_id"],
  update_goal: ["goal_id", "field", "new_value"],
  archive_goal: ["goal_id"],
  delete_goal: ["goal_id"],
  reactivate_goal: ["goal_id"],
  move_goal: ["operation", "goal_id", "value", "account_id"],
  update_transaction: ["transaction_id", "series_scope", "field", "new_value"],
  delete_transaction: ["transaction_id", "series_scope"],
  complete_transaction: ["transaction_id", "realization_date", "expected_value", "realized_value"],
  reopen_transaction: ["transaction_id"],
  update_card: ["card_id", "field", "new_value"],
  archive_card: ["card_id"],
  delete_card: ["card_id"],
  reactivate_card: ["card_id"],
  update_card_purchase: ["purchase_id", "series_scope", "field", "new_value"],
  delete_card_purchase: ["purchase_id", "series_scope"],
  pay_invoice: ["card_id", "invoice_month", "account_id", "payment_amount", "remainder_mode"],
  reverse_invoice_payment: ["transaction_id"],
};

const ACTION_ALLOWED_FIELDS: Partial<Record<DirectAction, readonly DataKey[]>> = {
  update_account: ["account_id", "field", "new_value"],
  archive_account: ["account_id"], delete_account: ["account_id"], reactivate_account: ["account_id"],
  update_category: ["category_id", "field", "new_value"],
  archive_category: ["category_id"], delete_category: ["category_id"], reactivate_category: ["category_id"],
  update_goal: ["goal_id", "field", "new_value"],
  archive_goal: ["goal_id"], delete_goal: ["goal_id"], reactivate_goal: ["goal_id"],
  move_goal: ["operation", "goal_id", "value", "account_id", "description", "frequency", "scheduled_date", "realization_date"],
  update_transaction: ["transaction_id", "series_scope", "field", "new_value"],
  delete_transaction: ["transaction_id", "series_scope"],
  complete_transaction: ["transaction_id", "realization_date", "expected_value", "realized_value", "interest_value", "interest_percent"],
  reopen_transaction: ["transaction_id"],
  update_card: ["card_id", "field", "new_value"],
  archive_card: ["card_id"], delete_card: ["card_id"], reactivate_card: ["card_id"],
  update_card_purchase: ["purchase_id", "series_scope", "field", "new_value"],
  delete_card_purchase: ["purchase_id", "series_scope"],
  pay_invoice: ["card_id", "invoice_month", "account_id", "payment_amount", "remainder_mode", "interest_value", "interest_percent"],
  reverse_invoice_payment: ["transaction_id"],
};

const ID_CONTEXT: Partial<Record<DataKey, keyof FinancialContext>> = {
  account_id: "accounts",
  destination_account_id: "accounts",
  category_id: "categories",
  goal_id: "goals",
  card_id: "cards",
  transaction_id: "relevant_transactions",
  purchase_id: "relevant_invoice_items",
};

const ID_QUESTIONS: Partial<Record<DataKey, string>> = {
  account_id: "Qual conta você deseja usar?",
  destination_account_id: "Qual é a conta de destino?",
  category_id: "Qual categoria você deseja usar?",
  goal_id: "Qual objetivo você deseja usar?",
  card_id: "Qual cartão você deseja usar?",
  transaction_id: "Qual lançamento você deseja alterar? Informe a descrição e a data.",
  purchase_id: "Qual compra do cartão você deseja alterar? Informe a descrição e a fatura.",
};

function isCreateIntent(value: string): value is CreateIntent {
  return Object.prototype.hasOwnProperty.call(REQUIRED_FIELDS, value);
}

function cleaned(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function withoutAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "_");
}

function noDeadline(value: string): boolean {
  return ["none", "sem_prazo", "sem_data", "nao_tem", "nao"].includes(withoutAccents(value));
}

function stateFields(state: Record<string, string>, intent: CreateIntent): ModelField[] {
  if (state.__intent && state.__intent !== intent) return [];
  return Object.entries(state)
    .filter(([key, value]) => dataKeys.has(key) && cleaned(value).length > 0)
    .map(([key, value]) => ({ key: key as DataKey, value: cleaned(value) }));
}

function mergeFields(state: Record<string, string>, output: ModelOutput, intent: CreateIntent): ModelField[] {
  const merged = new Map<DataKey, string>();
  for (const field of stateFields(state, intent)) merged.set(field.key, field.value);
  for (const field of output.data) {
    const value = cleaned(field.value);
    if (value) merged.set(field.key, value);
  }
  return [...merged].map(([key, value]) => ({ key, value }));
}

function mergeActionFields(state: Record<string, string>, output: ModelOutput): ModelField[] {
  const merged = new Map<DataKey, string>();
  if (!state.__intent || state.__intent === output.intent) {
    for (const [key, value] of Object.entries(state)) {
      if (dataKeys.has(key) && cleaned(value)) merged.set(key as DataKey, cleaned(value));
    }
  }
  for (const field of output.data) {
    const value = cleaned(field.value);
    if (value) merged.set(field.key, value);
  }
  return [...merged].map(([key, value]) => ({ key, value }));
}

function contextObject(compactJson: string): FinancialContext {
  try {
    const parsed = JSON.parse(compactJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as FinancialContext
      : {};
  } catch {
    throw new Error("AI_CONTEXT_INVALID");
  }
}

function contextRows(context: FinancialContext, key: keyof FinancialContext): ContextRow[] {
  const value = context[key];
  return Array.isArray(value)
    ? value.filter((row): row is ContextRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function referenceExists(context: FinancialContext, key: DataKey, value: string): boolean {
  const contextKey = ID_CONTEXT[key];
  if (!contextKey) return true;
  const id = positiveInteger(value);
  return id !== null && contextRows(context, contextKey).some((row) => Number(row.id) === id);
}

function requiredActionFields(intent: DirectAction, values: Map<DataKey, string>): readonly DataKey[] {
  if (intent === "move_goal") {
    const fields: DataKey[] = ["operation", "goal_id", "value", "account_id"];
    if (values.get("frequency") && values.get("frequency") !== "unica") fields.push("scheduled_date");
    return fields;
  }
  if (intent === "create_transaction") {
    const fields: DataKey[] = ["type", "frequency", "scheduled_date", "description", "value", "account_id", "category_id"];
    if (values.get("frequency") === "unica") fields.splice(2, 0, "status");
    if (values.get("frequency") === "parcelada") fields.push("installments");
    return fields;
  }
  if (intent === "transfer_between_accounts") {
    const fields: DataKey[] = ["frequency", "scheduled_date", "description", "value", "account_id", "destination_account_id"];
    if (values.get("frequency") === "unica") fields.splice(1, 0, "status");
    if (values.get("frequency") === "parcelada") fields.push("installments");
    return fields;
  }
  if (intent === "create_card_purchase") {
    const fields: DataKey[] = ["card_id", "category_id", "description", "value", "purchase_date", "frequency"];
    if (values.get("frequency") === "parcelada") fields.push("installments");
    return fields;
  }
  return ACTION_REQUIRED_FIELDS[intent] ?? [];
}

function allowedActionFields(intent: DirectAction): ReadonlySet<DataKey> {
  if (intent === "create_transaction") {
    return new Set(["type", "status", "value", "installment_value", "description", "scheduled_date", "realization_date", "account_id", "category_id", "frequency", "installments"]);
  }
  if (intent === "transfer_between_accounts") {
    return new Set(["status", "value", "installment_value", "description", "scheduled_date", "realization_date", "account_id", "destination_account_id", "frequency", "installments"]);
  }
  if (intent === "create_card_purchase") {
    return new Set(["card_id", "category_id", "description", "value", "installment_value", "purchase_date", "frequency", "installments"]);
  }
  return new Set(ACTION_ALLOWED_FIELDS[intent] ?? []);
}

function setField(fields: ModelField[], key: DataKey, value: string): void {
  const current = fields.find((field) => field.key === key);
  if (current) current.value = value;
  else fields.push({ key, value });
}

function removeField(fields: ModelField[], key: DataKey): void {
  const index = fields.findIndex((field) => field.key === key);
  if (index >= 0) fields.splice(index, 1);
}

function applyDeterministicDefaults(
  intent: DirectAction,
  fields: ModelField[],
  context: FinancialContext,
): void {
  const values = new Map(fields.map((field) => [field.key, field.value]));
  const frequency = values.get("frequency");
  if ((intent === "create_transaction" || intent === "transfer_between_accounts") && frequency && frequency !== "unica") {
    setField(fields, "status", "pendente");
    removeField(fields, "realization_date");
    removeField(fields, "recurrence_count");
  }
  if ((intent === "create_transaction" || intent === "transfer_between_accounts")
      && frequency === "unica" && values.get("status") === "paga" && values.get("scheduled_date")) {
    setField(fields, "realization_date", values.get("scheduled_date")!);
  }
  if (intent === "move_goal" && !frequency) {
    const operation = values.get("operation");
    const currentDate = typeof context.current_date === "string" ? context.current_date : "";
    setField(fields, "frequency", "unica");
    if (currentDate) setField(fields, "realization_date", currentDate);
    if (!values.get("description") && operation) {
      setField(fields, "description", operation === "resgatar" ? "Resgate do objetivo" : "Aporte no objetivo");
    }
  }
  if (intent === "move_goal" && frequency && frequency !== "unica") {
    removeField(fields, "realization_date");
    removeField(fields, "recurrence_count");
    if (!values.get("description") && values.get("operation")) {
      setField(fields, "description", values.get("operation") === "resgatar" ? "Resgate do objetivo" : "Aporte no objetivo");
    }
  }
  if ((intent === "update_transaction" || intent === "delete_transaction") && !values.get("series_scope")) {
    const id = positiveInteger(values.get("transaction_id") ?? "");
    const row = id === null
      ? undefined
      : contextRows(context, "relevant_transactions").find((item) => Number(item.id) === id);
    const isSeries = Boolean(row?.series_id)
      || /\(\d+\s*\/\s*\d+\)/.test(String(row?.description ?? ""));
    if (row && (!isSeries || String(row.status) === "paga")) setField(fields, "series_scope", "one");
  }
  if ((intent === "update_card_purchase" || intent === "delete_card_purchase") && !values.get("series_scope")) {
    const id = positiveInteger(values.get("purchase_id") ?? "");
    const row = id === null
      ? undefined
      : contextRows(context, "relevant_invoice_items").find((item) => Number(item.id) === id);
    const isSeries = row ? !/^1\s*\/\s*1$/.test(String(row.installment ?? "1/1")) : false;
    if (row && !isSeries) setField(fields, "series_scope", "one");
  }
  if (intent === "complete_transaction") {
    const id = positiveInteger(values.get("transaction_id") ?? "");
    const row = id === null
      ? undefined
      : contextRows(context, "relevant_transactions").find((item) => Number(item.id) === id);
    const expected = Number(row?.value);
    if (Number.isFinite(expected) && expected > 0) setField(fields, "expected_value", String(expected));
  }
}

function invalidReference(fields: ModelField[], context: FinancialContext): DataKey | null {
  for (const field of fields) {
    if (ID_CONTEXT[field.key] && !referenceExists(context, field.key, field.value)) return field.key;
  }
  return null;
}

function invalidSemanticChoice(
  intent: DirectAction,
  fields: ModelField[],
  context: FinancialContext,
): { key: DataKey; message: string } | null {
  const values = new Map(fields.map((field) => [field.key, field.value]));
  if (intent === "transfer_between_accounts"
      && values.get("account_id") && values.get("account_id") === values.get("destination_account_id")) {
    return { key: "destination_account_id", message: "A conta de destino precisa ser diferente da conta de origem. Qual conta receberá a transferência?" };
  }
  if (intent === "create_transaction" && values.get("category_id") && values.get("type")) {
    const categoryId = positiveInteger(values.get("category_id")!);
    const category = contextRows(context, "categories").find((row) => Number(row.id) === categoryId);
    if (category && String(category.type) !== values.get("type")) {
      return { key: "category_id", message: "Qual categoria compatível com esse tipo de lançamento você deseja usar?" };
    }
  }
  if (intent === "create_card_purchase" && values.get("category_id")) {
    const categoryId = positiveInteger(values.get("category_id")!);
    const category = contextRows(context, "categories").find((row) => Number(row.id) === categoryId);
    if (category && String(category.type) !== "despesa") {
      return { key: "category_id", message: "Compras no cartão usam categoria de despesa. Qual categoria deseja usar?" };
    }
  }
  if (intent === "move_goal" && values.get("operation") === "resgatar") {
    const goalId = positiveInteger(values.get("goal_id") ?? "");
    const goal = contextRows(context, "goals").find((row) => Number(row.id) === goalId);
    const requested = Number(values.get("value"));
    const balance = Number(goal?.balance);
    if (goal && Number.isFinite(requested) && Number.isFinite(balance) && requested > balance) {
      return { key: "value", message: `O valor supera o saldo disponível de R$ ${balance.toFixed(2).replace(".", ",")}. Qual valor deseja resgatar?` };
    }
  }
  if (intent === "complete_transaction" && values.get("realized_value")) {
    const expected = Number(values.get("expected_value"));
    const realized = Number(values.get("realized_value"));
    const interestValue = values.has("interest_value") ? Number(values.get("interest_value")) : 0;
    const interestPercent = values.has("interest_percent") ? Number(values.get("interest_percent")) : 0;
    const totalDue = Number.isFinite(expected)
      ? expected + (Number.isFinite(interestValue) ? interestValue : 0)
        + (Number.isFinite(interestPercent) ? expected * interestPercent / 100 : 0)
      : Number.NaN;
    if (!Number.isFinite(realized) || realized <= 0 || !Number.isFinite(totalDue) || realized - totalDue > 0.005) {
      return { key: "realized_value", message: "Qual valor positivo foi efetivamente pago ou recebido, sem superar o total devido?" };
    }
    const transactionId = positiveInteger(values.get("transaction_id") ?? "");
    const transaction = transactionId === null
      ? undefined
      : contextRows(context, "relevant_transactions").find((row) => Number(row.id) === transactionId);
    const internal = transaction && (
      transaction.category_id == null
      || transaction.internal_transfer === true
      || transaction.goal_id != null
    );
    if (internal && (Math.abs(realized - expected) > 0.005 || values.has("interest_value") || values.has("interest_percent"))) {
      return { key: "realized_value", message: `Movimentações internas precisam ser concluídas pelo valor integral de R$ ${expected.toFixed(2).replace(".", ",")}, sem juros ou desconto.` };
    }
  }
  if (intent === "pay_invoice" && values.get("card_id") && values.get("invoice_month") && values.get("payment_amount")) {
    const cardId = positiveInteger(values.get("card_id")!);
    const invoice = contextRows(context, "invoice_summaries").find((row) => (
      Number(row.card_id) === cardId && String(row.invoice_month) === values.get("invoice_month")
    ));
    const open = Number(invoice?.open);
    const payment = Number(values.get("payment_amount"));
    if (invoice && Number.isFinite(open) && Number.isFinite(payment) && payment > open) {
      return { key: "payment_amount", message: `O pagamento não pode superar o saldo aberto de R$ ${open.toFixed(2).replace(".", ",")}. Qual valor foi pago?` };
    }
    if (invoice && Number.isFinite(open) && Math.abs(payment - open) < 0.005) {
      setField(fields, "remainder_mode", "full");
    }
  }
  return null;
}

/**
 * Fronteira determinística pós-modelo. O modelo pode interpretar linguagem,
 * mas não pode escolher identificadores que não vieram do contexto nem pular
 * etapas mínimas do formulário. A Edge continua sendo a única responsável por
 * criar uma proposta; a execução permanece exclusivamente no RPC confirmado.
 */
export function enforceActionWorkflow(
  rawOutput: ModelOutput,
  conversationState: Record<string, string>,
  compactFinancialContext: string,
): ModelOutput {
  const pinnedIntent = conversationState.__intent;
  const candidate = pinnedIntent && isDirectAction(pinnedIntent) && rawOutput.intent !== pinnedIntent
    ? {
      kind: "clarify" as const,
      intent: pinnedIntent,
      message: "Vamos concluir ou cancelar a ação financeira atual antes de iniciar outra.",
      missing_fields: ["name"],
      data: [] as ModelField[],
    }
    : rawOutput;
  const output = enforceCreateWorkflow(candidate, conversationState);
  if (!isDirectAction(output.intent) || (output.kind !== "clarify" && output.kind !== "propose_action")) {
    return output;
  }
  // As quatro criações estruturais já foram integralmente normalizadas pelo
  // fluxo específico acima (inclusive a sentinela "sem prazo").
  if (isCreateIntent(output.intent)) return output;

  const context = contextObject(compactFinancialContext);
  const allowed = allowedActionFields(output.intent);
  const fields = mergeActionFields(conversationState, output)
    .filter((field) => allowed.has(field.key));
  applyDeterministicDefaults(output.intent, fields, context);

  const badReference = invalidReference(fields, context);
  if (badReference) {
    removeField(fields, badReference);
    return {
      kind: "clarify",
      intent: output.intent,
      message: ID_QUESTIONS[badReference] ?? QUESTIONS[badReference],
      missing_fields: [badReference],
      data: fields,
    };
  }

  const semanticProblem = invalidSemanticChoice(output.intent, fields, context);
  if (semanticProblem) {
    removeField(fields, semanticProblem.key);
    return {
      kind: "clarify",
      intent: output.intent,
      message: semanticProblem.message,
      missing_fields: [semanticProblem.key],
      data: fields,
    };
  }

  const values = new Map(fields.map((field) => [field.key, field.value]));
  const firstMissing = requiredActionFields(output.intent, values)
    .find((key) => cleaned(values.get(key)).length === 0);
  if (firstMissing) {
    return {
      kind: "clarify",
      intent: output.intent,
      message: QUESTIONS[firstMissing],
      missing_fields: [firstMissing],
      data: fields,
    };
  }

  return {
    ...output,
    kind: "propose_action",
    message: output.kind === "clarify" ? "Revise os dados antes de confirmar." : output.message,
    missing_fields: [],
    data: fields,
  };
}

/**
 * Garante no servidor que criações estruturais nunca chegam à RPC com defaults
 * silenciosos. O estado anterior só é reaproveitado quando pertence à mesma
 * intenção, e a Edge pergunta exatamente um campo obrigatório por vez.
 */
export function enforceCreateWorkflow(output: ModelOutput, conversationState: Record<string, string>): ModelOutput {
  if (!isCreateIntent(output.intent) || (output.kind !== "clarify" && output.kind !== "propose_action")) return output;

  const allowed = new Set(REQUIRED_FIELDS[output.intent]);
  const merged = mergeFields(conversationState, output, output.intent)
    .filter((field) => allowed.has(field.key));
  const values = new Map(merged.map((field) => [field.key, field.value]));
  const firstMissing = REQUIRED_FIELDS[output.intent].find((key) => cleaned(values.get(key)).length === 0);

  if (firstMissing) {
    return {
      kind: "clarify",
      intent: output.intent,
      message: QUESTIONS[firstMissing],
      missing_fields: [firstMissing],
      data: merged,
    };
  }

  return {
    ...output,
    kind: "propose_action",
    message: output.kind === "clarify" ? "Revise os dados antes de confirmar." : output.message,
    missing_fields: [],
    data: output.intent === "create_goal"
      ? merged.filter((field) => field.key !== "target_date" || !noDeadline(field.value))
      : merged,
  };
}
