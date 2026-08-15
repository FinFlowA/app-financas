"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { formatarReais } from "@/lib/format";
import type { Cartao } from "@/lib/types";
import {
  alterarEstadoCartao,
  CORES_CARTAO,
  criarCartao,
  editarCartao,
} from "./actions";
import styles from "./cartoes.module.css";

export type CartaoResumo = Cartao & {
  limiteUsado: number;
  faturaAtual: number;
  faturaAtualPaga: boolean;
  proximaFatura: number;
};

type Acao = (formData: FormData) => Promise<{ erro: string | null }>;

function RequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="request_id" value={id} />;
}

function inputClass() {
  return styles.input;
}

function CartaoForm({
  cartao,
  pending,
  executar,
  fechar,
}: {
  cartao?: CartaoResumo;
  pending: boolean;
  executar: (acao: Acao, formData: FormData, sucesso: string) => void;
  fechar: () => void;
}) {
  const [cor, setCor] = useState(cartao?.cor ?? CORES_CARTAO[0]);

  return (
    <form
      action={(formData) => executar(
        cartao ? editarCartao : criarCartao,
        formData,
        cartao ? "Cartão atualizado." : "Cartão criado.",
      )}
      className={styles.formGrid}
    >
      <RequestId />
      {cartao && (
        <>
          <input type="hidden" name="card_id" value={cartao.id} />
          <input type="hidden" name="expected_version" value={cartao.version} />
        </>
      )}
      <label className={styles.formFull}>
        <span className={styles.fieldLabel}>Nome</span>
        <input
          name="nome"
          required
          maxLength={100}
          defaultValue={cartao?.nome}
          placeholder="Ex.: Nubank, Itaú Visa"
          className={inputClass()}
        />
      </label>
      <label>
        <span className={styles.fieldLabel}>Limite</span>
        <CurrencyInput name="limite" required defaultValue={cartao?.limite} />
        {cartao && (
          <span data-private-value="true" className={styles.helperText}>
            Comprometido agora: {formatarReais(cartao.limiteUsado)}
          </span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={styles.fieldLabel}>Fecha dia</span>
          <input name="dia_fechamento" required type="number" min={1} max={31} defaultValue={cartao?.dia_fechamento ?? 3} className={inputClass()} />
        </label>
        <label>
          <span className={styles.fieldLabel}>Vence dia</span>
          <input name="dia_vencimento" required type="number" min={1} max={31} defaultValue={cartao?.dia_vencimento ?? 10} className={inputClass()} />
        </label>
      </div>
      <fieldset className={styles.formFull}>
        <legend className={styles.fieldLabel}>Cor do cartão</legend>
        <input type="hidden" name="cor" value={cor} />
        <div className={styles.colorList}>
          {CORES_CARTAO.map((opcao) => (
            <button
              type="button"
              key={opcao}
              onClick={() => setCor(opcao)}
              aria-label={`Usar cor ${opcao}`}
              aria-pressed={cor === opcao}
              className={styles.colorButton}
              style={{
                backgroundColor: opcao,
              }}
            />
          ))}
        </div>
      </fieldset>
      <div className={styles.formActions}>
        <button disabled={pending} className={styles.primaryButton}>
          {pending ? "Salvando..." : cartao ? "Salvar alterações" : "Criar cartão"}
        </button>
        <button type="button" onClick={fechar} className={styles.ghostButton}>Cancelar</button>
      </div>
    </form>
  );
}

export default function CartoesManager({ cartoes }: { cartoes: CartaoResumo[] }) {
  const [editor, setEditor] = useState<CartaoResumo | "novo" | null>(null);
  const [confirmar, setConfirmar] = useState<{ id: number; acao: "archive_card" | "delete_card" } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ativos = cartoes.filter((cartao) => cartao.ativo);
  const arquivados = cartoes.filter((cartao) => !cartao.ativo);

  function executar(acao: Acao, formData: FormData, sucesso: string) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const resultado = await acao(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setEditor(null);
      setConfirmar(null);
      setAviso(sucesso);
    });
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headingGroup}>
          <p className={styles.eyebrow}>Crédito e faturas</p>
          <h1 className={styles.title}>Meus cartões</h1>
          <p className={styles.subtitle}>Acompanhe limite, faturas e pagamentos em um só lugar.</p>
        </div>
        <button
          onClick={() => { setEditor("novo"); setErro(null); setAviso(null); }}
          className={styles.primaryButton}
        >
          <span aria-hidden>＋</span> Novo cartão
        </button>
      </header>

      {(erro || aviso) && (
        <div role="status" aria-live="polite" className={styles.notice} data-error={Boolean(erro)}>
          {erro || aviso}
        </div>
      )}

      {editor && (
        <section key={editor === "novo" ? "novo" : editor.id} className={styles.panel} aria-label={editor === "novo" ? "Criar cartão" : "Editar cartão"}>
          <div className={styles.panelHeader}>
            <h2>{editor === "novo" ? "Novo cartão" : `Editar ${editor.nome}`}</h2>
            <button onClick={() => setEditor(null)} aria-label="Fechar edição" className={styles.closeButton}>×</button>
          </div>
          <CartaoForm
            cartao={editor === "novo" ? undefined : editor}
            pending={pending}
            executar={executar}
            fechar={() => setEditor(null)}
          />
        </section>
      )}

      <section aria-label="Cartões ativos" className={styles.cardsGrid}>
        {ativos.map((cartao) => {
          const percentual = Math.min(100, Math.max(0, cartao.limiteUsado / Math.max(Number(cartao.limite), 0.01) * 100));
          const cardStyle = { "--card-accent": cartao.cor } as CSSProperties;
          return (
            <article key={cartao.id} className={styles.creditCard} style={cardStyle}>
              <div className={styles.cardTop}>
                <Link href={`/cartoes/${cartao.id}`} className={styles.cardIdentity}>
                  <span className={styles.cardIcon} aria-hidden>
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M3 9h18M6.5 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  </span>
                  <span className={styles.cardName}>{cartao.nome}</span>
                </Link>
                <button onClick={() => setEditor(cartao)} className={styles.secondaryButton}>Editar</button>
              </div>
              <Link href={`/cartoes/${cartao.id}`} className={styles.cardLink} aria-label={`Abrir faturas do cartão ${cartao.nome}`}>
                <span className={styles.usageLabel}>Limite utilizado</span>
                <div className={styles.invoiceHeadline}>
                  <span data-private-value="true" className={styles.usageValue}>{formatarReais(cartao.limiteUsado)}</span>
                  <span data-private-value="true" className={styles.usageLabel}>de {formatarReais(Number(cartao.limite))}</span>
                </div>
                <div className={styles.usageTrack} aria-label={`${percentual.toFixed(0)}% do limite utilizado`}>
                  <div className={styles.usageFill} style={{ width: `${percentual}%`, backgroundColor: percentual >= 80 ? "#EE6B63" : cartao.cor }} />
                </div>
                <div className={styles.metricGrid}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Fatura atual {cartao.faturaAtualPaga && <em className={styles.invoicePaidBadge}>Paga</em>}</span>
                    <strong data-private-value="true">{formatarReais(cartao.faturaAtual)}</strong>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Próxima fatura</span>
                    <strong data-private-value="true">{formatarReais(cartao.proximaFatura)}</strong>
                  </div>
                </div>
                <p className={styles.metaText}>Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}</p>
              </Link>
              <div className={styles.cardActions}>
                {confirmar?.id === cartao.id ? (
                  <div className={styles.confirmBox} role="alertdialog" aria-label="Confirmar alteração do cartão">
                    <p>
                      {confirmar.acao === "delete_card"
                        ? "Excluir? Se houver compras ou pagamentos, o cartão será arquivado e o histórico preservado."
                        : "Arquivar este cartão? Novas compras ficarão bloqueadas."}
                    </p>
                    <div className={styles.inlineActions}>
                      <form action={(formData) => executar(alterarEstadoCartao, formData, "Cartão atualizado.")}>
                        <RequestId />
                        <input type="hidden" name="card_id" value={cartao.id} />
                        <input type="hidden" name="operacao" value={confirmar.acao} />
                        <button disabled={pending} className={styles.dangerTextButton}>Confirmar</button>
                      </form>
                      <button onClick={() => setConfirmar(null)} className={styles.textButton}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.inlineActions}>
                    <button onClick={() => setConfirmar({ id: cartao.id, acao: "archive_card" })} className={styles.textButton}>Arquivar</button>
                    <button onClick={() => setConfirmar({ id: cartao.id, acao: "delete_card" })} className={styles.dangerTextButton}>Excluir</button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {ativos.length === 0 && (
          <div className={styles.emptyState}>Nenhum cartão ativo. Crie o primeiro para acompanhar suas faturas.</div>
        )}
      </section>

      {arquivados.length > 0 && (
        <details className={styles.archivePanel}>
          <summary>Cartões arquivados ({arquivados.length})</summary>
          <div className={styles.archiveList}>
            {arquivados.map((cartao) => (
              <div key={cartao.id} className={styles.archiveItem} style={{ "--card-accent": cartao.cor } as CSSProperties}>
                <Link href={`/cartoes/${cartao.id}`} className={styles.archivedCardLink}>
                  <span className={styles.archiveAccent} aria-hidden />
                  {cartao.nome}
                </Link>
                <form action={(formData) => executar(alterarEstadoCartao, formData, "Cartão reativado.")}>
                  <RequestId />
                  <input type="hidden" name="card_id" value={cartao.id} />
                  <input type="hidden" name="operacao" value="reactivate_card" />
                  <button disabled={pending} className={styles.textButton}>Reativar</button>
                </form>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
