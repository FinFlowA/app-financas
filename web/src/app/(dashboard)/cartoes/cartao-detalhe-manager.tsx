"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import { invoicePresentationStatus } from "@/lib/invoice-status";
import { formatarData, formatarReais } from "@/lib/format";
import type { Cartao, Categoria, Conta, FaturaItem } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import { editarCompra, estornarPagamentoFatura, excluirCompra } from "./actions";
import { adicionarMeses, dataVencimento, formatarMesAno, faturaEstaFechada } from "./card-utils";
import NovaCompraForm from "./nova-compra-form";
import PagarFaturaForm from "./pagar-fatura-form";
import styles from "./cartoes.module.css";

export type PagamentoDaFatura = {
  id: number;
  valor: number;
  data: string;
  conta: string;
  modo: "Integral" | "Parcial" | "Saldo transferido";
};

function RequestId({ name = "request_id" }: { name?: string }) {
  const [id] = useRequestId();
  return <input type="hidden" name={name} value={id} readOnly />;
}

function inputClass() {
  return styles.input;
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
    <div className={styles.actionEditor}>
      {!painel && (
        <div className={styles.inlineActions}>
          <button onClick={() => setPainel("editar")} className={styles.textButton}>Editar</button>
          <button onClick={() => setPainel("excluir")} className={styles.dangerTextButton}>Excluir</button>
        </div>
      )}

      {painel === "editar" && (
        <form action={(formData) => executar(editarCompra, formData, "Compra atualizada.")} className={styles.smallFormGrid}>
          <RequestId />
          <RequestId name="category_request_id" />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="purchase_id" value={item.id} />
          <input type="hidden" name="old_description" value={base} />
          <input type="hidden" name="old_category_id" value={item.categoria_id ?? ""} />
          <label>
            <span className={styles.fieldLabel}>Descrição</span>
            <input name="description" required maxLength={100} defaultValue={base} className={inputClass()} />
          </label>
          <label>
            <span className={styles.fieldLabel}>Categoria</span>
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
            <label className={styles.formFull}>
              <span className={styles.fieldLabel}>Aplicar em</span>
              <select name="series_scope" defaultValue="one" className={inputClass()}>
                <option value="one">Somente esta cobrança</option>
                <option value="open_series">Todas as cobranças abertas da série</option>
              </select>
            </label>
          )}
          {!ehSerie && <input type="hidden" name="series_scope" value="one" />}
          <div className={styles.formActions}>
            <button disabled={pending} className={styles.textButton}>{pending ? "Salvando..." : "Salvar"}</button>
            <button type="button" onClick={() => { setPainel(null); setErro(null); }} className={styles.textButton}>Cancelar</button>
          </div>
        </form>
      )}

      {painel === "excluir" && (
        <form action={(formData) => executar(excluirCompra, formData, "Compra excluída.")} className={styles.confirmBox}>
          <RequestId />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="purchase_id" value={item.id} />
          <p>Excluir esta compra?</p>
          {ehSerie ? (
            <select name="series_scope" defaultValue="one" className={inputClass()}>
              <option value="one">Somente esta cobrança</option>
              <option value="open_series">Todas as cobranças abertas da série</option>
            </select>
          ) : (
            <input type="hidden" name="series_scope" value="one" />
          )}
          <div className={styles.inlineActions}>
            <button disabled={pending} className={styles.dangerTextButton}>{pending ? "Excluindo..." : "Confirmar exclusão"}</button>
            <button type="button" onClick={() => { setPainel(null); setErro(null); }} className={styles.textButton}>Cancelar</button>
          </div>
        </form>
      )}

      {(erro || aviso) && <p role="status" className={erro ? styles.errorText : styles.successText}>{erro || aviso}</p>}
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
    <div className={styles.paymentItem}>
      <div className={styles.paymentRow}>
        <div>
          <p className={styles.itemTitle}>{pagamento.modo} · {pagamento.conta}</p>
          <p className={styles.itemMeta}>{formatarData(pagamento.data)}</p>
        </div>
        <div className="text-right">
          <p data-private-value="true" className={styles.successText}>{formatarReais(pagamento.valor)}</p>
          <button onClick={() => setConfirmar(!confirmar)} className={styles.dangerTextButton}>Estornar</button>
        </div>
      </div>
      {confirmar && (
        <form action={estornar} className={styles.confirmBox}>
          <RequestId />
          <input type="hidden" name="card_id" value={cartaoId} />
          <input type="hidden" name="transaction_id" value={pagamento.id} />
          <span className={styles.helperText}>O estorno restaura apenas os itens ligados a este pagamento.</span>
          <div className={styles.inlineActions}>
            <button disabled={pending} className={styles.dangerTextButton}>{pending ? "Estornando..." : "Confirmar"}</button>
            <button type="button" onClick={() => { setConfirmar(false); setErro(null); }} className={styles.textButton}>Cancelar</button>
          </div>
        </form>
      )}
      {erro && <p role="alert" className={styles.errorText}>{erro}</p>}
    </div>
  );
}

export default function CartaoDetalheManager({
  cartao,
  itens,
  categorias,
  contas,
  pagamentos,
  mesSelecionado,
  mesesDisponiveis,
}: {
  cartao: Cartao;
  itens: FaturaItem[];
  categorias: Categoria[];
  contas: Conta[];
  pagamentos: PagamentoDaFatura[];
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
  const statusFatura = invoicePresentationStatus({
    invoiceMonth: mesSelecionado,
    closingDay: cartao.dia_fechamento,
    itemCount: itensDaFatura.length,
    openTotal: totalAberto,
    allItemsPaid: itensDaFatura.length > 0 && itensDaFatura.every((item) => item.pago),
  });
  const quitada = statusFatura === "paid";
  const anterior = adicionarMeses(mesSelecionado, -1);

  return (
    <div className={styles.page} style={{ "--card-accent": cartao.cor } as CSSProperties}>
      <Link href="/cartoes" className={styles.backLink}>
        <span aria-hidden>←</span> Voltar para cartões
      </Link>

      <header className={styles.detailHero}>
        <div>
          <p className={styles.eyebrow}>Cartão de crédito</p>
          <div className={styles.detailTitleRow}>
            <span className={styles.detailAccent} aria-hidden />
            <h1>{cartao.nome}</h1>
          </div>
          <p>Limite {formatarReais(Number(cartao.limite))} · Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}</p>
        </div>
        {!cartao.ativo && <span className={styles.cardStatus}>Cartão arquivado</span>}
      </header>

      <nav aria-label="Navegação de faturas" className={styles.invoiceNav}>
        <div className={styles.invoiceNavRow}>
          <select
            aria-label="Selecionar fatura"
            value={mesSelecionado}
            onChange={(event) => router.push(`/cartoes/${cartao.id}?fatura=${event.target.value}`)}
            className={styles.input}
          >
            {mesesDisponiveis.map((mes) => <option key={mes} value={mes}>{formatarMesAno(mes)}</option>)}
          </select>
          <Link href={`/cartoes/${cartao.id}?fatura=${anterior}`} className={styles.secondaryButton} aria-label="Fatura anterior">← Anterior</Link>
        </div>
      </nav>

      <section className={`${styles.invoicePanel} ${quitada ? styles.invoicePanelPaid : ""}`}>
        <div className={styles.invoiceHeader}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className={styles.invoiceEyebrow}>Fatura de {formatarMesAno(mesSelecionado)}</p>
              <span className={`${styles.statusPill} ${quitada ? styles.statusPillPaid : fechada ? styles.statusPillClosed : styles.statusPillOpen}`}>
                {quitada ? "Paga" : statusFatura === "zero" ? "Zerada" : fechada ? "Fechada" : "Aberta"}
              </span>
            </div>
            <p data-private-value="true" className={styles.invoiceTotal}>{formatarReais(totalFatura)}</p>
            <p className={styles.itemMeta}>
              Fecha em {formatarData(dataVencimento(mesSelecionado, cartao.dia_fechamento))} · Vence em {formatarData(dataVencimento(mesSelecionado, cartao.dia_vencimento))}
            </p>
            {totalAberto > 0 && totalAberto !== totalFatura && (
              <p data-private-value="true" className={styles.errorText}>Em aberto: {formatarReais(totalAberto)}</p>
            )}
          </div>
          {!cartao.ativo ? null : quitada ? (
            <div className={styles.paidInvoiceMarker} role="status">
              <span className={styles.paidInvoiceIcon} aria-hidden>✓</span>
              <span><strong>Fatura paga</strong><small>{itensDaFatura.length === 0 ? "Fechou zerada, sem débito gerado" : "Sem saldo em aberto"}</small></span>
            </div>
          ) : totalAberto > 0 ? (
            <PagarFaturaForm cartaoId={cartao.id} mesFatura={mesSelecionado} totalAberto={totalAberto} contas={contas} />
          ) : (
            <div className={styles.zeroInvoiceMarker} role="status">
              <span><strong>Fatura zerada</strong><small>Nenhum valor para pagar</small></span>
            </div>
          )}
        </div>

        <div className={styles.itemsList}>
          {itensDaFatura.map((item) => (
            <article key={item.id} className={styles.invoiceItem}>
              <div className={styles.invoiceHeadline}>
                <div>
                  <p className={styles.itemTitle}>{item.descricao}</p>
                  <p className={styles.itemMeta}>
                    {formatarData(item.data_compra)}
                    {item.total_parcelas > 1 && ` · ${item.parcela_atual}/${item.total_parcelas}`}
                    {item.pago && " · Quitada"}
                    {!item.pago && fechada && " · Fatura fechada"}
                  </p>
                </div>
                <p data-private-value="true" className={styles.itemValue} style={Number(item.valor) < 0 ? { color: "var(--ff-primary-dark)" } : undefined}>
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
          {itensDaFatura.length === 0 && <div className={styles.emptyState}>Nenhuma cobrança nesta fatura.</div>}
        </div>
      </section>

      {cartao.ativo && (
        <section className={styles.subPanel}>
          <NovaCompraForm cartaoId={cartao.id} diaFechamento={cartao.dia_fechamento} categorias={categorias} />
          {!categorias.some((categoria) => Boolean(categoria.ativa)) && <p className={styles.errorText}>Crie uma categoria de despesa ativa antes de adicionar compras.</p>}
        </section>
      )}

      {pagamentos.length > 0 && (
        <section className={`${styles.invoicePanel} mt-5`}>
          <h2 className={styles.sectionTitle}>Pagamentos desta fatura</h2>
          <div className={`${styles.paymentsList} mt-4`}>
            {pagamentos.map((pagamento) => <PagamentoItem key={pagamento.id} pagamento={pagamento} cartaoId={cartao.id} />)}
          </div>
          <p className={styles.helperText}>Pagamentos mais antigos devem ser estornados do mais recente para o mais antigo quando compartilham cobranças.</p>
        </section>
      )}
    </div>
  );
}
