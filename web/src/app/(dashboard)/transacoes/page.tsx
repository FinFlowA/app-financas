import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/format";
import type { Categoria, Conta, Transacao } from "@/lib/types";

export default async function TransacoesPage() {
  const supabase = await createClient();

  const [{ data: transacoesData }, { data: contasData }, { data: categoriasData }] = await Promise.all([
    supabase
      .from("transacoes")
      .select("id, user_id, conta_id, categoria_id, tipo, valor, descricao, data_vencimento, data_realizacao, status")
      .order("data_vencimento", { ascending: false })
      .limit(100),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado"),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa"),
  ]);

  const transacoes = (transacoesData ?? []) as Transacao[];
  const contasPorId = new Map(((contasData ?? []) as Conta[]).map((conta) => [conta.id, conta]));
  const categoriasPorId = new Map(((categoriasData ?? []) as Categoria[]).map((categoria) => [categoria.id, categoria]));

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-extrabold text-foreground">Histórico</h1>

      <div className="flex flex-col gap-2">
        {transacoes.map((transacao) => {
          const conta = contasPorId.get(transacao.conta_id);
          const categoria = transacao.categoria_id ? categoriasPorId.get(transacao.categoria_id) : undefined;
          const isReceita = transacao.tipo === "receita";

          return (
            <div
              key={transacao.id}
              className="flex items-center justify-between rounded-ff-md border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{transacao.descricao}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-muted">
                  <span>{formatarData(transacao.data_vencimento)}</span>
                  {conta && (
                    <span className="font-semibold" style={{ color: conta.cor }}>
                      {conta.nome}
                    </span>
                  )}
                  {categoria && (
                    <span className="font-semibold" style={{ color: categoria.cor }}>
                      {categoria.nome}
                    </span>
                  )}
                  <span className={transacao.status === "paga" ? "text-primary" : "text-orange"}>
                    {transacao.status === "paga" ? "Concluído" : "Pendente"}
                  </span>
                </div>
              </div>
              <p className={`shrink-0 pl-3 font-bold ${isReceita ? "text-primary" : "text-red"}`}>
                {isReceita ? "+ " : "- "}
                {formatarReais(Number(transacao.valor))}
              </p>
            </div>
          );
        })}

        {transacoes.length === 0 && (
          <p className="text-sm text-foreground-muted">Nenhum lançamento encontrado.</p>
        )}
      </div>
    </div>
  );
}
