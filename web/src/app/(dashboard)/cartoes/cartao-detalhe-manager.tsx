"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatarData, formatarReais } from "@/lib/format";
import type { Cartao, Categoria, Conta, FaturaItem } from "@/lib/types";
import { editarCompra, estornarPagamentoFatura, excluirCompra } from "./actions";
import { adicionarMeses, dataVencimento, formatarMesAno, faturaEstaFechada } from "./card-utils";
import NovaCompraForm from "./nova-compra-form";
import PagarFaturaForm from "./pagar-fatura-form";

export type PagamentoDaFatura = {
  id: number;
  valor: number;
  data: string;
  conta: string;
  modo: "Integral" | "Parcial" | "Saldo transferido";
};

function RequestId({ name = "request_id" }: { name?: string }) {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={name} value={id} />;
}

function inputClass() {
  return "w-full rounded-ff-sm border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary";
}

function descricaoBase(item: FaturaItem): string {
  return item.descricao
    .replace(/\s+\(\d+\/\d+\)$/, "")
    .replace(/\s+\(Fixa\)$/, "")
    .trim();
}

function itemSintetico(item: FaturaItem): boolean {
  return item.categoria_id === null
    || item.descricao === "Pagamento parcial da fatura"
    || /^Saldo da fatura anterior \(.+\)$/.test(item.descricao);
}

function CompraActions({
  item,
  cartaoId,
  categorias,
  bloqueado,
}: {
  item: FaturaItem;
  cartaoId: number;
  categorias: Categoria[];
  bloqueado: boolean;
}) {
  const [painel, setPainel] = useState<"editar" | "excluir" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ehSerie = item.total_parcelas > 1 || item.descricao.endsWith("(Fixa)");
  const base = descricaoBase(item);

  function executar(acao: typeof editarCompra | typeof excluirCompra, formData: FormData, sucesso: string) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const resultado = await acao(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setPainel(null);
      setAviso(sucesso);
    });
  }

  if (bloqueado || item.pago || itemSintetico(item)) return null;

  return (
    <div className="mt-2 border-t border-border/70 pt-2">
      {!painel && (
        <div className="flex justify-end gap-3">
          <button onClick={() => setPainel("editar")} className="text-xs font-bold text-primary">Editar</button>
          <button onClick={() => setPainel("excluir")} className="text-xs font-bold text-red">Excluir</button>
        </div>
      )}

      {painel === "editar" && (
        <form action={(formData) => executar(editarCompra, formData, "Compra atualizada.")} className="grid gap-2 sm:grid-cols-2">
          <RequestId />
          <RequestId name="category_request_id" />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="purchase_id" value={item.id} />
          <input type="hidden" name="old_description" value={base} />
          <input type="hidden" name="old_category_id" value={item.categoria_id ?? ""} />
          <label>
            <span className="mb-1 block text-xs font-semibold text-foreground-muted">Descrição</span>
            <input name="description" required maxLength={100} defaultValue={base} className={inputClass()} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-foreground-muted">Categoria</span>
            <select name="category_id" required defaultValue={item.categoria_id ?? ""} className={inputClass()}>
              {categorias.map((categoria) => (
                <option
                  key={categoria.id}
                  value={categoria.id}
                  disabled={!Boolean(categoria.ativa) && categoria.id !== item.categoria_id}
                >
                  {categoria.nome}{!Boolean(categoria.ativa) ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </label>
          {ehSerie && (
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">Aplicar em</span>
              <select name="series_scope" defaultValue="one" className={inputClass()}>
                <option value="one">Somente esta cobrança</option>
                <option value="open_series">Todas as cobranças abertas da série</option>
              </select>
            </label>
          )}
          {!ehSerie && <input type="hidden" name="series_scope" value="one" />}
          <div className="flex gap-3 sm:col-span-2">
            <button disabled={pending} className="text-xs font-bold text-primary">{pending ? "Salvando..." : "Salvar"}</button>
            <button type="button" onClick={() => { setPainel(null); setErro(null); }} className="text-xs font-bold text-foreground-muted">Cancelar</button>
          </div>
        </form>
      )}

      {painel === "excluir" && (
        <form action={(formData) => executar(excluirCompra, formData, "Compra excluída.")} className="rounded-ff-sm bg-surface p-3">
          <RequestId />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="purchase_id" value={item.id} />
          <p className="mb-2 text-xs font-semibold text-foreground">Excluir esta compra?</p>
          {ehSerie ? (
            <select name="series_scope" defaultValue="one" className={`${inputClass()} mb-2`}>
              <option value="one">Somente esta cobrança</option>
              <option value="open_series">Todas as cobranças abertas da série</option>
            </select>
          ) : (
            <input type="hidden" name="series_scope" value="one" />
          )}
          <div className="flex gap-3">
            <button disabled={pending} className="text-xs font-bold text-red">{pending ? "Excluindo..." : "Confirmar exclusão"}</button>
            <button type="button" onClick={() => { setPainel(null); setErro(null); }} className="text-xs font-bold text-foreground-muted">Cancelar</button>
          </div>
        </form>
      )}

      {(erro || aviso) && <p role="status" className={`mt-2 text-xs font-semibold ${erro ? "text-red" : "text-primary"}`}>{erro || aviso}</p>}
    </div>
  );
}

function PagamentoItem({ pagamento, cartaoId }: { pagamento: PagamentoDaFatura; cartaoId: number }) {
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function estornar(formData: FormData) {
    setErro(null);
    startTransition(async () => {
      const resultado = await estornarPagamentoFatura(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setConfirmar(false);
    });
  }

  return (
    <div className="rounded-ff-sm border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-foreground">{pagamento.modo} · {pagamento.conta}</p>
          <p className="text-xs text-foreground-muted">{formatarData(pagamento.data)}</p>
        </div>
        <div className="text-right">
          <p data-private-value="true" className="font-extrabold text-primary">{formatarReais(pagamento.valor)}</p>
          <button onClick={() => setConfirmar(!confirmar)} className="text-xs font-bold text-red">Estornar</button>
        </div>
      </div>
      {confirmar && (
        <form action={estornar} className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-xs">
          <RequestId />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="transaction_id" value={pagamento.id} />
          <span className="mr-auto text-foreground-muted">O estorno restaura apenas os itens ligados a este pagamento.</span>
          <button disabled={pending} className="font-bold text-red">{pending ? "Estornando..." : "Confirmar"}</button>
          <button type="button" onClick={() => { setConfirmar(false); setErro(null); }} className="font-bold text-foreground-muted">Cancelar</button>
        </form>
      )}
      {erro && <p role="alert" className="mt-2 text-xs font-semibold text-red">{erro}</p>}
    </div>
  );
}

export default function CartaoDetalheManager({
  cartao,
  itens,
  categorias,
  contas,
  pagamentos,
  mesAtual,
  mesSelecionado,
  mesesDisponiveis,
}: {
  cartao: Cartao;
  itens: FaturaItem[];
  categorias: Categoria[];
  contas: Conta[];
  pagamentos: PagamentoDaFatura[];
  mesAtual: string;
  mesSelecionado: string;
  mesesDisponiveis: string[];
}) {
  const router = useRouter();
  const itensDaFatura = itens.filter((item) => item.mes_fatura === mesSelecionado);
  const totalFatura = itensDaFatura.reduce((total, item) => total + Number(item.valor), 0);
  const totalAberto = Math.max(0, itensDaFatura
    .filter((item) => !item.pago)
    .reduce((total, item) => total + Number(item.valor), 0));
  const fechada = faturaEstaFechada(mesSelecionado, cartao.dia_fechamento);
  const quitada = itensDaFatura.length > 0 && totalAberto <= 0.005;
  const anterior = adicionarMeses(mesSelecionado, -1);
  const proxima = adicionarMeses(mesSelecionado, 1);
  const proximaReal = adicionarMeses(mesAtual, 1);

  return (
    <div className="max-w-5xl">
      <Link href="/cartoes" className="mb-4 inline-block text-sm font-semibold text-foreground-muted hover:text-foreground">← Cartões</Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: cartao.cor }} />
          <div>
            <h1 className="text-2xl font-extrabold text-foreground">{cartao.nome}</h1>
            <p className="text-xs text-foreground-muted">
              Limite {formatarReais(Number(cartao.limite))} · Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}
            </p>
          </div>
        </div>
        {!cartao.ativo && <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-bold text-foreground-muted">Cartão arquivado</span>}
      </div>

      <nav aria-label="Navegação de faturas" className="mb-4 rounded-ff-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/cartoes/${cartao.id}?fatura=${anterior}`} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground">← Anterior</Link>
          <select
            aria-label="Selecionar fatura"
            value={mesSelecionado}
            onChange={(event) => router.push(`/cartoes/${cartao.id}?fatura=${event.target.value}`)}
            className="min-w-48 flex-1 rounded-ff-sm border border-border bg-surface-muted px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          >
            {mesesDisponiveis.map((mes) => <option key={mes} value={mes}>{formatarMesAno(mes)}</option>)}
          </select>
          <Link href={`/cartoes/${cartao.id}?fatura=${proxima}`} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground">Próxima →</Link>
          {mesSelecionado !== proximaReal && (
            <Link href={`/cartoes/${cartao.id}?fatura=${proximaReal}`} className="rounded-ff-sm bg-primary-soft px-3 py-2 text-xs font-bold text-primary-dark">Ir à próxima fatura</Link>
          )}
        </div>
      </nav>

      <section className="mb-5 rounded-ff-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Fatura de {formatarMesAno(mesSelecionado)}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${quitada ? "bg-primary-soft text-primary-dark" : fechada ? "bg-orange/15 text-orange" : "bg-surface-muted text-foreground-muted"}`}>
                {quitada ? "Paga" : fechada ? "Fechada" : "Aberta"}
              </span>
            </div>
            <p data-private-value="true" className="mt-1 text-2xl font-black text-foreground">{formatarReais(totalFatura)}</p>
            <p className="text-xs text-foreground-muted">
              Fecha em {formatarData(dataVencimento(mesSelecionado, cartao.dia_fechamento))} · Vence em {formatarData(dataVencimento(mesSelecionado, cartao.dia_vencimento))}
            </p>
            {totalAberto > 0 && totalAberto !== totalFatura && (
              <p data-private-value="true" className="mt-1 text-xs font-bold text-orange">Em aberto: {formatarReais(totalAberto)}</p>
            )}
          </div>
          {!cartao.ativo ? null : totalAberto > 0 ? (
            <PagarFaturaForm cartaoId={cartao.id} mesFatura={mesSelecionado} totalAberto={totalAberto} contas={contas} />
          ) : (
            <span className="text-xs font-bold text-primary">Sem saldo em aberto</span>
          )}
        </div>

        <div className="space-y-2">
          {itensDaFatura.map((item) => (
            <article key={item.id} className="rounded-ff-sm bg-surface-muted px-3 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{item.descricao}</p>
                  <p className="text-xs text-foreground-muted">
                    {formatarData(item.data_compra)}
                    {item.total_parcelas > 1 && ` · ${item.parcela_atual}/${item.total_parcelas}`}
                    {item.pago && " · Quitada"}
                    {!item.pago && fechada && " · Fatura fechada"}
                  </p>
                </div>
                <p data-private-value="true" className={`font-bold ${Number(item.valor) < 0 ? "text-primary" : "text-foreground"}`}>
                  {formatarReais(Number(item.valor))}
                </p>
              </div>
              <CompraActions
                key={`${item.id}-${item.descricao}-${item.categoria_id ?? "sem-categoria"}`}
                item={item}
                cartaoId={cartao.id}
                categorias={categorias}
                bloqueado={!cartao.ativo || fechada}
              />
            </article>
          ))}
          {itensDaFatura.length === 0 && <p className="py-4 text-center text-sm text-foreground-muted">Nenhuma cobrança nesta fatura.</p>}
        </div>
      </section>

      {cartao.ativo && (
        <section className="mb-5">
          <NovaCompraForm cartaoId={cartao.id} diaFechamento={cartao.dia_fechamento} categorias={categorias} />
          {!categorias.some((categoria) => Boolean(categoria.ativa)) && <p className="mt-2 text-xs text-orange">Crie uma categoria de despesa ativa antes de adicionar compras.</p>}
        </section>
      )}

      {pagamentos.length > 0 && (
        <section className="rounded-ff-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-lg font-extrabold text-foreground">Pagamentos desta fatura</h2>
          <div className="space-y-2">
            {pagamentos.map((pagamento) => <PagamentoItem key={pagamento.id} pagamento={pagamento} cartaoId={cartao.id} />)}
          </div>
          <p className="mt-3 text-xs text-foreground-muted">Pagamentos mais antigos devem ser estornados do mais recente para o mais antigo quando compartilham cobranças.</p>
        </section>
      )}
    </div>
  );
}
