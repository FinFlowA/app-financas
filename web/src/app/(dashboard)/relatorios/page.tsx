import { anoAtualEmSaoPaulo, hojeEmSaoPaulo } from "@/lib/date";
import { invoicePurchasesInMonth } from "@/lib/invoices";
import { calcularSaldoProjetadoPorMes } from "@/lib/saldo-projetado";
import { parseReportAccountSelection } from "@/lib/report-scope";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { calcularSaldosPorConta, dataEfetivaTransacao, descricaoVisivel, getOperacaoObjetivo, isMovimentoObjetivo, isPagamentoFatura, transacoesNoEscopo } from "@/lib/transacoes";
import type { Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import CategoryDistributionChart, { type CategoryDistributionItem } from "./category-distribution-chart";
import type { MesFluxo, PontoSaldo } from "./fluxo-saldo-chart";
import ReportOverview from "./report-overview";
import styles from "./relatorios.module.css";

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

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; accounts?: string | string[] }> }) {
  const params = await searchParams;
  const year = validYear(params.year);
  const today = hojeEmSaoPaulo();
  const currentYear = Number(today.slice(0, 4));
  const currentMonthIndex = Number(today.slice(5, 7)) - 1;
  const detailMonthIndex = validMonth(params.month, year === currentYear ? currentMonthIndex : 11);
  const detailMonth = `${year}-${String(detailMonthIndex + 1).padStart(2, "0")}`;
  const supabase = await createClient();
  const [transactionsResult, categoriesResult, accountsResult, invoiceItemsResult] = await Promise.all([
    fetchAllRows((from, to) => supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, transacao_pai_id, version")
      .order("id")
      .range(from, to)),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version"),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version").eq("arquivado", false).order("nome"),
    fetchAllRows((from, to) => supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .eq("mes_fatura", detailMonth)
      .order("id")
      .range(from, to)),
  ]);
  if (transactionsResult.error || categoriesResult.error || accountsResult.error || invoiceItemsResult.error) throw new Error("Não foi possível calcular seu fluxo agora.");
  const transactions = (transactionsResult.data ?? []) as Transacao[];
  const categories = (categoriesResult.data ?? []) as Categoria[];
  const accounts = (accountsResult.data ?? []) as Conta[];
  const selectedIds = parseReportAccountSelection(params.accounts, accounts.map((account) => account.id));
  const selectedSet = new Set(selectedIds);
  const selectedAccounts = accounts.filter((account) => selectedSet.has(account.id));
  const allAccountsSelected = selectedAccounts.length === accounts.length
    && accounts.every((account) => selectedSet.has(account.id));
  const scoped = transacoesNoEscopo(transactions, selectedSet, selectedAccounts.length);
  const initialBalance = selectedAccounts.reduce((sum, account) => sum + Number(account.saldo_inicial), 0);
  const balancesByAccount = calcularSaldosPorConta(selectedAccounts, transactions);
  const currentBalance = selectedAccounts.reduce(
    (sum, account) => sum + (balancesByAccount.get(account.id) ?? Number(account.saldo_inicial)),
    0,
  );
  const referenceDate = new Date(`${today}T12:00:00-03:00`);
  const projection = calcularSaldoProjetadoPorMes(initialBalance, scoped, year, referenceDate);
  const balances: PontoSaldo[] = projection.map((point) => ({ label: `${MONTHS[point.mesIdx]} ${year}`, saldo: point.saldo, projetado: point.projetado }));
  const months: MesFluxo[] = MONTHS.map((name) => ({
    label: `${name} ${year}`,
    receitas: 0,
    despesas: 0,
    receitasPrevistas: 0,
    despesasPrevistas: 0,
    guardadoObjetivos: 0,
    resgatadoObjetivos: 0,
    guardarObjetivosPrevisto: 0,
    resgatarObjetivosPrevisto: 0,
  }));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const expenseCategoryTotals = new Map<number | null, number>();
  const revenueCategoryTotals = new Map<number | null, number>();
  const expenseCategoryDetails = new Map<number | null, CategoryDistributionItem["details"]>();
  const revenueCategoryDetails = new Map<number | null, CategoryDistributionItem["details"]>();
  let detailExpense = 0;
  let detailRevenue = 0;

  for (const transaction of scoped) {
    const value = Number(transaction.valor);
    if (!Number.isFinite(value)) continue;
    const date = dataEfetivaTransacao(transaction);
    if (!date.startsWith(`${year}-`)) continue;
    const monthIndex = Number(date.slice(5, 7)) - 1;
    const month = months[monthIndex];
    if (!month) continue;
    if (isMovimentoObjetivo(transaction.descricao)) {
      const operation = getOperacaoObjetivo(transaction.descricao);
      if (operation === "guardar") {
        if (transaction.status === "paga") month.guardadoObjetivos = (month.guardadoObjetivos ?? 0) + value;
        else month.guardarObjetivosPrevisto = (month.guardarObjetivosPrevisto ?? 0) + value;
      } else if (operation === "resgatar") {
        if (transaction.status === "paga") month.resgatadoObjetivos = (month.resgatadoObjetivos ?? 0) + value;
        else month.resgatarObjetivosPrevisto = (month.resgatarObjetivosPrevisto ?? 0) + value;
      }
      continue;
    }
    const key = transaction.tipo === "receita" ? "receitas" : "despesas";
    const pendingKey = transaction.tipo === "receita" ? "receitasPrevistas" : "despesasPrevistas";
    if (transaction.status === "paga") month[key] += value;
    else month[pendingKey] = (month[pendingKey] ?? 0) + value;
    if (monthIndex === detailMonthIndex && transaction.status === "paga") {
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
  const overviewMonth = months[overviewMonthIndex];
  const totalReceitas = overviewMonth?.receitas ?? 0;
  const totalDespesas = overviewMonth?.despesas ?? 0;
  const resultadoRealizado = totalReceitas - totalDespesas;
  const saldoFimMes = balances[overviewMonthIndex]?.saldo ?? initialBalance;
  const revenueDistribution = distributionItems(revenueCategoryTotals, revenueCategoryDetails, detailRevenue, "receita");
  const expenseDistribution = distributionItems(expenseCategoryTotals, expenseCategoryDetails, detailExpense, "despesa");

  return (
    <div className={styles.page}>
      <ReportOverview
        year={year}
        currentYear={currentYear}
        currentMonthIndex={currentMonthIndex}
        selectedMonthIndex={detailMonthIndex}
        currentBalance={currentBalance}
        initialBalance={initialBalance}
        months={months}
        balances={balances}
        metrics={[
          { label: "Receitas realizadas no mês", value: totalReceitas, tone: "positive" },
          { label: "Despesas realizadas no mês", value: totalDespesas, tone: "negative" },
          { label: "Balanço realizado do mês", value: resultadoRealizado, tone: resultadoRealizado < 0 ? "negative" : "positive" },
          { label: "Saldo previsto no fim do mês", value: saldoFimMes, tone: saldoFimMes < 0 ? "negative" : "positive" },
        ]}
        selectedAccountIds={selectedIds}
        accounts={accounts.map((account) => ({ id: account.id, name: account.nome, color: account.cor }))}
      />

      <div className={styles.analysisGrid}>
        <section className={styles.distributionPanel}>
          <h2 className={styles.sectionTitle}>Receitas por categoria</h2>
          <p className={styles.chartSubtitle}>Distribuição das receitas realizadas em {MONTHS[detailMonthIndex].toLocaleLowerCase("pt-BR")}.</p>
          <CategoryDistributionChart items={revenueDistribution} total={detailRevenue} kind="receitas" />
        </section>
        <section className={styles.rankingPanel}>
          <h2 className={styles.sectionTitle}>Despesas por categoria</h2>
          <p className={styles.chartSubtitle}>Distribuição das despesas realizadas em {MONTHS[detailMonthIndex].toLocaleLowerCase("pt-BR")}.</p>
          <CategoryDistributionChart items={expenseDistribution} total={detailExpense} kind="despesas" />
        </section>
      </div>
    </div>
  );
}
