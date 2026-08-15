import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/format";
import type { Cartao, FaturaItem } from "@/lib/types";
import NovoCartaoForm from "./novo-cartao-form";

function mesAtualStr(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export default async function CartoesPage() {
  const supabase = await createClient();
  const mesAtual = mesAtualStr();

  const [{ data: cartoesData }, { data: itensData }] = await Promise.all([
    supabase.from("cartoes").select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo").eq("ativo", true).order("id"),
    supabase.from("fatura_itens").select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago"),
  ]);

  const cartoes = (cartoesData ?? []) as Cartao[];
  const itens = (itensData ?? []) as FaturaItem[];

  const limiteUsadoPorCartao = new Map<number, number>();
  for (const item of itens) {
    if (item.mes_fatura < mesAtual || item.pago) continue;
    if (item.descricao.endsWith("(Fixa)") && item.mes_fatura !== mesAtual) continue;
    limiteUsadoPorCartao.set(item.cartao_id, (limiteUsadoPorCartao.get(item.cartao_id) ?? 0) + Number(item.valor));
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-extrabold text-foreground">Cartões</h1>

      <NovoCartaoForm />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cartoes.map((cartao) => {
          const limiteUsado = limiteUsadoPorCartao.get(cartao.id) ?? 0;
          const percentual = Math.min(100, (limiteUsado / Math.max(Number(cartao.limite), 0.01)) * 100);

          return (
            <Link
              key={cartao.id}
              href={`/cartoes/${cartao.id}`}
              className="rounded-ff-lg border border-border bg-surface p-5 transition hover:border-primary"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: cartao.cor }} />
                <p className="font-bold text-foreground">{cartao.nome}</p>
              </div>

              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-lg font-extrabold text-foreground">{formatarReais(limiteUsado)}</span>
                <span className="text-xs text-foreground-muted">de {formatarReais(Number(cartao.limite))}</span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${percentual}%`, backgroundColor: percentual >= 80 ? "#EE6B63" : cartao.cor }}
                />
              </div>

              <p className="mt-2 text-xs text-foreground-muted">
                Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}
              </p>
            </Link>
          );
        })}

        {cartoes.length === 0 && (
          <p className="text-sm text-foreground-muted">Nenhum cartão cadastrado ainda.</p>
        )}
      </div>
    </div>
  );
}
