import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { calcularSaldosPorConta } from "@/lib/transacoes";
import { formatarReais } from "@/lib/format";
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
  const activeAccounts = accounts.filter((account) => !account.arquivado);
  const totalBalance = activeAccounts.reduce((total, account) => total + (balances[account.id] ?? Number(account.saldo_inicial)), 0);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="ff-page-hero mb-6 px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div aria-hidden="true" className="absolute -right-6 -top-20 h-52 w-52 rounded-full border border-white/10" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Central financeira</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Suas contas</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">Crie, edite, compartilhe, arquive e acompanhe o saldo real de cada conta em um só lugar.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-72">
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Contas ativas</p>
              <p className="mt-1 text-xl font-black">{activeAccounts.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Saldo somado</p>
              <p data-private-value="true" className="mt-1 truncate text-lg font-black">{formatarReais(totalBalance)}</p>
            </div>
          </div>
        </div>
      </header>
      <AccountManager accounts={accounts} balances={balances} userId={authData.user.id} partnerName={partnerName} />
    </div>
  );
}
