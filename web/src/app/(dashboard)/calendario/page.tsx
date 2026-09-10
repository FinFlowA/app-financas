import { redirect } from "next/navigation";
import { hojeEmSaoPaulo } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { collectPaymentSummaryRows } from "@/lib/payment-summaries";
import type { Caixinha, Cartao, Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import CalendarManager from "./calendar-manager";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [accountsResult, goalsResult, categoriesResult, transactionsResult, cardsResult, invoiceItemsResult] = await Promise.all([
    supabase.from("contas").select("id,user_id,nome,cor,saldo_inicial,arquivado,compartilhado,version").order("nome"),
    supabase.from("caixinhas").select("id,user_id,nome,meta_valor,saldo_atual,cor,icone,compartilhado,data_prazo,arquivado,version").order("nome"),
    supabase.from("categorias").select("id,user_id,nome,cor,icone,tipo,ativa,bloqueado_plano,version").order("nome"),
    fetchAllRows((from, to) => supabase.from("transacoes")
      .select("id,user_id,conta_id,categoria_id,tipo,valor,descricao,data_vencimento,data_realizacao,status,transacao_pai_id,version")
      .is("transacao_pai_id", null).order("data_vencimento").range(from, to)),
    supabase.from("cartoes").select("id,user_id,nome,cor,limite,dia_vencimento,dia_fechamento,ativo,version").order("nome"),
    fetchAllRows((from, to) => supabase.from("fatura_itens").select("id,cartao_id,user_id,descricao,valor,data_compra,mes_fatura,parcela_atual,total_parcelas,categoria_id,pago,grupo_parcela_id").order("id", { ascending: false }).range(from, to)),
  ]);
  if (accountsResult.error || goalsResult.error || categoriesResult.error || transactionsResult.error || cardsResult.error || invoiceItemsResult.error) throw new Error("Não foi possível carregar o calendário agora.");
  const transactions = (transactionsResult.data ?? []) as Transacao[];
  const summaryResults = await Promise.all(Array.from({ length: Math.ceil(transactions.length / 500) }, (_, index) =>
    supabase.rpc("list_transaction_payment_summaries", { p_transaction_ids: transactions.slice(index * 500, (index + 1) * 500).map((transaction) => transaction.id) })));
  const reconciledResult = await supabase.rpc("list_bank_reconciled_transaction_ids");
  if (summaryResults.some((result) => result.error) || (reconciledResult.error && reconciledResult.error.code !== "PGRST202")) throw new Error("Não foi possível carregar os detalhes dos agendamentos agora.");
  return <CalendarManager userId={user.id} today={hojeEmSaoPaulo()} accounts={(accountsResult.data ?? []) as Conta[]} goals={(goalsResult.data ?? []) as Caixinha[]} categories={(categoriesResult.data ?? []) as Categoria[]} cards={(cardsResult.data ?? []) as Cartao[]} invoiceItems={(invoiceItemsResult.data ?? []) as FaturaItem[]} transactions={transactions} paymentSummaryRows={collectPaymentSummaryRows(summaryResults)} reconciledTransactionIds={(reconciledResult.data ?? []).map((row: { transaction_id: number }) => Number(row.transaction_id))} />;
}
