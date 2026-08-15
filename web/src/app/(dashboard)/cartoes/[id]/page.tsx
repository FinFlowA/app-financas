import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/format";
import type { Cartao, Categoria, Conta, FaturaItem } from "@/lib/types";
import NovaCompraForm from "../nova-compra-form";
import PagarFaturaForm from "../pagar-fatura-form";

function mesAtualStr(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function formatarMesAno(mesFatura: string): string {
  const [ano, mes] = mesFatura.split("-");
  const nomes = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${nomes[Number(mes) - 1]} ${ano}`;
}

export default async function CartaoDetalhePage(props: PageProps<"/cartoes/[id]">) {
  const { id } = await props.params;
  const cartaoId = Number(id);
  if (!Number.isInteger(cartaoId) || cartaoId <= 0) notFound();

  const supabase = await createClient();

  const [{ data: cartaoData }, { data: itensData }, { data: categoriasData }, { data: contasData }] = await Promise.all([
    supabase.from("cartoes").select("id, user_id, nome, cor, limite, dia_vencimento, dia_fechamento, ativo").eq("id", cartaoId).maybeSingle(),
    supabase.from("fatura_itens").select("id, cartao_id, user_id, descricao, valor, data_compra, mes_fatura, parcela_atual, total_parcelas, categoria_id, pago").eq("cartao_id", cartaoId).order("data_compra", { ascending: false }),
    supabase.from("categorias").select("id, user_id, nome, cor, icone, tipo, ativa").eq("tipo", "despesa").eq("ativa", true).order("nome"),
    supabase.from("contas").select("id, user_id, nome, cor, saldo_inicial, arquivado, compartilhado").eq("arquivado", false).order("id"),
  ]);

  const cartao = cartaoData as Cartao | null;
  if (!cartao) notFound();

  const itens = (itensData ?? []) as FaturaItem[];
  const categorias = (categoriasData ?? []) as Categoria[];
  const contas = (contasData ?? []) as Conta[];

  const mesAtual = mesAtualStr();
  const mesesFatura = [...new Set(itens.map((item) => item.mes_fatura))].sort((a, b) => b.localeCompare(a));
  if (!mesesFatura.includes(mesAtual)) mesesFatura.unshift(mesAtual);
  mesesFatura.sort((a, b) => b.localeCompare(a));

  const itensAtual = itens.filter((item) => item.mes_fatura === mesAtual);
  const totalAtual = itensAtual.reduce((soma, item) => soma + Number(item.valor), 0);
  const abertoAtual = itensAtual.filter((item) => !item.pago).reduce((soma, item) => soma + Number(item.valor), 0);

  const mesesAnteriores = mesesFatura.filter((mes) => mes !== mesAtual);

  return (
    <div className="max-w-3xl">
      <Link href="/cartoes" className="mb-4 inline-block text-sm font-semibold text-foreground-muted hover:text-foreground">
        ← Cartões
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full" style={{ backgroundColor: cartao.cor }} />
        <h1 className="text-2xl font-extrabold text-foreground">{cartao.nome}</h1>
      </div>

      <div className="mb-6 rounded-ff-lg border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
              Fatura de {formatarMesAno(mesAtual)}
            </p>
            <p className="text-xl font-extrabold text-foreground">{formatarReais(totalAtual)}</p>
          </div>
          {abertoAtual > 0 && (
            <PagarFaturaForm cartaoId={cartao.id} mesFatura={mesAtual} totalAberto={abertoAtual} contas={contas} />
          )}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {itensAtual.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-ff-sm bg-surface-muted px-3 py-2 text-sm">
              <div>
                <p className="font-semibold text-foreground">{item.descricao}</p>
                <p className="text-xs text-foreground-muted">
                  {formatarData(item.data_compra)}
                  {item.total_parcelas > 1 && ` · ${item.parcela_atual}/${item.total_parcelas}`}
                  {item.pago && " · Pago"}
                </p>
              </div>
              <p className="font-bold text-foreground">{formatarReais(Number(item.valor))}</p>
            </div>
          ))}
          {itensAtual.length === 0 && (
            <p className="text-sm text-foreground-muted">Nenhuma compra nesta fatura ainda.</p>
          )}
        </div>

        <NovaCompraForm cartaoId={cartao.id} categorias={categorias} />
      </div>

      {mesesAnteriores.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-bold text-foreground">Faturas anteriores</h2>
          <div className="flex flex-col gap-2">
            {mesesAnteriores.map((mes) => {
              const itensDoMes = itens.filter((item) => item.mes_fatura === mes);
              const total = itensDoMes.reduce((soma, item) => soma + Number(item.valor), 0);
              const pago = itensDoMes.every((item) => item.pago);
              return (
                <div key={mes} className="flex items-center justify-between rounded-ff-md border border-border bg-surface px-4 py-3">
                  <span className="font-semibold text-foreground">{formatarMesAno(mes)}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-foreground">{formatarReais(total)}</span>
                    <span className={`text-xs font-semibold ${pago ? "text-primary" : "text-orange"}`}>
                      {pago ? "Paga" : "Em aberto"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
