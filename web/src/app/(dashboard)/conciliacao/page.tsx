import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { descricaoVisivel, getContaDestinoTransferencia, isMovimentoObjetivo, isPagamentoFatura, isTransferencia } from "@/lib/transacoes";
import type { Categoria, Conta, Transacao } from "@/lib/types";
import ReconciliationWorkspace, { type ReconciliationCandidate } from "./reconciliation-workspace";

type SummaryRow = { root_transaction_id: number; remaining_value: number };
type FingerprintRow = { account_id: number; entry_fingerprint: string };
type TransferCounterpartRow = { transaction_id: number; account_id: number; entry_type: "receita" | "despesa"; description: string; due_date: string; amount: number };

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const [{ data: auth }, accountsResult, categoriesResult, transactionsResult, fingerprintsResult, counterpartsResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version").eq("arquivado", false).order("nome"),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version").order("nome"),
    fetchAllRows((from, to) => supabase.from("transacoes").select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status, transacao_pai_id, version").in("status", ["pendente", "paga"]).is("transacao_pai_id", null).order("data_vencimento", { ascending: false }).range(from, to)),
    supabase.rpc("list_bank_reconciliation_fingerprints"),
    supabase.rpc("list_pending_bank_transfer_counterparts"),
  ]);
  if (accountsResult.error || categoriesResult.error || transactionsResult.error) throw new Error("Não foi possível preparar a conciliação agora.");
  if (typeof auth?.claims.sub !== "string") throw new Error("Sua sessão expirou. Entre novamente.");
  const accounts = (accountsResult.data ?? []) as Conta[];
  const categories = ((categoriesResult.data ?? []) as Categoria[]).filter((category) => category.ativa === true || category.ativa === 1);
  const transactions = ((transactionsResult.data ?? []) as Transacao[]).filter((transaction) => (transaction.categoria_id !== null || isTransferencia(transaction.descricao))
    && !isMovimentoObjetivo(transaction.descricao) && !isPagamentoFatura(transaction.descricao));
  const ids = transactions.map((transaction) => transaction.id);
  const summariesResult = ids.length ? await supabase.rpc("list_transaction_payment_summaries", { p_transaction_ids: ids }) : { data: [], error: null };
  if (summariesResult.error) throw new Error("Não foi possível calcular os saldos pendentes.");
  const remainingById = new Map(((summariesResult.data ?? []) as SummaryRow[]).map((row) => [Number(row.root_transaction_id), Number(row.remaining_value)]));
  const candidates: ReconciliationCandidate[] = transactions.flatMap<ReconciliationCandidate>((transaction) => {
    const base = {
      id: transaction.id,
      categoryId: transaction.categoria_id,
      description: descricaoVisivel(transaction.descricao),
      dueDate: transaction.data_vencimento,
      remainingValue: transaction.status === "paga" ? Number(transaction.valor) : remainingById.get(transaction.id) ?? Number(transaction.valor),
      status: transaction.status === "paga" ? "paga" as const : "pendente" as const,
    };
    if (!isTransferencia(transaction.descricao)) return [{ ...base, accountId: transaction.conta_id, type: transaction.tipo, kind: "standard" as const }];
    const destinationId = getContaDestinoTransferencia(transaction.descricao);
    return [
      { ...base, accountId: transaction.conta_id, type: "despesa" as const, kind: "transfer" as const },
      ...(destinationId ? [{ ...base, accountId: destinationId, type: "receita" as const, kind: "transfer" as const }] : []),
    ];
  }).filter((candidate) => candidate.remainingValue > 0);
  if (!counterpartsResult.error) {
    for (const row of (counterpartsResult.data ?? []) as TransferCounterpartRow[]) candidates.push({
      id: Number(row.transaction_id), accountId: Number(row.account_id), categoryId: null,
      type: row.entry_type, description: descricaoVisivel(row.description), dueDate: row.due_date,
      remainingValue: Number(row.amount), kind: "transfer", status: "pendente",
    });
  }
  const fingerprints = fingerprintsResult.error?.code === "PGRST202" ? [] : (fingerprintsResult.data ?? []) as FingerprintRow[];

  return <ReconciliationWorkspace accounts={accounts} categories={categories} candidates={candidates} reconciledFingerprints={fingerprints.map((row) => `${row.account_id}:${row.entry_fingerprint}`)} />;
}
