import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/format";
import type { Conta, Transacao } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: contasData }, { data: transacoesData }] = await Promise.all([
    supabase
      .from("contas")
      .select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado")
      .eq("arquivado", false)
      .order("id"),
    supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status")
      .eq("status", "paga"),
  ]);

  const contas = (contasData ?? []) as Conta[];
  const transacoesPagas = (transacoesData ?? []) as Transacao[];

  const saldoPorConta = new Map<number, number>();
  for (const conta of contas) saldoPorConta.set(conta.id, Number(conta.saldo_inicial));
  for (const transacao of transacoesPagas) {
    const atual = saldoPorConta.get(transacao.conta_id);
    if (atual === undefined) continue;
    const delta = transacao.tipo === "receita" ? Number(transacao.valor) : -Number(transacao.valor);
    saldoPorConta.set(transacao.conta_id, atual + delta);
  }
  const saldoGeral = [...saldoPorConta.values()].reduce((soma, valor) => soma + valor, 0);

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const transacoesDoMes = transacoesPagas.filter((t) =>
    (t.data_realizacao ?? t.data_vencimento).startsWith(mesAtual));
  const entradasDoMes = transacoesDoMes
    .filter((t) => t.tipo === "receita")
    .reduce((soma, t) => soma + Number(t.valor), 0);
  const saidasDoMes = transacoesDoMes
    .filter((t) => t.tipo === "despesa")
    .reduce((soma, t) => soma + Number(t.valor), 0);

  return (
    <div className="max-w-4xl">
      <p className="text-sm font-semibold text-foreground-muted">Saldo geral</p>
      <p className="mt-1 text-4xl font-extrabold text-foreground">{formatarReais(saldoGeral)}</p>

      <div className="mt-5 flex gap-8 rounded-ff-lg border border-border bg-surface p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Entradas do mês</p>
          <p className="text-lg font-bold text-primary">{formatarReais(entradasDoMes)}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Saídas do mês</p>
          <p className="text-lg font-bold text-red">{formatarReais(saidasDoMes)}</p>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-bold text-foreground">Contas</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {contas.map((conta) => (
          <div key={conta.id} className="rounded-ff-md p-4 text-white shadow-sm" style={{ backgroundColor: conta.cor }}>
            <p className="text-sm font-semibold opacity-90">{conta.nome}</p>
            <p className="text-xl font-extrabold">{formatarReais(saldoPorConta.get(conta.id) ?? 0)}</p>
          </div>
        ))}
        {contas.length === 0 && (
          <p className="text-sm text-foreground-muted">Nenhuma conta cadastrada ainda.</p>
        )}
      </div>
    </div>
  );
}
