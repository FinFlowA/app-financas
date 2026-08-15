import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/format";
import type { Caixinha, Conta } from "@/lib/types";
import NovoObjetivoForm from "./novo-objetivo-form";
import MovimentoObjetivoForm from "./movimento-objetivo-form";

export default async function ObjetivosPage() {
  const supabase = await createClient();
  const [{ data: caixinhasData }, { data: contasData }] = await Promise.all([
    supabase
      .from("caixinhas")
      .select("id, user_id, nome, meta_valor, saldo_atual, cor, icone, compartilhado, data_prazo, arquivado")
      .eq("arquivado", false)
      .order("id"),
    supabase
      .from("contas")
      .select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado")
      .eq("arquivado", false)
      .order("id"),
  ]);

  const objetivos = (caixinhasData ?? []) as Caixinha[];
  const contas = (contasData ?? []) as Conta[];

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-extrabold text-foreground">Objetivos</h1>

      <NovoObjetivoForm />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {objetivos.map((objetivo) => {
          const meta = Math.max(Number(objetivo.meta_valor), 0.01);
          const percentual = Math.min(100, (Number(objetivo.saldo_atual) / meta) * 100);
          const completo = Number(objetivo.saldo_atual) >= Number(objetivo.meta_valor);

          return (
            <div key={objetivo.id} className="rounded-ff-lg border border-border bg-surface p-5">
              <div className="mb-3 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
                  style={{ backgroundColor: `${objetivo.cor}22` }}
                >
                  {objetivo.icone}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-bold text-foreground">{objetivo.nome}</p>
                  {objetivo.data_prazo && (
                    <p className="text-xs text-foreground-muted">Até {formatarData(objetivo.data_prazo)}</p>
                  )}
                </div>
              </div>

              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-lg font-extrabold text-foreground">
                  {formatarReais(Number(objetivo.saldo_atual))}
                </span>
                <span className="text-xs text-foreground-muted">
                  de {formatarReais(Number(objetivo.meta_valor))}
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percentual}%`, backgroundColor: completo ? "#16966E" : objetivo.cor }}
                />
              </div>

              <MovimentoObjetivoForm objetivoId={objetivo.id} objetivoNome={objetivo.nome} contas={contas} />
            </div>
          );
        })}

        {objetivos.length === 0 && (
          <p className="text-sm text-foreground-muted">Nenhum objetivo criado ainda.</p>
        )}
      </div>
    </div>
  );
}
