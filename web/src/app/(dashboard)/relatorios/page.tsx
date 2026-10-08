import { anoAtualEmSaoPaulo, hojeEmSaoPaulo } from "@/lib/date";
import { dataNoFluxo, lancamentosDoFluxo } from "@/lib/fluxo-atrasados";
import { transferenciasEntreContas } from "@/lib/fluxo-transferencias";
import { invoicePurchasesInMonth } from "@/lib/invoices";
import { calcularSaldoProjetadoPorDia, calcularSaldoProjetadoPorMes } from "@/lib/saldo-projetado";
import { parseReportAccountSelection } from "@/lib/report-scope";
import { createClient } from "@/lib/supabase/server";
import { filtroTransacoesDoUsuario } from "@/lib/supabase/transacoes-visiveis";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { calcularSaldosPorConta, dataEfetivaTransacao, descricaoVisivel, getOperacaoObjetivo, isMovimentoObjetivo, isPagamentoFatura, transacoesNoEscopo } from "@/lib/transacoes";
import type { Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import CategoryDistributionChart, { type CategoryDistributionItem } from "./category-distribution-chart";
import type { MesFluxo, PontoSaldo } from "./fluxo-saldo-chart";
import ReportOverview, { type SeriesDoFluxo } from "./report-overview";
import styles from "./relatorios.module.css";
import { normalizePlan, planHasFeature } from "@/lib/plan-entitlements";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function validYear(value: string | undefined) {
  const current = anoAtualEmSaoPaulo();
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= current - 10 && parsed <= current + 10 ? parsed : current;
}

function validMonth(value: string | undefined, fallbackIndex: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed - 1 : fallbackIndex;
}

function fluxoVazio(label: string): MesFluxo {
  return {
    label,
    receitas: 0,
    despesas: 0,
    receitasPrevistas: 0,
    despesasPrevistas: 0,
    guardadoObjetivos: 0,
    resgatadoObjetivos: 0,
    guardarObjetivosPrevisto: 0,
    resgatarObjetivosPrevisto: 0,
    transferencias: 0,
    transferenciasPrevistas: 0,
  };
}

/**
 * Meses, dias e saldos do gráfico a partir de uma lista de lançamentos.
 * `transferencias` (entre as contas escolhidas) só entram nas informações do
 * mês e do dia: não mudam o saldo nem viram barra no gráfico.
 */
function montarSeriesDoFluxo(
  lancamentos: Transacao[],
  transferencias: Transacao[],
  { year, detailMonthIndex, initialBalance, referenceDate, today }: { year: number; detailMonthIndex: number; initialBalance: number; referenceDate: Date; today: string },
) {
  const months = MONTHS.map((name) => fluxoVazio(`${name} ${year}`));
  const daysInDetailMonth = new Date(year, detailMonthIndex + 1, 0).getDate();
  const dailyFlow = Array.from({ length: daysInDetailMonth }, (_, index) => fluxoVazio(`${String(index + 1).padStart(2, "0")} de ${MONTHS[detailMonthIndex]}`));
  for (const transaction of lancamentos) {
    const value = Number(transaction.valor);
    if (!Number.isFinite(value)) continue;
    const date = dataNoFluxo(transaction, dataEfetivaTransacao(transaction), today);
    if (!date.startsWith(`${year}-`)) continue;
    const monthIndex = Number(date.slice(5, 7)) - 1;
    const month = months[monthIndex];
    if (!month) continue;
    const daily = monthIndex === detailMonthIndex ? dailyFlow[Number(date.slice(8, 10)) - 1] : undefined;
    if (isMovimentoObjetivo(transaction.descricao)) {
      const operation = getOperacaoObjetivo(transaction.descricao);
      if (operation === "guardar") {
        if (transaction.status === "paga") month.guardadoObjetivos = (month.guardadoObjetivos ?? 0) + value;
        else month.guardarObjetivosPrevisto = (month.guardarObjetivosPrevisto ?? 0) + value;
        if (daily) {
          if (transaction.status === "paga") daily.guardadoObjetivos = (daily.guardadoObjetivos ?? 0) + value;
          else daily.guardarObjetivosPrevisto = (daily.guardarObjetivosPrevisto ?? 0) + value;
        }
      } else if (operation === "resgatar") {
        if (transaction.status === "paga") month.resgatadoObjetivos = (month.resgatadoObjetivos ?? 0) + value;
        else month.resgatarObjetivosPrevisto = (month.resgatarObjetivosPrevisto ?? 0) + value;
        if (daily) {
          if (transaction.status === "paga") daily.resgatadoObjetivos = (daily.resgatadoObjetivos ?? 0) + value;
          else daily.resgatarObjetivosPrevisto = (daily.resgatarObjetivosPrevisto ?? 0) + value;
        }
      }
      continue;
    }
    const key = transaction.tipo === "receita" ? "receitas" : "despesas";
    const pendingKey = transaction.tipo === "receita" ? "receitasPrevistas" : "despesasPrevistas";
    if (transaction.status === "paga") month[key] += value;
    else month[pendingKey] = (month[pendingKey] ?? 0) + value;
    if (daily) {
      if (transaction.status === "paga") daily[key] += value;
      else daily[pendingKey] = (daily[pendingKey] ?? 0) + value;
    }
  }
  for (const transfer of transferencias) {
    const value = Number(transfer.valor);
    const date = dataNoFluxo(transfer, dataEfetivaTransacao(transfer), today);
    if (!Number.isFinite(value) || !date.startsWith(`${year}-`)) continue;
    const monthIndex = Number(date.slice(5, 7)) - 1;
    const key = transfer.status === "paga" ? "transferencias" : "transferenciasPrevistas";
    const month = months[monthIndex];
    if (month) month[key] = (month[key] ?? 0) + value;
    const daily = monthIndex === detailMonthIndex ? dailyFlow[Number(date.slice(8, 10)) - 1] : undefined;
    if (daily) daily[key] = (daily[key] ?? 0) + value;
  }
  const balances: PontoSaldo[] = calcularSaldoProjetadoPorMes(initialBalance, lancamentos, year, referenceDate)
    .map((point) => ({ label: `${MONTHS[point.mesIdx]} ${year}`, saldo: point.saldo, projetado: point.projetado }));
  const dailyBalances: PontoSaldo[] = calcularSaldoProjetadoPorDia(initialBalance, lancamentos, year, detailMonthIndex, referenceDate)
    .map((point) => ({ label: `${String(point.dia).padStart(2, "0")} de ${MONTHS[detailMonthIndex]}`, saldo: point.saldo, projetado: point.projetado }));
  return { months, dailyFlow, balances, dailyBalances };
}

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; accounts?: string | string[]; view?: string; atrasados?: string }> }) {
  const params = await searchParams;
  const year = validYear(params.year);
  const today = hojeEmSaoPaulo();
  const currentYear = Number(today.slice(0, 4));
  const currentMonthIndex = Number(today.slice(5, 7)) - 1;
  const detailMonthIndex = validMonth(params.month, year === currentYear ? currentMonthIndex : 11);
  const detailMonth = `${year}-${String(detailMonthIndex + 1).padStart(2, "0")}`;
  const supabase = await createClient();
  // Filtro explícito das transações visíveis: o banco usa os índices em vez
  // de ler a tabela inteira (ver lib/transacoes-visiveis.ts).
  const filtroVisiveis = filtroTransacoesDoUsuario(supabase);
  // Se a página sair antes de usar o filtro (sessão inválida), a falha dele
  // não vira erro solto no servidor; quem usa o filtro continua recebendo o erro.
  filtroVisiveis.catch(() => undefined);
  const [transactionsResult, categoriesResult, accountsResult, invoiceItemsResult, entitlementResult] = await Promise.all([
    filtroVisiveis.then((filtro) => fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, transacao_pai_id, version")
      .or(filtro)
      .order("id")
      .range(from, to))),
    fetchAllRows((from, to) => supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version").range(from, to)),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version").eq("arquivado", false).order("nome"),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .eq("mes_fatura", detailMonth)
      .order("id")
      .range(from, to)),
    supabase.rpc("get_my_entitlement"),
  ]);
  const entitlementRaw = Array.isArray(entitlementResult.data) ? entitlementResult.data[0] : entitlementResult.data;
  const entitlement = entitlementRaw && typeof entitlementRaw === "object" ? entitlementRaw as Record<string, unknown> : {};
  const dailyEnabled = planHasFeature(normalizePlan(entitlement.plan), "daily_cash_flow", entitlement.limits_enabled === true);
  const categoryDetailsEnabled = planHasFeature(normalizePlan(entitlement.plan), "full_category_reports", entitlement.limits_enabled === true);
  const view = params.view === "daily" && dailyEnabled ? "daily" : "monthly";
  if (transactionsResult.error || categoriesResult.error || accountsResult.error || invoiceItemsResult.error) throw new Error("Não foi possível calcular seu fluxo agora.");
  const transactions = (transactionsResult.data ?? []) as Transacao[];
  const categories = (categoriesResult.data ?? []) as Categoria[];
  const accounts = (accountsResult.data ?? []) as Conta[];
  const selectedIds = parseReportAccountSelection(params.accounts, accounts.map((account) => account.id));
  const selectedSet = new Set(selectedIds);
  const selectedAccounts = accounts.filter((account) => selectedSet.has(account.id));
  const allAccountsSelected = selectedAccounts.length === accounts.length
    && accounts.every((account) => selectedSet.has(account.id));
  // Filtro "Considerar atrasados": ligado por padrão; com atrasados=0, os
  // lançamentos pendentes já vencidos saem do cálculo do fluxo. O servidor
  // monta as duas versões para a troca na tela ser instantânea.
  const considerarAtrasados = params.atrasados !== "0";
  const scoped = transacoesNoEscopo(transactions, selectedSet, selectedAccounts.length);
  const initialBalance = selectedAccounts.reduce((sum, account) => sum + Number(account.saldo_inicial), 0);
  const balancesByAccount = calcularSaldosPorConta(selectedAccounts, transactions);
  const currentBalance = selectedAccounts.reduce(
    (sum, account) => sum + (balancesByAccount.get(account.id) ?? Number(account.saldo_inicial)),
    0,
  );
  const referenceDate = new Date(`${today}T12:00:00-03:00`);
  const opcoesDasSeries = { year, detailMonthIndex, initialBalance, referenceDate, today };
  const internas = transferenciasEntreContas(transactions, selectedSet);
  const seriesComAtrasados = montarSeriesDoFluxo(lancamentosDoFluxo(scoped, true, today), lancamentosDoFluxo(internas, true, today), opcoesDasSeries);
  const seriesSemAtrasados = montarSeriesDoFluxo(lancamentosDoFluxo(scoped, false, today), lancamentosDoFluxo(internas, false, today), opcoesDasSeries);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const expenseCategoryTotals = new Map<number | null, number>();
  const revenueCategoryTotals = new Map<number | null, number>();
  const expenseCategoryDetails = new Map<number | null, CategoryDistributionItem["details"]>();
  const revenueCategoryDetails = new Map<number | null, CategoryDistributionItem["details"]>();
  let detailExpense = 0;
  let detailRevenue = 0;

  // Distribuição por categoria: só o que já foi concluído no mês detalhado.
  // Atrasados são pendentes, então o filtro não muda esta parte.
  for (const transaction of scoped) {
    const value = Number(transaction.valor);
    if (!Number.isFinite(value) || transaction.status !== "paga" || isMovimentoObjetivo(transaction.descricao)) continue;
    const date = dataEfetivaTransacao(transaction);
    if (!date.startsWith(detailMonth)) continue;
    if (transaction.tipo === "receita") {
      detailRevenue += value;
      revenueCategoryTotals.set(transaction.categoria_id, (revenueCategoryTotals.get(transaction.categoria_id) ?? 0) + value);
      revenueCategoryDetails.set(transaction.categoria_id, [...(revenueCategoryDetails.get(transaction.categoria_id) ?? []), { id: `transaction-${transaction.id}`, description: descricaoVisivel(transaction.descricao), value, date: date.slice(0, 10) }]);
    } else if (!(allAccountsSelected && isPagamentoFatura(transaction.descricao))) {
      detailExpense += value;
      expenseCategoryTotals.set(transaction.categoria_id, (expenseCategoryTotals.get(transaction.categoria_id) ?? 0) + value);
      expenseCategoryDetails.set(transaction.categoria_id, [...(expenseCategoryDetails.get(transaction.categoria_id) ?? []), { id: `transaction-${transaction.id}`, description: descricaoVisivel(transaction.descricao), value, date: date.slice(0, 10) }]);
    }
  }
  if (allAccountsSelected) {
    for (const item of invoicePurchasesInMonth((invoiceItemsResult.data ?? []) as FaturaItem[], detailMonth)) {
      const value = Number(item.valor);
      if (!Number.isFinite(value)) continue;
      detailExpense += value;
      expenseCategoryTotals.set(item.categoria_id, (expenseCategoryTotals.get(item.categoria_id) ?? 0) + value);
      expenseCategoryDetails.set(item.categoria_id, [...(expenseCategoryDetails.get(item.categoria_id) ?? []), { id: `invoice-${item.id}`, description: descricaoVisivel(item.descricao), value, date: item.data_compra }]);
    }
  }
  const distributionItems = (totals: Map<number | null, number>, details: Map<number | null, CategoryDistributionItem["details"]>, total: number, kind: "receita" | "despesa"): CategoryDistributionItem[] => (
    [...totals.entries()]
      .map(([categoryId, value], index) => {
        const category = categoryId === null ? undefined : categoriesById.get(categoryId);
        return {
          id: category ? String(category.id) : `${kind}-none-${index}`,
          name: category?.nome ?? "Sem categoria",
          color: category?.cor ?? (kind === "receita" ? "#42C98B" : "#FF746C"),
          value,
          percentage: total ? value / total * 100 : 0,
          details: details.get(categoryId) ?? [],
        };
      })
      .sort((a, b) => b.value - a.value)
  );
  const overviewMonthIndex = year === currentYear ? currentMonthIndex : detailMonthIndex;
  const revenueDistribution = distributionItems(revenueCategoryTotals, revenueCategoryDetails, detailRevenue, "receita");
  const expenseDistribution = distributionItems(expenseCategoryTotals, expenseCategoryDetails, detailExpense, "despesa");
  const comMetricas = (series: ReturnType<typeof montarSeriesDoFluxo>): SeriesDoFluxo => {
    const overviewMonth = series.months[overviewMonthIndex];
    const totalReceitas = overviewMonth?.receitas ?? 0;
    const totalDespesas = overviewMonth?.despesas ?? 0;
    const resultadoRealizado = totalReceitas - totalDespesas;
    const saldoFimMes = series.balances[overviewMonthIndex]?.saldo ?? initialBalance;
    return {
      ...series,
      metrics: [
        // Entradas e saídas de dinheiro das contas: a fatura do cartão entra quando
        // é paga. Por isso não se chamam receitas e despesas (no Início e no
        // Relatório, a compra do cartão conta no mês da fatura).
        { label: "Entradas de dinheiro no mês", value: totalReceitas, tone: "positive" },
        { label: "Saídas de dinheiro no mês", value: totalDespesas, tone: "negative" },
        { label: "Entradas menos saídas no mês", value: resultadoRealizado, tone: resultadoRealizado < 0 ? "negative" : "positive" },
        { label: "Saldo previsto no fim do mês", value: saldoFimMes, tone: saldoFimMes < 0 ? "negative" : "positive" },
      ],
    };
  };

  return (
    <div className={styles.page}>
      <ReportOverview
        year={year}
        currentYear={currentYear}
        currentMonthIndex={currentMonthIndex}
        selectedMonthIndex={detailMonthIndex}
        currentBalance={currentBalance}
        initialBalance={initialBalance}
        series={{ comAtrasados: comMetricas(seriesComAtrasados), semAtrasados: comMetricas(seriesSemAtrasados) }}
        selectedAccountIds={selectedIds}
        accounts={accounts.map((account) => ({ id: account.id, name: account.nome, color: account.cor }))}
        view={view}
        dailyEnabled={dailyEnabled}
        considerarAtrasados={considerarAtrasados}
      />

      <div className={styles.analysisGrid}>
        <section className={styles.distributionPanel}>
          <h2 className={styles.sectionTitle}>Receitas por categoria</h2>
          <p className={styles.chartSubtitle}>Distribuição das receitas realizadas em {MONTHS[detailMonthIndex].toLocaleLowerCase("pt-BR")}.</p>
          <CategoryDistributionChart items={revenueDistribution} total={detailRevenue} kind="receitas" detailsEnabled={categoryDetailsEnabled} />
        </section>
        <section className={styles.rankingPanel}>
          <h2 className={styles.sectionTitle}>Despesas por categoria</h2>
          <p className={styles.chartSubtitle}>Distribuição das despesas realizadas em {MONTHS[detailMonthIndex].toLocaleLowerCase("pt-BR")}.</p>
          <CategoryDistributionChart items={expenseDistribution} total={detailExpense} kind="despesas" detailsEnabled={categoryDetailsEnabled} />
        </section>
      </div>
    </div>
  );
}
