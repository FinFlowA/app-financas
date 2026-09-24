import {
  aggregateScopeArgument,
  calculateDailyCashFlow,
  calculateFinancialSnapshot,
  contextNeeds,
  financialSnapshotFromAggregate,
  informationalRequest,
  MAX_PROVIDER_CONTEXT_CHARS,
  MAX_PROVIDER_CONTEXT_CHARS_READ_ONLY,
  redactSensitiveText,
  fetchMonthlyExtremeTransactions,
  selectedMonth,
  selectRelevantRows,
  serializeContextWithinBudget,
  transactionRelevanceSort,
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

Deno.test("expõe o mesmo saldo diário realizado e projetado do fluxo de caixa", () => {
  const snapshot = fixture();
  const daily = calculateDailyCashFlow(
    transactions,
    snapshot.scopeAccountIds,
    goals,
    snapshot.currentBalance,
    "2026-08-02",
    "2026-08",
  );
  const day20 = daily.find((row) => row.date === "2026-08-20");
  const day30 = daily.find((row) => row.date === "2026-08-30");
  assert(day20 && day30, "dias projetados ausentes");
  assertMoney(day20.account_balance, 1_195, "saldo no dia do aporte pendente");
  assertMoney(day20.saved_to_goals, 30, "aporte ao objetivo no dia");
  assert(day20.balance_is_projection, "dia futuro deveria ser projeção");
  assertMoney(day30.account_balance, 1_175, "saldo após todas as pendências do mês");
  assertMoney(day30.pending_expense, 20, "despesa pendente do dia");
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

  const providerEncoded = serializeContextWithinBudget(large);
  assert(providerEncoded.length <= MAX_PROVIDER_CONTEXT_CHARS, "o contexto padrão excedeu o teto da Groq");
  const providerParsed = JSON.parse(providerEncoded);
  assert(providerParsed.month_summary.current_account_balance === 1_234, "o teto menor perdeu o saldo agregado");
  assert(providerParsed.context_budget.truncated === true, "o teto menor precisa sinalizar truncamento");
});

Deno.test("preserva recurso citado, inclusive arquivado, fora do baseline ao reduzir contexto", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    nome: index === 39 ? "Recurso alvo distante" : `Recurso ${String(index + 1).padStart(2, "0")}`,
    ativa: true,
  }));
  const selectedAccounts = selectRelevantRows(rows, () => true, 30, 40, ["alvo"], "Conta alvo");
  const selectedCategories = selectRelevantRows(rows, () => true, 30, 40, ["alvo"], "Categoria alvo");
  const rowsWithArchivedTarget = [
    ...rows,
    { id: 41, nome: "Categoria arquivada alvo", ativa: false },
  ];
  const selectedWithArchived = selectRelevantRows(
    rowsWithArchivedTarget,
    (row) => row.ativa === true,
    30,
    40,
    ["arquivada"],
    "Reative a categoria arquivada alvo",
  );

  assert(selectedAccounts[0]?.id === 40, "a conta citada precisa anteceder o baseline");
  assert(selectedCategories[0]?.id === 40, "a categoria citada precisa anteceder o baseline");
  assert(selectedWithArchived[0]?.id === 41, "a categoria arquivada citada precisa entrar para reactivate_category");

  const encoded = serializeContextWithinBudget({
    current_date: "2026-08-16",
    focus_month: "2026-08",
    dataset_complete: {},
    month_summary: { current_account_balance: 100 },
    monthly_cash_flow: [],
    accounts: selectedAccounts.map((row) => ({ id: row.id, name: row.nome, padding: "a".repeat(120) })),
    categories: selectedWithArchived.map((row) => ({ id: row.id, name: row.nome, active: row.ativa, padding: "c".repeat(120) })),
    goals: [],
    cards: [],
    relevant_transactions: [],
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
  });
  const parsed = JSON.parse(encoded);

  assert(parsed.accounts.some((row: FinancialRow) => row.id === 40), "a conta citada foi podada");
  assert(parsed.categories.some((row: FinancialRow) => row.id === 41 && row.active === false), "a categoria arquivada citada foi podada");
});

Deno.test("recorrencia semanal com muitas ocorrencias no cenario nao estoura o orcamento nem apaga contas e categorias", () => {
  // Uma despesa fixa semanal ("Refrigerante") citada numa pergunta de
  // projeção pode reunir dezenas de ocorrências em scenario_candidates (até
  // 120, ver context.ts). Sem cortar esse array ANTES dos demais, ele sozinho
  // já ultrapassa o orçamento (40 itens ~= 6,3 mil caracteres nesta massa),
  // então nenhum outro corte (contas, categorias) resolve sozinho e o
  // contexto sempre cai no resumo essencial, que zera contas e categorias
  // mesmo quando elas caberiam perfeitamente ao lado de uma lista de cenário
  // já reduzida. Cortando scenario_candidates primeiro, o restante do
  // contexto (contas, categorias) sobrevive intacto nesta massa de teste.
  const account = (id: number) => ({ id, name: `Conta ${id}`, type: "corrente", balance: 1_234.56 });
  const category = (id: number) => ({ id, name: `Categoria ${id}`, type: id % 2 ? "despesa" : "receita" });
  const scenario = (index: number) => ({
    id: 1_000 + index,
    type: "despesa",
    value: 6.5,
    description: "Refrigerante (Fixa semanal)",
    status: index < 20 ? "paga" : "pendente",
    scheduled_date: `2026-${String(Math.min(12, Math.floor(index / 4) + 1)).padStart(2, "0")}-${String((index % 4) * 7 + 2).padStart(2, "0")}`,
    realization_date: null,
  });

  const context = {
    current_date: "2026-09-18",
    focus_month: "2026-09",
    timezone: "America/Sao_Paulo",
    plan: "premium",
    analytics_allowed: true,
    personal_data_included: true,
    scope: { type: "active_accounts", account_ids: [1, 2, 3, 4], all_active_account_balance: 9.67 },
    dataset_complete: { transactions: true, invoice_items: true, accounts_in_context: true, categories_in_context: true },
    month_summary: { current_account_balance: 9.67, predicted_end_balance: -40 },
    monthly_cash_flow: [{ month: "2026-09", realized_income: 100, realized_expense: 55, pending_income: 0, pending_expense: 20, account_balance: 9.67 }],
    daily_cash_flow: [],
    accounts: Array.from({ length: 4 }, (_, index) => account(index + 1)),
    categories: Array.from({ length: 6 }, (_, index) => category(index + 1)),
    goals: [],
    cards: [],
    relevant_transactions: [],
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
    scenario_candidates: Array.from({ length: 40 }, (_, index) => scenario(index)),
  };

  const encoded = serializeContextWithinBudget(context);
  assert(encoded.length <= MAX_PROVIDER_CONTEXT_CHARS, "o cenario com muitas recorrencias excedeu o teto da Groq");
  const parsed = JSON.parse(encoded);
  assert(Array.isArray(parsed.scenario_candidates), "scenario_candidates precisa continuar sendo um array valido");
  assert(parsed.scenario_candidates.length > 0, "a pergunta de cenario nao pode ficar sem nenhuma ocorrencia da recorrencia citada");
  assert(parsed.scenario_candidates.length <= 40, "o corte precisa reduzir a lista original quando ela nao cabe no orcamento");
  assert(parsed.accounts.length === 4, "contas nao podiam ter sido zeradas so por causa de uma lista de cenario grande");
  assert(parsed.categories.length === 6, "categorias nao podiam ter sido zeradas so por causa de uma lista de cenario grande");
  assert(parsed.context_budget.truncated === true, "o orcamento reduzido ainda precisa ser sinalizado como truncado");
});

Deno.test("contextNeeds reconhece perguntas de educacao financeira sobre investimentos", () => {
  const investmentQuestions = [
    "Onde posso investir o meu dinheiro?",
    "Qual a diferença entre renda fixa e renda variável?",
    "O que é um CDB?",
    "Como funciona o Tesouro Direto?",
    "É melhor deixar na poupança ou investir em fundo imobiliário?",
    "Quanto está a Selic hoje?",
    // Regressao real: a forma plural, mais natural de perguntar, nao batia
    // com o regex singular ("fundo imobiliario", "\bfii\b") e a pergunta
    // ficava sem rota de investimento nem indicadores de mercado.
    "Me explique sobre fundos imobiliarios",
    "O que são FIIs?",
  ];
  for (const question of investmentQuestions) {
    const needs = contextNeeds(question, true);
    assert(needs.investmentEducation, `deveria reconhecer educacao sobre investimentos: "${question}"`);
    assert(needs.route === "investment_education", `rota deveria ser investment_education para: "${question}"`);
  }

  const unrelated = contextNeeds("Quanto gastei com mercado este mês?", true);
  assert(!unrelated.investmentEducation, "pergunta sobre gasto de mercado nao deveria acionar educacao de investimentos");

  const mutation = contextNeeds("Crie uma despesa de investimento de R$ 500", true);
  assert(!mutation.investmentEducation, "uma mutacao nunca deveria ser roteada como educacao de investimentos");
  assert(mutation.route === "mutation", "mutacao continua tendo prioridade sobre qualquer outro dominio");
});

Deno.test("informationalRequest reconhece pergunta conceitual isolada mas nao uma que pede numero atual", () => {
  // Bug real: buildFinancialContext chamava informationalRequest() no texto
  // que concatena ate 3 mensagens anteriores do usuario (usado só para dar
  // continuidade de domínio em contextNeeds). Como esse texto concatenado
  // ainda contém "o que e" de um turno anterior ("O que é selic?"), a
  // pergunta ATUAL pedindo um número real ("Como está a porcentagem do
  // CDI?") também caía no atalho informativo (sem indicadores, sem dados) --
  // mesmo essa pergunta, isolada, não devendo cair nesse atalho. A correção
  // foi buildFinancialContext passar a checar só a mensagem atual aqui, não
  // o texto concatenado usado por contextNeeds (ver chamada com o parâmetro
  // currentMessage). Este teste trava o comportamento da função em si.
  assert(informationalRequest("O que é selic?"), "pergunta conceitual isolada deveria usar o atalho informativo");
  assert(
    !informationalRequest("Como esta a porcentagem do CDI?"),
    "pergunta que pede um numero atual nao pode cair no atalho informativo",
  );
});

Deno.test("contextNeeds so busca indicadores de mercado quando a pergunta pede os numeros em si", () => {
  // Bug real: "Qual e o melhor lugar pra investir?" cai em investmentDomain
  // (rota investment_education, resposta generica e sem numeros), mas nao
  // deveria buscar/anexar Selic-CDI-IPCA -- a resposta do modelo nunca cita
  // esses valores, entao o cartao visual apareceria sem nenhum motivo.
  const genericAdviceQuestions = [
    "Qual é o melhor lugar para investir?",
    "Onde posso investir o meu dinheiro?",
    "É melhor deixar na poupança ou investir em fundo imobiliário?",
    "Como funciona o Tesouro Direto?",
    "O que é um CDB?",
  ];
  for (const question of genericAdviceQuestions) {
    const needs = contextNeeds(question, true);
    assert(needs.investmentEducation, `ainda deveria ser educacao de investimentos: "${question}"`);
    assert(!needs.marketIndicatorQuery, `nao deveria buscar indicadores para uma pergunta generica: "${question}"`);
  }

  const indicatorQuestions = [
    "Quanto está a Selic hoje?",
    "Como está o mercado financeiro?",
    "O CDI subiu recentemente?",
    "A taxa Selic mudou nos últimos meses?",
    "Qual o IPCA acumulado em 12 meses?",
    // Bug real: CDB/LCI/LCA nao tem taxa publica propria, mas sao cotados
    // como % do CDI -- perguntar "a porcentagem" desses produtos deveria
    // trazer o CDI como referencia, nao responder "nao tenho indicadores".
    "Como está a porcentagem do CDB?",
    "Qual o rendimento da LCI hoje?",
    "Qual a rentabilidade da poupança?",
  ];
  for (const question of indicatorQuestions) {
    const needs = contextNeeds(question, true);
    assert(needs.marketIndicatorQuery, `deveria buscar indicadores para: "${question}"`);
  }
});

Deno.test("marketIndicatorQuery usa so a pergunta atual, nao o historico concatenado de turnos", () => {
  // Bug real: buildFinancialContext passa a contextNeeds() um texto que
  // concatena ate 3 mensagens anteriores do usuario (para dar continuidade
  // de dominio, ex.: cartao, categoria). Como Selic/CDI/IPCA de um turno
  // anterior continuava nesse texto concatenado, uma pergunta seguinte
  // completamente diferente (ex.: pedir para explicar fundos imobiliarios,
  // sem pedir nenhum numero) ainda vinha com o cartao visual de Selic/CDI/
  // IPCA "grudado" da pergunta anterior.
  const concatenatedWithOlderSelicTurn = "Como está o mercado financeiro?\nContinuação do usuário: Me explique sobre fundos imobiliarios";
  const needsUsingConcatenatedAsCurrent = contextNeeds(concatenatedWithOlderSelicTurn, true);
  assert(
    needsUsingConcatenatedAsCurrent.marketIndicatorQuery,
    "sanity check: o texto concatenado sozinho ainda dispara indicadores (por isso o bug existia)",
  );
  const needsWithCurrentMessageSeparated = contextNeeds(concatenatedWithOlderSelicTurn, true, "Me explique sobre fundos imobiliarios");
  assert(
    !needsWithCurrentMessageSeparated.marketIndicatorQuery,
    "a pergunta atual sobre fundos imobiliarios nao pode reaproveitar indicadores de um turno anterior sobre Selic",
  );
});

Deno.test("marketIndicatorQuery reconhece IGP-M e um pedido de dado natural como continuacao", () => {
  // IGP-M passou a ser um indicador de verdade (calculado a partir da serie
  // mensal do SGS via metodo composto); a forma como o usuario digita
  // ("IGPM", "IGP-M", "igp m") nao pode importar. Um pedido curto de
  // continuacao ("Preciso da taxa") tambem precisa disparar a busca quando
  // a conversa ja estabeleceu o dominio de investimento (investmentDomain
  // vindo do texto concatenado), mesmo sem repetir o nome do indicador.
  for (const question of ["IGPM setembro de 2026", "IGP-M setembro de 2026", "igp m de setembro"]) {
    assert(contextNeeds(question, true).marketIndicatorQuery, `deveria reconhecer IGP-M em: "${question}"`);
  }
  const followUp = contextNeeds(
    "Fale sobre o IGP-M\nContinuação do usuário: Preciso da taxa",
    true,
    "Preciso da taxa",
  );
  assert(followUp.marketIndicatorQuery, "pedido curto de continuacao deveria disparar a busca de indicadores");
});

Deno.test("selectedMonth resolve mes que vem e mes passado a partir do mes atual, nao do foco anterior", () => {
  const currentMonth = "2026-09";
  assert(selectedMonth("Qual o valor total que eu irei receber mês que vem?", currentMonth) === "2026-10", "mes que vem deveria ser outubro, nao o mes atual");
  assert(selectedMonth("Quanto vou gastar no próximo mês?", currentMonth) === "2026-10", "proximo mes deveria avancar um mes a partir do atual");
  assert(selectedMonth("Como foi meu mês passado?", currentMonth) === "2026-08", "mes passado deveria voltar um mes a partir do atual");
  assert(selectedMonth("Quanto gastei no mês anterior?", currentMonth) === "2026-08", "mes anterior deveria voltar um mes a partir do atual");
  // Guarda a virada de ano nos dois sentidos.
  assert(selectedMonth("mês que vem", "2026-12") === "2027-01", "mes que vem em dezembro deveria virar o ano");
  assert(selectedMonth("mês passado", "2026-01") === "2025-12", "mes passado em janeiro deveria voltar o ano");
  // Um mes explicito continua tendo prioridade sobre o fallback do parametro.
  assert(selectedMonth("Quanto gastei em julho de 2026?", currentMonth) === "2026-07", "mes explicito nomeado continua funcionando");
  assert(selectedMonth("Sem nenhuma referencia de data", currentMonth) === currentMonth, "sem referencia de mes, o fallback deve ser preservado");
});

Deno.test("selectedMonth foca o mes de uma data DD/MM citada, mesmo fora do mes atual", () => {
  // Bug real: "Quanto vou ter na conta dia 14/08?" (perguntado em setembro)
  // nao mudava o foco para agosto. O fluxo diario e as transacoes do
  // contexto continuavam sendo montados para setembro, ficavam vazios para
  // a data pedida, e o modelo — sem nenhum dado relevante para responder —
  // classificava a pergunta como fora de escopo tres vezes seguidas.
  const currentMonth = "2026-09";
  assert(selectedMonth("Quanto vou ter na conta dia 14/08?", currentMonth) === "2026-08", "data DD/MM precisa focar o mes dela, nao o mes atual");
  assert(selectedMonth("O que tenho agendado para 05/12?", currentMonth) === "2026-12", "data DD/MM em outro mes tambem precisa mudar o foco");
  assert(selectedMonth("Quanto gastei em 14/08/2025?", currentMonth) === "2025-08", "data DD/MM/YYYY precisa usar o ano explicito, nao o ano atual");
  // Uma data ISO completa (YYYY-MM-DD) ja funcionava antes desta correção.
  assert(selectedMonth("Quanto vou ter em 2026-08-14?", currentMonth) === "2026-08", "data ISO completa continua funcionando");
});

Deno.test("market_indicators cai primeiro no orcamento em vez de sacrificar contas por ~200 bytes", () => {
  // Reproduz o caso real: uma conversa sobre um objetivo ("Entrada casa")
  // que tambem menciona CDB (por isso ganha market_indicators) e tem varias
  // contas cadastradas. Sem o corte antecipado, esse acrescimo pequeno e
  // opcional bastava para estourar o orcamento e derrubar contas que caberiam
  // perfeitamente sozinhas — ou, em casos piores, lancar
  // FINANCIAL_CONTEXT_BUDGET_EXCEEDED (o erro tecnico visto em producao).
  const account = (id: number) => ({ id, name: `Conta ${id}`, type: "corrente", balance: 1_234.56 });
  const category = (id: number) => ({ id, name: `Categoria ${id}`, type: id % 2 ? "despesa" : "receita" });
  const marketIndicators = {
    selic_rate_annual: 13.75, selic_reference_date: "2026-09-18",
    cdi_rate_annual: 13.65, cdi_reference_date: "2026-09-17",
    ipca_12m_percent: 4.22, ipca_reference_date: "2026-08-01",
    source: "bcb_sgs",
  };
  const context = {
    current_date: "2026-09-18",
    focus_month: "2026-09",
    timezone: "America/Sao_Paulo",
    plan: "premium",
    analytics_allowed: true,
    personal_data_included: true,
    scope: { type: "active_accounts", account_ids: Array.from({ length: 38 }, (_, index) => index + 1), all_active_account_balance: 9.67 },
    dataset_complete: { transactions: true, invoice_items: true, accounts_in_context: true, categories_in_context: true },
    month_summary: { current_account_balance: 9.67, predicted_end_balance: -40 },
    monthly_cash_flow: [{ month: "2026-09", realized_income: 100, realized_expense: 55, pending_income: 0, pending_expense: 20, account_balance: 9.67 }],
    daily_cash_flow: [],
    market_indicators: marketIndicators,
    accounts: Array.from({ length: 38 }, (_, index) => account(index + 1)),
    categories: Array.from({ length: 8 }, (_, index) => category(index + 1)),
    goals: [{ id: 1, name: "Entrada casa", active: true, balance: 1_550, target: 50_000, target_date: "2027-12-31", expected_by_year_end: 1_550, expected_by_target_date: null }],
    cards: [],
    relevant_transactions: [],
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
    scenario_candidates: [],
  };

  const encoded = serializeContextWithinBudget(context);
  assert(encoded.length <= MAX_PROVIDER_CONTEXT_CHARS, "o contexto com indicadores de mercado excedeu o teto");
  const parsed = JSON.parse(encoded);
  assert(parsed.market_indicators === null, "market_indicators deveria ser o primeiro a cair quando o orcamento aperta");
  assert(parsed.accounts.length === 38, "contas nao podiam ter sido cortadas por causa de ~200 bytes de indicadores opcionais");
  assert(parsed.goals.some((goal: FinancialRow) => goal.name === "Entrada casa"), "o objetivo citado precisa continuar presente");
});

Deno.test("resumo essencial limita scope.account_ids e matched_category_ids, que nunca tinham corte", () => {
  // Confirmado em produção: FINANCIAL_CONTEXT_BUDGET_EXCEEDED ainda ocorria
  // depois da correção de market_indicators, porque `scope` (account_ids,
  // matched_category_ids/goal_ids/card_ids) era copiado sem nenhum limite
  // até para dentro do resumo essencial de último recurso — muitas contas ou
  // muitas categorias casadas por nome bastavam para estourar o orçamento
  // mesmo já sem contas, categorias, goals e cenário.
  const scenario = (index: number) => ({
    id: 1_000 + index, type: "despesa", value: 6.5, description: "Refrigerante (Fixa semanal)",
    status: "pendente", scheduled_date: `2026-09-0${(index % 9) + 1}`, realization_date: null,
  });
  const context = {
    current_date: "2026-09-18",
    focus_month: "2026-09",
    timezone: "America/Sao_Paulo",
    plan: "premium",
    analytics_allowed: true,
    personal_data_included: true,
    scope: {
      type: "active_accounts",
      account_ids: Array.from({ length: 300 }, (_, index) => index + 1),
      all_active_account_balance: 9.67,
      matched_category_ids: Array.from({ length: 200 }, (_, index) => index + 1),
      matched_goal_ids: [],
      matched_card_ids: [],
    },
    dataset_complete: { transactions: true, invoice_items: true },
    month_summary: { current_account_balance: 9.67, predicted_end_balance: -40 },
    monthly_cash_flow: [{ month: "2026-09", realized_income: 100, realized_expense: 55, pending_income: 0, pending_expense: 20, account_balance: 9.67 }],
    daily_cash_flow: [],
    market_indicators: null,
    accounts: [],
    categories: [],
    goals: [],
    cards: [],
    relevant_transactions: [],
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
    scenario_candidates: Array.from({ length: 12 }, (_, index) => scenario(index)),
  };

  const encoded = serializeContextWithinBudget(context);
  assert(encoded.length <= MAX_PROVIDER_CONTEXT_CHARS, "scope sem limite nao pode mais estourar o orcamento do resumo essencial");
  const parsed = JSON.parse(encoded);
  assert(parsed.scope.account_ids.length <= 20, "account_ids precisa ser limitado no resumo essencial");
  assert(parsed.scope.matched_category_ids.length <= 10, "matched_category_ids precisa ser limitado no resumo essencial");
});

Deno.test("rede de seguranca final nunca deixa o contexto financeiro falhar por tamanho", () => {
  // Mesmo um campo fixo e imprevisto (aqui, um month_summary com um valor
  // absurdamente grande, o que nao deveria acontecer com dados reais) nao
  // pode mais resultar em FINANCIAL_CONTEXT_BUDGET_EXCEEDED: a rede de
  // seguranca final descarta tudo que nao seja essencial e sempre cabe.
  const context = {
    current_date: "2026-09-18",
    focus_month: "2026-09",
    timezone: "America/Sao_Paulo",
    plan: "premium",
    analytics_allowed: true,
    personal_data_included: true,
    scope: { type: "active_accounts", account_ids: [1], all_active_account_balance: 9.67 },
    dataset_complete: { transactions: true, invoice_items: true },
    // Campo pathologicamente grande que nenhum outro corte do pipeline
    // conhece — simula um contribuinte de tamanho totalmente inesperado.
    month_summary: { current_account_balance: 9.67, predicted_end_balance: -40, unexpected_note: "x".repeat(10_000) },
    monthly_cash_flow: [],
    daily_cash_flow: [],
    market_indicators: null,
    accounts: [],
    categories: [],
    goals: [],
    cards: [],
    relevant_transactions: [],
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
    scenario_candidates: [],
  };

  const encoded = serializeContextWithinBudget(context);
  assert(encoded.length <= MAX_PROVIDER_CONTEXT_CHARS, "a rede de seguranca final precisa garantir que o contexto sempre caiba");
  const parsed = JSON.parse(encoded);
  assert(parsed.context_budget.truncated === true, "o contexto reduzido pela rede de seguranca ainda precisa ser sinalizado como truncado");
});

Deno.test("teto somente-leitura mais largo preserva categories e recent_week_category_totals para uma conta bem movimentada", () => {
  // Bug real em producao: "Quanto eu gastei com alimentacao na ultima
  // semana?" respondia que nao havia dados, mesmo com lancamentos reais no
  // banco (confirmados por SQL direto: 3 lancamentos somando R$68 na
  // categoria). finance_ai_debug_log confirmou categoriesCount=0 e
  // hasRecentWindow=false para essa pergunta -- a rede de seguranca final de
  // serializeContextWithinBudget tinha zerado categories e derrubado
  // recent_week_category_totals por completo. Causa raiz: relevant_transactions
  // sozinho pode passar de dezenas de milhares de caracteres (compactTransaction
  // tem mais de 20 campos por linha, incluindo nomes de conta e categoria) para
  // uma conta com uso normal (varios lancamentos recorrentes "(Fixa)" no mes,
  // como o usuario real tinha). Combinado com scenario_candidates (recorrencias
  // futuras) e o escopo de contas, o total bruto pode superar em muito o teto
  // de MAX_PROVIDER_CONTEXT_CHARS (4K, calibrado para o prompt operacional, que
  // fica perto do proprio teto do provedor) mesmo depois de reduzir tudo ao
  // minimo -- o que nunca deveria acontecer no caminho somente-leitura, que tem
  // prompt bem menor e sobra de orcamento nao usada.
  const categoryNames = ["Alimentação", "Educação", "Lazer", "Moradia", "Outros", "Renda Extra", "Salário", "Saúde", "Tecnologia", "Transporte", "Assinaturas"];
  const descriptions = ["Mercado", "Café", "Uber", "Farmacia", "Spotify", "EMTU", "Almoço", "McDonald's", "Aluguel", "Internet (Fixa)"];
  const relevantTransactions = Array.from({ length: 80 }, (_, index) => ({
    id: 8_000 + index,
    type: index % 5 === 0 ? "receita" : "despesa",
    value: 9.25 + index,
    description: descriptions[index % descriptions.length],
    status: "paga",
    scheduled_date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
    realization_date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
    account: "Banco do Brasil",
    account_id: 69,
    category: categoryNames[index % categoryNames.length],
    category_id: 300 + (index % categoryNames.length),
    internal_transfer: false,
    destination_account_id: null,
    destination_account: null,
    goal_id: null,
    goal: null,
    goal_operation: null,
    series_id: null,
    invoice_payment: false,
    invoice_payment_card_id: null,
    invoice_payment_month: null,
    invoice_payment_mode: null,
  }));
  const scenarioCandidates = Array.from({ length: 120 }, (_, index) => ({
    id: 9_000 + index,
    type: "despesa",
    value: 12.5,
    description: "Refrigerante (Fixa semanal)",
    status: "pendente",
    scheduled_date: `2026-09-0${(index % 9) + 1}`,
    realization_date: null,
  }));
  const context = {
    current_date: "2026-09-24",
    focus_month: "2026-09",
    timezone: "America/Sao_Paulo",
    plan: "free",
    analytics_allowed: true,
    personal_data_included: true,
    // account_ids reflete todas as contas ativas da rede compartilhada do
    // usuario, nao so as proprias -- nao tem corte proprio em nenhum passo de
    // trimArray, entao sozinho ja contribui um bom pedaco do orcamento.
    scope: { type: "active_accounts", account_ids: Array.from({ length: 300 }, (_, index) => index + 1), all_active_account_balance: 119.87 },
    dataset_complete: { transactions: true, invoice_items: true },
    month_summary: { current_account_balance: 119.87, predicted_end_balance: 40 },
    monthly_cash_flow: [],
    daily_cash_flow: [],
    market_indicators: null,
    accounts: [1, 2, 3, 4].map((id) => ({ id, name: `Conta ${id}`, active: true, balance: 30, shared: false, owned_by_user: true, can_update: true })),
    categories: categoryNames.map((name, index) => ({ id: 300 + index, name, type: index % 2 === 0 ? "despesa" : "receita", active: true, owned_by_user: true, can_update: true })),
    goals: [],
    cards: [],
    relevant_transactions: relevantTransactions,
    relevant_invoice_items: [],
    invoice_summaries: [],
    categories_by_year: [],
    scenario_candidates: scenarioCandidates,
    recent_week_category_totals: {
      start_date: "2026-09-18",
      end_date: "2026-09-24",
      by_category: [{ category: "Alimentação", total: 68 }],
    },
  };

  // Prova que o cenario realmente estoura o teto apertado -- confirma que o
  // bug era real e nao um artefato do teste (sem isso, a asserção abaixo
  // passaria mesmo sem o corte causar dano nenhum).
  const encodedOperational = serializeContextWithinBudget(context, MAX_PROVIDER_CONTEXT_CHARS);
  const parsedOperational = JSON.parse(encodedOperational);
  assert(parsedOperational.categories.length === 0, "o cenario de teste precisa reproduzir o colapso real (categories zerado) no teto de 4K");
  assert(!parsedOperational.recent_week_category_totals, "o cenario de teste precisa reproduzir a perda de recent_week_category_totals no teto de 4K");

  const encodedReadOnly = serializeContextWithinBudget(context, MAX_PROVIDER_CONTEXT_CHARS_READ_ONLY);
  assert(encodedReadOnly.length <= MAX_PROVIDER_CONTEXT_CHARS_READ_ONLY, "o contexto somente-leitura excedeu seu proprio teto");
  const parsedReadOnly = JSON.parse(encodedReadOnly);
  assert(Array.isArray(parsedReadOnly.categories) && parsedReadOnly.categories.length > 0, "categories nao pode ser zerado no teto somente-leitura para essa mesma conta");
  assert(
    parsedReadOnly.recent_week_category_totals?.by_category?.some((row: { category: string }) => row.category === "Alimentação"),
    "recent_week_category_totals precisa sobreviver ao corte no teto somente-leitura",
  );
});

Deno.test("contextNeeds busca os lancamentos quando a pergunta pede quais despesas/receitas, nao so o total", () => {
  // Bug real: "Quais despesas tenho neste mês?" respondia com o total
  // agregado (despesas realizadas + pendentes) em vez de listar os
  // lancamentos, porque "despesa"/"receita" só ativavam categoryDomain
  // (dados agregados por categoria) e nunca historyDomain — o contexto
  // simplesmente não trazia relevant_transactions para o modelo listar.
  const expenseList = contextNeeds("Quais despesas tenho neste mês?", true);
  assert(expenseList.transactionDetails, "pergunta 'quais despesas' precisa trazer os lancamentos, nao so o agregado");

  const incomeList = contextNeeds("Quais receitas eu tenho essa semana?", true);
  assert(incomeList.transactionDetails, "pergunta 'quais receitas' tambem precisa trazer os lancamentos");

  // Uma pergunta de total continua funcionando sem exigir a lista (embora
  // agora também a inclua, o que é inofensivo — o modelo escolhe pelo
  // prompt qual delas usar).
  const total = contextNeeds("Quanto gastei de despesas neste mês?", true);
  assert(total.categories, "pergunta de total continua trazendo o agregado por categoria");
});

Deno.test("contextNeeds busca os lancamentos quando a pergunta pede o maior/menor gasto especifico", () => {
  // Bug real: "Qual foi o meu maior gasto no mês de agosto?" respondeu que
  // os lançamentos completos de agosto não estavam disponíveis, porque
  // "gasto" (sem o "-ei" de "gastei") só ativava categoryDomain (agregado
  // por categoria) — o contexto trazia o total por categoria, mas nunca os
  // lançamentos individuais necessários para apontar qual foi o maior.
  const biggestExpense = contextNeeds("Qual foi o meu maior gasto no mês de agosto?", true);
  assert(biggestExpense.transactionDetails, "pergunta pelo maior gasto precisa trazer os lancamentos individuais do mes");
  // Mesmo com os lancamentos individuais buscados, a amostra enviada ao
  // modelo cabe só ~24-40 itens por orçamento de contexto (ver
  // transactionRelevanceAnchor em buildFinancialContext) -- um mês ativo
  // pode ter bem mais lançamentos que isso, e o de maior valor podia nem
  // estar na amostra. monthlyExtremeTransaction aciona o calculo
  // deterministico no banco (fetchMonthlyExtremeTransactions), que nao
  // depende de amostra nenhuma.
  assert(biggestExpense.monthlyExtremeTransaction, "pergunta pelo maior gasto precisa calcular o extremo do mes no banco, nao so amostrar lancamentos");

  const smallestExpense = contextNeeds("Qual foi minha menor despesa em setembro?", true);
  assert(smallestExpense.transactionDetails, "pergunta pela menor despesa tambem precisa trazer os lancamentos");
  assert(smallestExpense.monthlyExtremeTransaction, "pergunta pela menor despesa tambem precisa do calculo deterministico do extremo");

  const mostExpensivePurchase = contextNeeds("Qual foi a compra mais cara do mês?", true);
  assert(mostExpensivePurchase.transactionDetails, "pergunta pela compra mais cara precisa trazer os lancamentos");
  assert(mostExpensivePurchase.monthlyExtremeTransaction, "pergunta pela compra mais cara tambem precisa do calculo deterministico do extremo");

  // Uma pergunta agregada por categoria (sem pedir um lançamento específico)
  // não precisa da lista individual nem do extremo — continua só com o
  // agregado.
  const categoryBreakdown = contextNeeds("Como estão meus gastos por categoria?", true);
  assert(!categoryBreakdown.transactionDetails, "pergunta agregada por categoria nao deveria exigir os lancamentos individuais");
  assert(!categoryBreakdown.monthlyExtremeTransaction, "pergunta agregada por categoria nao deveria calcular o extremo do mes");

  // Bug real (continuação): depois de responder o maior gasto de agosto, a
  // pergunta de acompanhamento "E a menor?" não repete "gasto"/"despesa" e
  // cai fora do padrão isolado -- mas o histórico concatenado (requestContext)
  // ainda carrega "maior gasto...agosto" da pergunta anterior, e é isso que
  // precisa manter monthlyExtremeTransaction ligado nessa continuação
  // (monthlyExtremeTransactionAnswer, em index.ts, decide sozinho se ainda
  // faz sentido responder com base na mensagem atual e na anterior).
  const followUpRequestContext = "Qual foi o meu maior gasto no mês de agosto?\nContinuação do usuário: E a menor?";
  const followUp = contextNeeds(followUpRequestContext, true, "E a menor?");
  assert(followUp.monthlyExtremeTransaction, "continuacao 'E a menor?' precisa manter o calculo do extremo ligado via o historico concatenado");
});

Deno.test("contextNeeds busca o total por categoria em dois meses quando a pergunta compara com o mes passado", () => {
  // Bug real: "Comparando com o mês passado, meus gastos com transporte
  // aumentaram ou diminuíram?" respondeu que não tinha os dados do mês
  // anterior -- nenhum agregado existente cobre "total de uma categoria em
  // dois meses especificos" (categories_by_year soma o ANO inteiro por
  // categoria; month_summary não abre por categoria).
  const comparison = contextNeeds("Comparando com o mês passado, meus gastos com transporte aumentaram ou diminuíram?", true);
  assert(comparison.categoryMonthComparison, "pergunta de comparacao com o mes passado precisa buscar o total por categoria dos dois meses");

  const comparisonAlt = contextNeeds("Minha receita de salário subiu ou caiu em relação ao mês anterior?", true);
  assert(comparisonAlt.categoryMonthComparison, "'mes anterior' e outros verbos de variacao (subiu/caiu) tambem devem acionar a comparacao");

  // Só "mês passado" sozinho (sem verbo de comparação) não é o suficiente
  // -- pode ser só uma pergunta pelo total do mês anterior, sem comparar.
  const justPreviousMonth = contextNeeds("Quanto eu gastei com transporte no mês passado?", true);
  assert(!justPreviousMonth.categoryMonthComparison, "pergunta so pelo total do mes passado, sem verbo de comparacao, nao deveria acionar a comparacao");

  // E um verbo de comparação sozinho, sem menção ao mês passado/anterior,
  // também não deveria acionar (ex.: comparar duas categorias entre si).
  const compareCategories = contextNeeds("Comparando categoria de alimentação com transporte, qual é maior?", true);
  assert(!compareCategories.categoryMonthComparison, "comparacao sem mencionar o mes passado/anterior nao deveria acionar a comparacao de meses");
});

Deno.test("transactionRelevanceSort ancorado no mes em foco prioriza esse mes sobre o mes atual", () => {
  // Bug real: a amostra de relevant_transactions sempre ordenava por
  // proximidade a HOJE, mesmo perguntando por um mes diferente do atual.
  // Como o mes perguntado fica sempre mais distante de hoje que o mes
  // atual, seus lancamentos nunca entravam nem no preenchimento inicial
  // (top 24) -- confirmado em producao: uma conta com 79 lancamentos em
  // agosto e hoje em 24/09 tinha ZERO lancamentos de agosto nos 24
  // primeiros ao ordenar por proximidade a hoje. Ancorar num dia do mes em
  // foco (ex.: 15) resolve isso sem quebrar o caso comum (mes em foco =
  // mes atual, onde o comportamento e identico a antes).
  const rows: FinancialRow[] = [
    ...Array.from({ length: 30 }, (_, index) => ({
      id: 100 + index,
      tipo: "despesa",
      valor: 10,
      status: "paga",
      data_vencimento: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
      data_realizacao: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
    })),
    { id: 1, tipo: "despesa", valor: 559.99, status: "paga", data_vencimento: "2026-08-10", data_realizacao: "2026-08-06" },
    { id: 2, tipo: "despesa", valor: 14, status: "paga", data_vencimento: "2026-08-02", data_realizacao: "2026-08-02" },
  ];

  const sortedByToday = [...rows].sort(transactionRelevanceSort("2026-09-24"));
  const augustInTop24ByToday = sortedByToday.slice(0, 24).filter((row) => String(row.data_vencimento).startsWith("2026-08")).length;
  assert(augustInTop24ByToday === 0, "ancorado em hoje, nenhum lancamento de agosto deveria caber nos 24 primeiros (reproduz o bug)");

  const sortedByFocusMonth = [...rows].sort(transactionRelevanceSort("2026-08-15"));
  const augustInTop24ByFocusMonth = sortedByFocusMonth.slice(0, 24).filter((row) => String(row.data_vencimento).startsWith("2026-08")).length;
  assert(augustInTop24ByFocusMonth === 2, "ancorado no meio do mes em foco, os 2 lancamentos de agosto devem caber nos 24 primeiros");
});

Deno.test("fetchMonthlyExtremeTransactions ignora transferencias, movimentacoes de objetivo e pagamentos de fatura", async () => {
  // Bug real: "Qual foi o meu menor gasto no mês de agosto?" respondeu
  // "Guardar em: TESTEEE" (um aporte de R$ 1,00 num objetivo/caixinha) como
  // se fosse uma despesa comum -- o banco grava esses aportes como
  // tipo=despesa, mas calculateFinancialSnapshot já exclui transferências,
  // movimentações de objetivo e pagamentos de fatura dos agregados de
  // categoria; o cálculo do extremo do mês precisa da mesma exclusão.
  const rows = [
    // Descrições reais confirmadas no banco: aportes/resgates de objetivo
    // carregam tanto o prefixo legado [Transf.] quanto a marcação nova
    // [Objetivo:ID:guardar|resgatar].
    { id: 1, tipo: "despesa", valor: 1, descricao: "[Transf.] Guardar em: TESTEEE [Objetivo:58:guardar]", status: "paga", data_vencimento: "2026-08-19", data_realizacao: "2026-08-19" },
    { id: 2, tipo: "despesa", valor: 2, descricao: "Conta [Transf.] [Destino:5]", status: "paga", data_vencimento: "2026-08-12", data_realizacao: "2026-08-12" },
    { id: 3, tipo: "despesa", valor: 3, descricao: "Pagamento fatura [PagFatura:1:2026-08:full]", status: "paga", data_vencimento: "2026-08-05", data_realizacao: "2026-08-05" },
    { id: 4, tipo: "despesa", valor: 5, descricao: "Anime (Fixa)", status: "paga", data_vencimento: "2026-08-10", data_realizacao: "2026-08-05" },
    { id: 5, tipo: "despesa", valor: 559.99, descricao: "Denylson  (1/5)", status: "paga", data_vencimento: "2026-08-10", data_realizacao: "2026-08-06" },
  ];
  const fakeClient = {
    from: () => ({
      select: () => ({
        or: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  };

  const extremes = await fetchMonthlyExtremeTransactions(fakeClient as never, "2026-08", true);
  assert(extremes !== null, "extremos deveriam ser calculados quando enabled=true");
  assert(extremes!.expense_min?.description === "Anime (Fixa)", "a menor despesa real deveria ignorar o aporte em objetivo de R$ 1,00");
  assert(extremes!.expense_min?.value === 5, "o valor da menor despesa real deveria ser R$ 5,00, nao o aporte de R$ 1,00");
  assert(extremes!.expense_max?.description === "Denylson  (1/5)", "a maior despesa real deveria continuar sendo identificada normalmente");
  assert(extremes!.expense_max?.value === 559.99, "o valor da maior despesa deveria ser R$ 559,99");
});
