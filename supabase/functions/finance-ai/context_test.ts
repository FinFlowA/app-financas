import {
  aggregateScopeArgument,
  calculateFinancialSnapshot,
  financialSnapshotFromAggregate,
  redactSensitiveText,
  serializeContextWithinBudget,
  type FinancialRow,
} from "./context.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertMoney(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.005, `${message}: esperado ${expected}, recebido ${actual}`);
}

const accounts: FinancialRow[] = [
  { id: 1, nome: "Principal", saldo_inicial: 1_000, arquivado: false, compartilhado: false },
  { id: 2, nome: "Conjunta", saldo_inicial: 500, arquivado: false, compartilhado: true },
  { id: 3, nome: "Arquivada", saldo_inicial: 200, arquivado: true, compartilhado: false },
];

const categories: FinancialRow[] = [
  { id: 10, nome: "Outros", tipo: "despesa", ativa: true },
  { id: 11, nome: "Outros", tipo: "despesa", ativa: true },
  { id: 20, nome: "Salário", tipo: "receita", ativa: true },
];

const goals: FinancialRow[] = [
  {
    id: 7,
    nome: "Reserva",
    saldo_atual: 100,
    meta_valor: 500,
    data_prazo: "2026-12-31",
    arquivado: false,
  },
];

const cards: FinancialRow[] = [
  { id: 5, nome: "FinFlow Card", limite: 1_000, ativo: true },
];

const transactions: FinancialRow[] = [
  {
    id: 1, tipo: "despesa", valor: 100, conta_id: 1, status: "paga",
    data_vencimento: "2026-08-01", data_realizacao: "2026-08-01",
    descricao: "[Transf.] Entre contas [Destino:2]",
  },
  {
    id: 2, tipo: "despesa", valor: 50, conta_id: 1, status: "paga",
    data_vencimento: "2026-07-30", data_realizacao: "2026-07-30",
    descricao: "[Transf.] Ajuste antigo",
  },
  {
    id: 3, tipo: "receita", valor: 50, conta_id: 3, status: "paga",
    data_vencimento: "2026-07-30", data_realizacao: "2026-07-30",
    descricao: "[Transf.] Ajuste antigo",
  },
  {
    id: 4, tipo: "despesa", valor: 30, conta_id: 1, status: "pendente",
    data_vencimento: "2026-08-20", data_realizacao: null,
    descricao: "[Transf.] Guardar em: Reserva [Objetivo:7:guardar]",
  },
  {
    id: 5, tipo: "receita", valor: 10, conta_id: 1, status: "paga",
    data_vencimento: "2026-07-01", data_realizacao: "2026-08-02",
    descricao: "[Transf.] Resgate de: Reserva [Objetivo:7:resgatar]",
  },
  {
    id: 6, tipo: "despesa", valor: 200, conta_id: 1, status: "paga",
    data_vencimento: "2026-06-05", data_realizacao: "2026-06-05",
    descricao: "Fatura FinFlow [PagFatura:5:2026-06:total]",
  },
  {
    id: 7, tipo: "despesa", valor: 40, conta_id: 1, status: "paga",
    data_vencimento: "2026-07-05", data_realizacao: "2026-07-05",
    descricao: "Fatura FinFlow [PagFatura:5:2026-07:parcial:102]",
  },
  {
    id: 8, tipo: "despesa", valor: 40, conta_id: 1, status: "paga",
    data_vencimento: "2026-08-02", data_realizacao: "2026-08-02",
    descricao: "Fatura FinFlow [PagFatura:5:2026-08:saldo_transferido:104]",
  },
  {
    id: 9, tipo: "despesa", valor: 40, conta_id: 1, categoria_id: 10, status: "paga",
    data_vencimento: "2026-07-01", data_realizacao: "2026-08-01", descricao: "Mercado",
  },
  {
    id: 10, tipo: "despesa", valor: 20, conta_id: 1, categoria_id: 10, status: "pendente",
    data_vencimento: "2026-08-30", data_realizacao: null, descricao: "Farmácia",
  },
  {
    id: 11, tipo: "despesa", valor: 15, conta_id: 2, categoria_id: 11, status: "paga",
    data_vencimento: "2026-08-01", data_realizacao: "2026-08-01", descricao: "Tarifa",
  },
  {
    id: 12, tipo: "receita", valor: 100, conta_id: 2, categoria_id: 20, status: "paga",
    data_vencimento: "2026-08-01", data_realizacao: "2026-08-01", descricao: "Salário",
  },
  {
    id: 13, tipo: "despesa", valor: 25, conta_id: 1, status: "pendente",
    data_vencimento: "2026-09-10", data_realizacao: null,
    descricao: "[Transf.] Guardar em: Reserva",
  },
  {
    id: 14, tipo: "receita", valor: 5, conta_id: 1, status: "pendente",
    data_vencimento: "2026-09-20", data_realizacao: null,
    descricao: "[Transf.] Resgate de: Reserva [Objetivo:7:resgatar]",
  },
];

const invoiceItems: FinancialRow[] = [
  { id: 100, cartao_id: 5, categoria_id: 10, descricao: "Compra junho", valor: 200, data_compra: "2026-06-01", mes_fatura: "2026-06", pago: true, parcela_atual: 1, total_parcelas: 1 },
  { id: 101, cartao_id: 5, categoria_id: 10, descricao: "Compra julho", valor: 100, data_compra: "2026-07-01", mes_fatura: "2026-07", pago: false, parcela_atual: 1, total_parcelas: 1 },
  { id: 102, cartao_id: 5, categoria_id: null, descricao: "Pagamento parcial da fatura", valor: -40, data_compra: "2026-07-05", mes_fatura: "2026-07", pago: false, parcela_atual: 1, total_parcelas: 1 },
  { id: 103, cartao_id: 5, categoria_id: 11, descricao: "Compra agosto", valor: 80, data_compra: "2026-08-01", mes_fatura: "2026-08", pago: true, parcela_atual: 1, total_parcelas: 1 },
  { id: 104, cartao_id: 5, categoria_id: null, descricao: "Saldo da fatura anterior (Agosto)", valor: 45, data_compra: "2026-08-02", mes_fatura: "2026-09", pago: false, parcela_atual: 1, total_parcelas: 1 },
  { id: 105, cartao_id: 5, categoria_id: 10, descricao: "Academia (Fixa)", valor: 30, data_compra: "2026-10-01", mes_fatura: "2026-10", pago: false, parcela_atual: 1, total_parcelas: 1 },
  { id: 106, cartao_id: 5, categoria_id: 11, descricao: "Parcela normal", valor: 20, data_compra: "2026-11-01", mes_fatura: "2026-11", pago: false, parcela_atual: 1, total_parcelas: 2 },
];

function fixture(scopeAccountIds?: number[]) {
  return calculateFinancialSnapshot({
    accounts,
    categories,
    goals,
    cards,
    transactions,
    invoiceItems,
    currentDate: "2026-08-02",
    focusMonth: "2026-08",
    years: [2026],
    analyticsAllowed: true,
    scopeAccountIds,
  });
}

Deno.test("calcula transferências modernas, legadas, conta ativa, arquivada e compartilhada", () => {
  const snapshot = fixture();
  assertMoney(snapshot.accountBalances.get(1) ?? 0, 540, "saldo da conta principal");
  assertMoney(snapshot.accountBalances.get(2) ?? 0, 685, "saldo da conta compartilhada");
  assertMoney(snapshot.accountBalances.get(3) ?? 0, 250, "saldo da conta arquivada");
  assertMoney(snapshot.globalActiveBalance, 1_225, "saldo global só com contas ativas");
  assertMoney(snapshot.currentBalance, 1_225, "saldo do escopo ativo");
  assertMoney(snapshot.predictedEndBalance, 1_175, "saldo previsto acumulado até o fim do mês");

  const sourceOnly = fixture([1]);
  const destinationOnly = fixture([2]);
  assertMoney(sourceOnly.currentBalance, 540, "transferência moderna deve debitar a origem");
  assertMoney(destinationOnly.currentBalance, 685, "transferência moderna deve creditar o destino");
});

Deno.test("separa fluxo operacional dos eventos de saldo e usa data de realização", () => {
  const snapshot = fixture();
  assertMoney(snapshot.dashboardFlow.realized_income, 100, "receitas realizadas no dashboard");
  assertMoney(snapshot.dashboardFlow.realized_expense, 55, "dashboard não deve duplicar pagamentos de fatura");
  assertMoney(snapshot.dashboardFlow.pending_expense, 20, "pendências operacionais do dashboard");
  assertMoney(snapshot.cardPurchasesByMonth.get("2026-08") ?? 0, 80, "compras originais do cartão no mês");

  const august = snapshot.monthlyCashFlow.find((item) => item.month === "2026-08");
  const july = snapshot.monthlyCashFlow.find((item) => item.month === "2026-07");
  assert(august && july, "meses esperados ausentes");
  assertMoney(august.realized_expense, 95, "fluxo de caixa inclui saída efetiva da fatura");
  assertMoney(august.account_balance, 1_175, "saldo projetado de agosto");
  assertMoney(july.account_balance, 1_210, "saldo histórico de julho");
});

Deno.test("guardar e resgatar afetam saldo, mas só guardar entra na previsão do objetivo", () => {
  const snapshot = fixture();
  const forecast = snapshot.goalForecasts.get(7);
  assert(forecast, "previsão do objetivo ausente");
  assertMoney(forecast.expectedByYearEnd, 155, "previsão anual do objetivo");
  assertMoney(forecast.expectedByTargetDate ?? 0, 155, "previsão na data-meta");
  assertMoney(snapshot.currentBalance, 1_225, "resgate concluído deve aumentar o saldo da conta");
  assertMoney(snapshot.predictedEndBalance, 1_175, "guardar pendente deve reduzir o saldo previsto");
});

Deno.test("movimento legado com objetivos homônimos é atribuído uma única vez", () => {
  const duplicateGoals: FinancialRow[] = [
    { id: 7, nome: "Reserva", saldo_atual: 100, data_prazo: "2026-12-31" },
    { id: 8, nome: "Reserva", saldo_atual: 200, data_prazo: "2026-12-31" },
  ];
  const snapshot = calculateFinancialSnapshot({
    accounts: [accounts[0]],
    categories: [],
    goals: duplicateGoals,
    transactions: [{
      id: 90,
      tipo: "despesa",
      valor: 25,
      conta_id: 1,
      status: "pendente",
      data_vencimento: "2026-09-01",
      data_realizacao: null,
      descricao: "[Transf.] Guardar em: Reserva",
    }],
    currentDate: "2026-08-02",
    focusMonth: "2026-08",
    years: [2026],
  });
  assertMoney(snapshot.goalForecasts.get(7)?.expectedByYearEnd ?? 0, 125, "menor ID recebe o legado");
  assertMoney(snapshot.goalForecasts.get(8)?.expectedByYearEnd ?? 0, 200, "homônimo não pode duplicar o legado");
});

Deno.test("escopo agregado padrão usa null e não enumera todas as contas ativas", () => {
  assert(aggregateScopeArgument([]) === null, "escopo padrão deve ser resolvido no banco");
  const explicit = aggregateScopeArgument([2, 1, 2]);
  assert(JSON.stringify(explicit) === JSON.stringify([2, 1]), "escopo explícito deve ser deduplicado");
  let rejected = false;
  try {
    aggregateScopeArgument(Array.from({ length: 101 }, (_, index) => index + 1));
  } catch (error) {
    rejected = String(error).includes("FINANCIAL_CONTEXT_SCOPE_TOO_LARGE");
  }
  assert(rejected, "escopo explícito acima do limite deve falhar fechado");
});

Deno.test("distingue pagamento total, parcial e saldo levado na fatura", () => {
  const snapshot = fixture();
  const invoice = (month: string) => snapshot.invoiceSummaries.find((item) => item.invoice_month === month);
  assertMoney(invoice("2026-06")?.closed_items_total ?? 0, 200, "itens fechados da fatura total");
  assertMoney(invoice("2026-06")?.payments_total ?? 0, 200, "pagamento total efetivo");
  assertMoney(invoice("2026-07")?.open ?? 0, 60, "saldo aberto após pagamento parcial");
  assertMoney(invoice("2026-07")?.payments_total ?? 0, 40, "pagamento parcial efetivo");
  assertMoney(invoice("2026-08")?.closed_items_total ?? 0, 80, "itens encerrados ao levar saldo");
  assertMoney(invoice("2026-08")?.payments_total ?? 0, 40, "valor realmente pago ao levar saldo");
  assertMoney(invoice("2026-09")?.open ?? 0, 45, "saldo levado para a próxima fatura");

  const card = snapshot.cardMetrics.get(5);
  assert(card, "métrica do cartão ausente");
  assertMoney(card.used_limit, 65, "limite usado deve ignorar fixa futura e incluir saldo levado");
  assertMoney(card.available_limit, 935, "limite disponível");
  assert(card.displayed_invoice_month === "2026-09", "deve exibir a próxima fatura quando a atual está paga");
});

Deno.test("mantém categorias homônimas separadas por ID e bases actual/forecast", () => {
  const snapshot = fixture();
  const year = snapshot.categoriesByYear.find((item) => item.year === 2026);
  assert(year, "categorias de 2026 ausentes");
  const category10 = year.expenses.find((item) => item.category_id === 10);
  const category11 = year.expenses.find((item) => item.category_id === 11);
  assert(category10 && category11, "categorias homônimas foram fundidas");
  assertMoney(category10.actual, 370, "realizado da categoria 10");
  assertMoney(category10.forecast, 390, "previsto da categoria 10");
  assertMoney(category11.actual, 115, "realizado da categoria 11");
  assertMoney(category11.forecast, 115, "previsto da categoria 11");
  assert(!year.expenses.some((item) => item.category_id === null), "itens sintéticos da fatura não podem virar consumo");
});

Deno.test("hidrata o contrato agregado sem alterar os totais determinísticos", () => {
  const local = fixture();
  const aggregate = financialSnapshotFromAggregate({
    calculation_version: 1,
    complete: true,
    source_counts: { transactions: transactions.length, invoice_items: invoiceItems.length },
    account_balances: [...local.accountBalances].map(([account_id, balance]) => ({ account_id, balance })),
    global_active_balance: local.globalActiveBalance,
    scope_account_ids: local.scopeAccountIds,
    current_balance: local.currentBalance,
    predicted_end_balance: local.predictedEndBalance,
    dashboard_flow: local.dashboardFlow,
    monthly_cash_flow: local.monthlyCashFlow,
    categories_by_year: local.categoriesByYear,
    card_purchases_by_month: [...local.cardPurchasesByMonth].map(([month, total]) => ({ month, total })),
    goal_forecasts: [...local.goalForecasts].map(([goal_id, forecast]) => ({
      goal_id,
      expected_by_year_end: forecast.expectedByYearEnd,
      expected_by_target_date: forecast.expectedByTargetDate,
    })),
    invoice_summaries: local.invoiceSummaries,
    card_metrics: [...local.cardMetrics.values()],
  });
  assert(aggregate.aggregateComplete, "o agregado deveria estar completo");
  assert(aggregate.sourceCounts.transactions === transactions.length, "contagem de transações divergente");
  assertMoney(aggregate.snapshot.currentBalance, local.currentBalance, "saldo atual hidratado");
  assertMoney(aggregate.snapshot.predictedEndBalance, local.predictedEndBalance, "saldo previsto hidratado");
  assertMoney(
    aggregate.snapshot.cardMetrics.get(5)?.available_limit ?? 0,
    local.cardMetrics.get(5)?.available_limit ?? 0,
    "limite do cartão hidratado",
  );
  assertMoney(
    aggregate.snapshot.goalForecasts.get(7)?.expectedByYearEnd ?? 0,
    local.goalForecasts.get(7)?.expectedByYearEnd ?? 0,
    "previsão do objetivo hidratada",
  );
});

Deno.test("rejeita agregado parcial em vez de apresentar total truncado", () => {
  let failedClosed = false;
  try {
    financialSnapshotFromAggregate({ calculation_version: 1, complete: false });
  } catch (error) {
    failedClosed = String(error).includes("FINANCIAL_CONTEXT_AGGREGATE_INCOMPLETE");
  }
  assert(failedClosed, "um agregado parcial não pode ser aceito silenciosamente");
});

Deno.test("remove chaves e blocos de credencial antes do contexto do provedor", () => {
  const original = [
    "sb_secret_ABCdef123456",
    "service_role=superSecret123",
    "gsk_AbCdEf123456789",
    "sk-proj-ABCdef123456789",
    "Bearer eyJhbGciOiJIUzI1NiJ9.abc123.signature456",
    "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
  ].join(" ");
  const redacted = redactSensitiveText(original);
  for (const fragment of ["sb_secret_", "service_role", "gsk_", "sk-proj", "eyJhbGci", "ABCDEF0123"]) {
    assert(!redacted.includes(fragment), `o fragmento sensível ${fragment} vazou`);
  }
  assert(redacted.includes("[DADO_SENSIVEL_REMOVIDO]"), "marcador de redação ausente");
});

Deno.test("reduz contexto grande sem cortar JSON nem perder agregados", () => {
  const large = {
    current_date: "2026-08-02",
    focus_month: "2026-08",
    timezone: "America/Sao_Paulo",
    plan: "premium",
    analytics_allowed: true,
    personal_data_included: true,
    scope: { type: "active_accounts", account_ids: [1], all_active_account_balance: 1_234 },
    dataset_complete: {
      cash_aggregates: true,
      card_aggregates: true,
      transactions: true,
      invoice_items: true,
      transactions_in_context: 200,
      invoice_items_in_context: 200,
    },
    month_summary: { current_account_balance: 1_234, predicted_end_balance: 1_111 },
    monthly_cash_flow: Array.from({ length: 36 }, (_, index) => ({
      month: `${2025 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
      realized_income: index,
      realized_expense: index,
      pending_income: index,
      pending_expense: index,
      account_balance: 1_000 + index,
    })),
    accounts: Array.from({ length: 80 }, (_, id) => ({ id, name: `Conta ${id} ${"x".repeat(100)}` })),
    categories: Array.from({ length: 100 }, (_, id) => ({ id, name: `Categoria ${id} ${"y".repeat(100)}` })),
    goals: Array.from({ length: 60 }, (_, id) => ({ id, name: `Objetivo ${id} ${"z".repeat(100)}` })),
    cards: Array.from({ length: 40 }, (_, id) => ({ id, name: `Cartão ${id} ${"w".repeat(100)}` })),
    relevant_transactions: Array.from({ length: 200 }, (_, id) => ({
      id,
      description: `Lançamento ${id} ${"d".repeat(300)}`,
      value: id,
    })),
    relevant_invoice_items: Array.from({ length: 200 }, (_, id) => ({
      id,
      description: `Compra ${id} ${"i".repeat(300)}`,
      value: id,
    })),
    invoice_summaries: Array.from({ length: 100 }, (_, id) => ({ card_id: id, invoice_month: "2026-08", open: id })),
    categories_by_year: [{
      year: 2026,
      income: Array.from({ length: 100 }, (_, id) => ({ category_id: id, name: `R${id}`, actual: id, forecast: id })),
      expenses: Array.from({ length: 100 }, (_, id) => ({ category_id: id, name: `D${id}`, actual: id, forecast: id })),
    }],
  };
  const encoded = serializeContextWithinBudget(large, 30_000);
  assert(encoded.length <= 30_000, "o contexto excedeu o orçamento");
  const parsed = JSON.parse(encoded);
  assert(parsed.month_summary.current_account_balance === 1_234, "o agregado principal foi perdido");
  assert(parsed.context_budget.truncated === true, "a redução não foi sinalizada");
  assert(parsed.dataset_complete.transactions === false, "a lista reduzida ainda consta como completa");
  assert(Array.isArray(parsed.relevant_transactions), "o JSON reduzido ficou estruturalmente inválido");
});
