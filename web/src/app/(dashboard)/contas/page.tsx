import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { calcularSaldosPorConta } from "@/lib/transacoes";
import type { Conta, Transacao } from "@/lib/types";
import AccountManager from "./account-manager";

export default async function ContasPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Sessão inválida.");
  const [contasResult, transacoesResult, partnershipResult] = await Promise.all([
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado, version").order("arquivado").order("nome"),
    fetchAllRows((from, to) => supabase.from("transacoes")
      .select("id, conta_id, tipo, valor, descricao, status, data_vencimento, data_realizacao")
      .order("id")
      .range(from, to)),
    supabase.from("parcerias")
      .select("id, solicitante_id, convidado_id")
      .eq("status", "aceito")
      .limit(1)
      .maybeSingle(),
  ]);
  if (contasResult.error || transacoesResult.error) throw new Error("Não foi possível carregar suas contas agora.");
  const partnership = partnershipResult.error ? null : partnershipResult.data;
  const partnerId = partnership
    ? partnership.solicitante_id === authData.user.id
      ? partnership.convidado_id
      : partnership.solicitante_id
    : null;
  const partnerNameResult = partnerId
    ? await supabase.rpc("get_user_name", { user_id: partnerId })
    : null;
  const partnerName = typeof partnerNameResult?.data === "string"
    ? partnerNameResult.data
    : partnerId ? "seu parceiro" : null;
  const accounts = (contasResult.data ?? []) as Conta[];
  const transactions = (transacoesResult.data ?? []) as Transacao[];
  const balances = Object.fromEntries(calcularSaldosPorConta(accounts, transactions));
  return <div className="max-w-6xl"><div className="mb-6"><p className="text-sm font-bold uppercase tracking-wide text-primary">Organização</p><h1 className="text-3xl font-extrabold text-foreground">Contas</h1><p className="mt-1 text-sm text-foreground-muted">Crie, edite, compartilhe, arquive e acompanhe o saldo real de cada conta.</p></div><AccountManager accounts={accounts} balances={balances} userId={authData.user.id} partnerName={partnerName} /></div>;
}
