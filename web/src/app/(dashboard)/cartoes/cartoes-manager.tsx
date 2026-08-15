"use client";

import Link from "next/link";
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

export type CartaoResumo = Cartao & {
  limiteUsado: number;
  faturaAtual: number;
  proximaFatura: number;
};

type Acao = (formData: FormData) => Promise<{ erro: string | null }>;

function RequestId() {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="request_id" value={id} />;
}

function inputClass() {
  return "w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary";
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
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <RequestId />
      {cartao && (
        <>
          <input type="hidden" name="card_id" value={cartao.id} />
          <input type="hidden" name="expected_version" value={cartao.version} />
        </>
      )}
      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Nome</span>
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
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Limite</span>
        <CurrencyInput name="limite" required defaultValue={cartao?.limite} />
        {cartao && (
          <span data-private-value="true" className="mt-1 block text-xs text-foreground-muted">
            Comprometido agora: {formatarReais(cartao.limiteUsado)}
          </span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Fecha dia</span>
          <input name="dia_fechamento" required type="number" min={1} max={31} defaultValue={cartao?.dia_fechamento ?? 3} className={inputClass()} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">Vence dia</span>
          <input name="dia_vencimento" required type="number" min={1} max={31} defaultValue={cartao?.dia_vencimento ?? 10} className={inputClass()} />
        </label>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-foreground-muted">Cor</legend>
        <input type="hidden" name="cor" value={cor} />
        <div className="flex flex-wrap gap-2">
          {CORES_CARTAO.map((opcao) => (
            <button
              type="button"
              key={opcao}
              onClick={() => setCor(opcao)}
              aria-label={`Usar cor ${opcao}`}
              aria-pressed={cor === opcao}
              className="h-8 w-8 rounded-full"
              style={{
                backgroundColor: opcao,
                outline: cor === opcao ? "3px solid var(--color-foreground)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={pending} className="rounded-ff-sm bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {pending ? "Salvando..." : cartao ? "Salvar alterações" : "Criar cartão"}
        </button>
        <button type="button" onClick={fechar} className="rounded-ff-sm px-4 py-2.5 text-sm font-semibold text-foreground-muted">Cancelar</button>
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
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">Crédito e faturas</p>
          <h1 className="text-2xl font-extrabold text-foreground">Cartões</h1>
        </div>
        <button
          onClick={() => { setEditor("novo"); setErro(null); setAviso(null); }}
          className="rounded-ff-md bg-primary px-4 py-2.5 text-sm font-bold text-white"
        >
          + Novo cartão
        </button>
      </div>

      {(erro || aviso) && (
        <div role="status" className={`mb-4 rounded-ff-md border px-4 py-3 text-sm font-semibold ${erro ? "border-red/40 bg-red/10 text-red" : "border-primary/40 bg-primary-soft text-primary-dark"}`}>
          {erro || aviso}
        </div>
      )}

      {editor && (
        <section key={editor === "novo" ? "novo" : editor.id} className="mb-6 rounded-ff-lg border border-primary/40 bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-foreground">{editor === "novo" ? "Novo cartão" : `Editar ${editor.nome}`}</h2>
            <button onClick={() => setEditor(null)} aria-label="Fechar" className="rounded-full bg-surface-muted px-3 py-1.5 text-foreground">×</button>
          </div>
          <CartaoForm
            cartao={editor === "novo" ? undefined : editor}
            pending={pending}
            executar={executar}
            fechar={() => setEditor(null)}
          />
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ativos.map((cartao) => {
          const percentual = Math.min(100, Math.max(0, cartao.limiteUsado / Math.max(Number(cartao.limite), 0.01) * 100));
          return (
            <article key={cartao.id} className="rounded-ff-lg border border-border bg-surface p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <Link href={`/cartoes/${cartao.id}`} className="flex min-w-0 items-center gap-3 hover:text-primary">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cartao.cor }} />
                  <span className="truncate font-extrabold text-foreground">{cartao.nome}</span>
                </Link>
                <button onClick={() => setEditor(cartao)} className="rounded-ff-sm bg-surface-muted px-3 py-1.5 text-xs font-bold text-foreground">Editar</button>
              </div>
              <Link href={`/cartoes/${cartao.id}`} className="block">
                <div className="mb-1 flex items-baseline justify-between">
                  <span data-private-value="true" className="text-lg font-extrabold text-foreground">{formatarReais(cartao.limiteUsado)}</span>
                  <span data-private-value="true" className="text-xs text-foreground-muted">de {formatarReais(Number(cartao.limite))}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full" style={{ width: `${percentual}%`, backgroundColor: percentual >= 80 ? "#EE6B63" : cartao.cor }} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-ff-sm bg-surface-muted p-2">
                    <span className="block text-foreground-muted">Fatura atual</span>
                    <strong data-private-value="true" className="text-foreground">{formatarReais(cartao.faturaAtual)}</strong>
                  </div>
                  <div className="rounded-ff-sm bg-surface-muted p-2">
                    <span className="block text-foreground-muted">Próxima fatura</span>
                    <strong data-private-value="true" className="text-foreground">{formatarReais(cartao.proximaFatura)}</strong>
                  </div>
                </div>
                <p className="mt-2 text-xs text-foreground-muted">Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}</p>
              </Link>
              <div className="mt-3 border-t border-border pt-3">
                {confirmar?.id === cartao.id ? (
                  <div className="rounded-ff-sm bg-surface-muted p-3 text-xs">
                    <p className="mb-2 font-semibold text-foreground">
                      {confirmar.acao === "delete_card"
                        ? "Excluir? Se houver compras ou pagamentos, o cartão será arquivado e o histórico preservado."
                        : "Arquivar este cartão? Novas compras ficarão bloqueadas."}
                    </p>
                    <div className="flex gap-3">
                      <form action={(formData) => executar(alterarEstadoCartao, formData, "Cartão atualizado.")}>
                        <RequestId />
                        <input type="hidden" name="card_id" value={cartao.id} />
                        <input type="hidden" name="operacao" value={confirmar.acao} />
                        <button disabled={pending} className="font-bold text-red">Confirmar</button>
                      </form>
                      <button onClick={() => setConfirmar(null)} className="font-bold text-foreground-muted">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setConfirmar({ id: cartao.id, acao: "archive_card" })} className="text-xs font-semibold text-foreground-muted">Arquivar</button>
                    <button onClick={() => setConfirmar({ id: cartao.id, acao: "delete_card" })} className="text-xs font-semibold text-red">Excluir</button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {ativos.length === 0 && (
        <div className="rounded-ff-lg border border-dashed border-border p-8 text-center text-sm text-foreground-muted">Nenhum cartão ativo.</div>
      )}

      {arquivados.length > 0 && (
        <details className="mt-6 rounded-ff-lg border border-border bg-surface p-4">
          <summary className="cursor-pointer font-bold text-foreground">Cartões arquivados ({arquivados.length})</summary>
          <div className="mt-3 space-y-2">
            {arquivados.map((cartao) => (
              <div key={cartao.id} className="rounded-ff-sm bg-surface-muted px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link href={`/cartoes/${cartao.id}`} className="font-semibold text-foreground hover:text-primary">{cartao.nome}</Link>
                  <div className="flex items-center gap-3">
                    <form action={(formData) => executar(alterarEstadoCartao, formData, "Cartão reativado.")}>
                      <RequestId />
                      <input type="hidden" name="card_id" value={cartao.id} />
                      <input type="hidden" name="operacao" value="reactivate_card" />
                      <button disabled={pending} className="text-xs font-bold text-primary">Reativar</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
