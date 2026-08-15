import { anoAtualEmSaoPaulo, hojeEmSaoPaulo } from "@/lib/date";
import { formatarReais } from "@/lib/format";
import { invoicePurchasesInMonth } from "@/lib/invoices";
import { calcularSaldoProjetadoPorMes } from "@/lib/saldo-projetado";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { dataEfetivaTransacao, isMovimentoObjetivo, isPagamentoFatura, transacoesNoEscopo } from "@/lib/transacoes";
import type { Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import FluxoSaldoChart, { type MesFluxo, type PontoSaldo } from "./fluxo-saldo-chart";
import ReportFilters from "./report-filters";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function validYear(value: string | undefined) {
  const current = anoAtualEmSaoPaulo();
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= current - 10 && parsed <= current + 10 ? parsed : current;
}

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ year?: string; accounts?: string }> }) {
  const params = await searchParams;
  const year = validYear(params.year);
  const today = hojeEmSaoPaulo();
  const currentYear = Number(today.slice(0, 4));
  const currentMonthIndex = Number(today.slice(5, 7)) - 1;
  const detailMonthIndex = year === currentYear ? currentMonthIndex : 11;
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
      .gte("data_compra", `${detailMonth}-01`)
      .lt("data_compra", detailMonthIndex === 11
        ? `${year + 1}-01-01`
        : `${year}-${String(detailMonthIndex + 2).padStart(2, "0")}-01`)
      .order("id")
      .range(from, to)),
  ]);
  if (transactionsResult.error || categoriesResult.error || accountsResult.error || invoiceItemsResult.error) throw new Error("Não foi possível calcular seu fluxo agora.");
  const transactions = (transactionsResult.data ?? []) as Transacao[];
  const categories = (categoriesResult.data ?? []) as Categoria[];
  const accounts = (accountsResult.data ?? []) as Conta[];
  const availableIds = new Set(accounts.map((account) => account.id));
  const requestedIds = (params.accounts ?? "").split(",").map(Number).filter((id) => availableIds.has(id));
  const selectedIds = requestedIds.length ? [...new Set(requestedIds)] : accounts.map((account) => account.id);
  const selectedSet = new Set(selectedIds);
  const selectedAccounts = accounts.filter((account) => selectedSet.has(account.id));
  const allAccountsSelected = selectedAccounts.length === accounts.length
    && accounts.every((account) => selectedSet.has(account.id));
  const scoped = transacoesNoEscopo(transactions, selectedSet, selectedAccounts.length);
  const initialBalance = selectedAccounts.reduce((sum, account) => sum + Number(account.saldo_inicial), 0);
  const referenceDate = new Date(`${today}T12:00:00-03:00`);
  const projection = calcularSaldoProjetadoPorMes(initialBalance, scoped, year, referenceDate);
  const balances: PontoSaldo[] = projection.map((point) => ({ label: `${MONTHS[point.mesIdx]} ${year}`, saldo: point.saldo, projetado: point.projetado }));
  const months: MesFluxo[] = MONTHS.map((name) => ({ label: `${name} ${year}`, receitas: 0, despesas: 0, receitasPrevistas: 0, despesasPrevistas: 0 }));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const categoryTotals = new Map<number | null, number>();
  let detailExpense = 0;

  for (const transaction of scoped) {
    if (isMovimentoObjetivo(transaction.descricao)) continue;
    const date = dataEfetivaTransacao(transaction);
    if (!date.startsWith(`${year}-`)) continue;
    const monthIndex = Number(date.slice(5, 7)) - 1;
    const month = months[monthIndex];
    if (!month) continue;
    const value = Number(transaction.valor);
    if (!Number.isFinite(value)) continue;
    const key = transaction.tipo === "receita" ? "receitas" : "despesas";
    const pendingKey = transaction.tipo === "receita" ? "receitasPrevistas" : "despesasPrevistas";
    if (transaction.status === "paga") month[key] += value;
    else month[pendingKey] = (month[pendingKey] ?? 0) + value;
    if (monthIndex === detailMonthIndex && transaction.tipo === "despesa" && transaction.status === "paga"
      && !(allAccountsSelected && isPagamentoFatura(transaction.descricao))) {
      detailExpense += value;
      categoryTotals.set(transaction.categoria_id, (categoryTotals.get(transaction.categoria_id) ?? 0) + value);
    }
  }
  if (allAccountsSelected) {
    for (const item of invoicePurchasesInMonth((invoiceItemsResult.data ?? []) as FaturaItem[], detailMonth)) {
      const value = Number(item.valor);
      if (!Number.isFinite(value)) continue;
      detailExpense += value;
      categoryTotals.set(item.categoria_id, (categoryTotals.get(item.categoria_id) ?? 0) + value);
    }
  }
  const distribution = [...categoryTotals.entries()].map(([categoryId, value]) => ({ category: categoryId === null ? undefined : categoriesById.get(categoryId), value, percentage: detailExpense ? value / detailExpense * 100 : 0 })).sort((a, b) => b.value - a.value);
  const displayedBalanceIndex = year === currentYear ? currentMonthIndex : 11;

  return <div className="mx-auto max-w-6xl">
    <section className="mb-5 rounded-ff-lg bg-gradient-to-br from-primary-dark to-primary p-5 text-white sm:p-6"><p className="text-sm font-bold text-white/70">Saldo acumulado {balances[displayedBalanceIndex]?.projetado ? "previsto" : "realizado"}</p><p data-private-value="true" className="mt-1 text-3xl font-black">{formatarReais(balances[displayedBalanceIndex]?.saldo ?? initialBalance)}</p><h1 className="mt-4 text-xl font-extrabold">Fluxo de caixa</h1><p className="text-sm text-white/70">Realizado e previsto no mesmo gráfico, sem transformar objetivos em despesas.</p></section>
    <ReportFilters year={year} selected={selectedIds} accounts={accounts.map((account) => ({ id: account.id, name: account.nome, color: account.cor }))} />
    <FluxoSaldoChart meses={months} saldos={balances} />
    <section className="ff-card mt-6 p-5"><h2 className="font-extrabold">Despesas por categoria — {MONTHS[detailMonthIndex]}</h2><div className="mt-4 grid gap-3">{distribution.map((item, index) => <div key={item.category?.id ?? `none-${index}`}><div className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.category?.cor ?? "#6C7D77" }} />{item.category?.nome ?? "Sem categoria"}</span><span data-private-value="true" className="text-foreground-muted">{formatarReais(item.value)} · {item.percentage.toFixed(0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${item.percentage}%`, background: item.category?.cor ?? "#6C7D77" }} /></div></div>)}{!distribution.length && <p className="text-sm text-foreground-muted">Nenhuma despesa realizada neste mês.</p>}</div></section>
  </div>;
}
