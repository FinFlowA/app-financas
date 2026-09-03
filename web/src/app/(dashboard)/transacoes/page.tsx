import { mesAtualEmSaoPaulo, hojeEmSaoPaulo } from "@/lib/date";
import { collectPaymentSummaryRows } from "@/lib/payment-summaries";
import { createClient } from "@/lib/supabase/server";
import { shouldReturnHomeAfterCreation } from "@/lib/transaction-entry";
import type { Caixinha, Cartao, Categoria, Conta, FaturaItem } from "@/lib/types";
import TransactionManager from "./transaction-manager";
import type { QuickFilter, TransactionKind, TransactionRow } from "./transaction-model";

type SearchParameters = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function quickFilter(value: string): QuickFilter {
  return value === "attention" || value === "overdue" || value === "today" || value === "next7" ? value : null;
}

function positiveId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function transactionKind(value: string): TransactionKind {
  return value === "receita" || value === "transferencia" ? value : "despesa";
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = await searchParams;
  const today = hojeEmSaoPaulo();
  const requestedMonth = first(parameters.month);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : mesAtualEmSaoPaulo();
  const quick = quickFilter(first(parameters.quick));
  const openNew = ["1", "true", "yes"].includes(first(parameters.new).toLowerCase());
  const initialKind = transactionKind(first(parameters.kind));
  const initialFocusId = positiveId(first(parameters.focus));
  const returnHomeAfterCreate = shouldReturnHomeAfterCreation(first(parameters.source));
  const supabase = await createClient();

  const [{ data: authData, error: authError }, accountsResult, goalsResult, categoriesResult, cardsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("contas")
      .select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version")
      .order("arquivado")
      .order("nome"),
    supabase.from("caixinhas")
      .select("id,user_id,nome,meta_valor,saldo_atual,cor,icone,compartilhado,data_prazo,arquivado,version")
      .order("arquivado").order("nome"),
    supabase
      .from("categorias")
      .select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version")
      .order("nome"),
    supabase
      .from("cartoes")
      .select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo, version")
      .order("nome"),
  ]);
  if (authError || !authData.user) throw new Error("Sessão inválida.");
  if (accountsResult.error || goalsResult.error || categoriesResult.error || cardsResult.error) throw new Error("Não foi possível carregar contas, objetivos, categorias e cartões agora.");

  // O Histórico precisa atravessar meses nos filtros rápidos. Buscamos em
  // páginas para não perder itens no limite padrão de linhas do PostgREST.
  const transactions: TransactionRow[] = [];
  const pageSize = 1_000;
  for (let start = 0; ; start += pageSize) {
    const result = await supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, version, transacao_pai_id")
      .order("id", { ascending: false })
      .range(start, start + pageSize - 1);
    if (result.error) throw new Error("Não foi possível carregar o Histórico agora.");
    const rows = (result.data ?? []) as TransactionRow[];
    transactions.push(...rows);
    if (rows.length < pageSize) break;
  }

  // O Histórico de faturas também pode ultrapassar o limite padrão do
  // PostgREST. Mantemos a paginação no servidor e deixamos a RLS restringir
  // tanto cartões quanto itens ao usuário autenticado.
  const invoiceItems: FaturaItem[] = [];
  for (let start = 0; ; start += pageSize) {
    const result = await supabase
      .from("fatura_itens")
      .select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago, grupo_parcela_id")
      .order("id", { ascending: false })
      .range(start, start + pageSize - 1);
    if (result.error) throw new Error("Não foi possível carregar as faturas no Histórico agora.");
    const rows = (result.data ?? []) as FaturaItem[];
    invoiceItems.push(...rows);
    if (rows.length < pageSize) break;
  }

  const rootTransactions = transactions.filter((transaction) => transaction.transacao_pai_id === null);
  const summaryChunks: number[][] = [];
  for (let index = 0; index < rootTransactions.length; index += 500) {
    summaryChunks.push(rootTransactions.slice(index, index + 500).map((transaction) => transaction.id));
  }
  const summaryResults = await Promise.all(summaryChunks.map((ids) =>
    supabase.rpc("list_transaction_payment_summaries", { p_transaction_ids: ids })
  ));
  let paymentSummaries: unknown[];
  try {
    paymentSummaries = collectPaymentSummaryRows(summaryResults);
  } catch {
    throw new Error("Não foi possível carregar os resumos de pagamentos do Histórico agora.");
  }
  const reconciledResult = await supabase.rpc("list_bank_reconciled_transaction_ids");
  if (reconciledResult.error && reconciledResult.error.code !== "PGRST202") {
    throw new Error("Não foi possível carregar o estado de conciliação do Histórico agora.");
  }
  const reconciledTransactionIds = (reconciledResult.data ?? []).map((row: { transaction_id: number }) => Number(row.transaction_id));

  return (
    <div className="w-full">
      <TransactionManager
        userId={authData.user.id}
        initialMonth={month}
        initialQuick={quick}
        initialOpenNew={openNew}
        initialKind={initialKind}
        initialFocusId={initialFocusId}
        returnHomeAfterCreate={returnHomeAfterCreate}
        today={today}
        accounts={(accountsResult.data ?? []) as Conta[]}
        goals={(goalsResult.data ?? []) as Caixinha[]}
        categories={(categoriesResult.data ?? []) as Categoria[]}
        cards={(cardsResult.data ?? []) as Cartao[]}
        invoiceItems={invoiceItems}
        transactions={rootTransactions}
        financialEvents={transactions}
        paymentSummaryRows={paymentSummaries}
        reconciledTransactionIds={reconciledTransactionIds}
      />
    </div>
  );
}
