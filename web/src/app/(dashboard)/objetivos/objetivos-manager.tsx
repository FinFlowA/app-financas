"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import CurrencyInput from "@/components/ui/currency-input";
import FinancialIcon from "@/components/ui/financial-icon";
import { hojeEmSaoPaulo } from "@/lib/date";
import { formatarData, formatarReais } from "@/lib/format";
import type { Caixinha, Conta } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import {
  alterarCompartilhamentoObjetivo,
  alterarEstadoObjetivo,
  criarObjetivo,
  editarObjetivo,
  movimentarObjetivo,
} from "./actions";
import { CORES_OBJETIVO, ICONES_OBJETIVO } from "./goal-options";

type Movimento = {
  id: number;
  descricao: string;
  valor: number;
  operacao: "guardar" | "resgatar";
  data: string;
  status: "paga" | "pendente";
};

export type ObjetivoComPrevisao = Caixinha & {
  previstoMeta: number | null;
  previstoFimAno: number;
  movimentos: Movimento[];
};

type Painel =
  | { tipo: "novo" }
  | { tipo: "editar"; objetivo: ObjetivoComPrevisao }
  | { tipo: "movimentar"; objetivo: ObjetivoComPrevisao; operacao: "guardar" | "resgatar" }
  | { tipo: "historico"; objetivo: ObjetivoComPrevisao }
  | null;

type Acao = (formData: FormData) => Promise<{ erro: string | null }>;
type Executar = (acao: Acao, formData: FormData, sucesso: string) => void;

const subscribeToNothing = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function ObjectiveActionModal({
  title,
  pending,
  onClose,
  children,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const canUseDOM = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!canUseDOM) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [canUseDOM, onClose, pending]);

  if (!canUseDOM) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#001b18]/78 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="objective-action-title"
        className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-[24px] border border-primary/25 bg-surface p-4 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:max-h-[calc(100dvh-3rem)] sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="objective-action-title" className="text-lg font-extrabold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Fechar"
            className="ff-focus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-lg font-bold text-foreground-muted transition hover:bg-primary-soft hover:text-primary disabled:opacity-50"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function RequestId({ name = "request_id" }: { name?: string }) {
  const [id] = useRequestId();
  return <input type="hidden" name={name} value={id} readOnly />;
}

function Field({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">{titulo}</span>
      {children}
    </label>
  );
}

function inputClass() {
  return "ff-focus w-full rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-foreground outline-none transition focus:border-primary";
}

function GoalActionIcon({ action }: { action: "save" | "withdraw" | "history" | "archive" | "delete" }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (action === "save") return <svg {...common}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
  if (action === "withdraw") return <svg {...common}><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>;
  if (action === "history") return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>;
  if (action === "archive") return <svg {...common}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></svg>;
  return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

function FormularioObjetivo({
  objetivo,
  pending,
  executar,
  fechar,
  partnerName,
}: {
  objetivo?: ObjetivoComPrevisao;
  pending: boolean;
  executar: Executar;
  fechar: () => void;
  partnerName: string | null;
}) {
  const [cor, setCor] = useState(objetivo?.cor ?? CORES_OBJETIVO[0]);
  const [icone, setIcone] = useState(objetivo?.icone ?? ICONES_OBJETIVO[0]);

  return (
    <form
      action={(formData) => executar(
        objetivo ? editarObjetivo : criarObjetivo,
        formData,
        objetivo ? "Objetivo atualizado." : "Objetivo criado.",
      )}
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      <RequestId />
      {objetivo && (
        <>
          <input type="hidden" name="goal_id" value={objetivo.id} />
          <input type="hidden" name="expected_version" value={objetivo.version} />
          <input type="hidden" name="saldo_atual" value={objetivo.saldo_atual} />
        </>
      )}
      <Field titulo="Nome">
        <input
          name="nome"
          required
          maxLength={100}
          defaultValue={objetivo?.nome}
          placeholder="Ex.: Reserva de emergência"
          className={inputClass()}
        />
      </Field>
      <Field titulo="Meta">
        <CurrencyInput name="meta_valor" required defaultValue={objetivo?.meta_valor} />
      </Field>
      {!objetivo && (
        <Field titulo="Saldo inicial">
          <CurrencyInput name="saldo_inicial" defaultValue={0} />
        </Field>
      )}
      <Field titulo="Data-meta (opcional)">
        <input
          type="date"
          name="data_prazo"
          defaultValue={objetivo?.data_prazo ?? ""}
          className={inputClass()}
        />
      </Field>
      <div className="lg:col-span-2"><Field titulo="Cor">
        <input type="hidden" name="cor" value={cor} />
        <div className="flex flex-wrap gap-2">
          {CORES_OBJETIVO.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Usar cor ${item}`}
              aria-pressed={cor === item}
              onClick={() => setCor(item)}
              className="ff-focus h-8 w-8 rounded-full border-2 border-surface shadow-sm transition duration-200 hover:scale-110"
              style={{
                backgroundColor: item,
                outline: cor === item ? "3px solid var(--color-foreground)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </Field></div>
      <div className="lg:col-span-2"><Field titulo="Ícone">
        <input type="hidden" name="icone" value={icone} />
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-7 lg:grid-cols-8">
          {ICONES_OBJETIVO.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Usar ícone ${item}`}
              aria-pressed={icone === item}
              onClick={() => setIcone(item)}
              data-selected={icone === item || undefined}
              className="ff-focus inline-flex aspect-square min-w-0 items-center justify-center rounded-xl border p-0 leading-none transition duration-150 hover:-translate-y-0.5"
              style={{
                borderColor: icone === item ? cor : "var(--border)",
                backgroundColor: icone === item ? `${cor}18` : "var(--surface-muted)",
                color: icone === item ? cor : "var(--foreground)",
                boxShadow: icone === item ? `inset 0 0 0 1px ${cor}, 0 7px 18px rgb(0 0 0 / 14%)` : "none",
              }}
            >
              <FinancialIcon name={item} size={20} />
            </button>
          ))}
        </div>
      </Field></div>
      {!objetivo && partnerName && (
        <label className="lg:col-span-2 flex cursor-pointer items-start gap-3 rounded-ff-sm border border-border bg-surface-muted p-3 text-sm text-foreground">
          <input type="checkbox" name="compartilhado" value="true" className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <strong className="block">Compartilhar com {partnerName}</strong>
            <span className="mt-0.5 block text-xs text-foreground-muted">Seu parceiro poderá acompanhar e movimentar este objetivo. Você continua sendo o titular.</span>
          </span>
        </label>
      )}
      <div className="flex gap-2 lg:col-span-2">
        <button
          disabled={pending}
          className="ff-focus rounded-full bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Salvando..." : objetivo ? "Salvar alterações" : "Criar objetivo"}
        </button>
        <button
          type="button"
          onClick={fechar}
          className="ff-focus rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground-muted transition hover:bg-surface-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function FormularioMovimento({
  objetivo,
  operacao,
  contas,
  pending,
  executar,
}: {
  objetivo: ObjetivoComPrevisao;
  operacao: "guardar" | "resgatar";
  contas: Conta[];
  pending: boolean;
  executar: Executar;
}) {
  const [frequencia, setFrequencia] = useState("unica");
  const hoje = hojeEmSaoPaulo();

  return (
    <form
      action={(formData) => executar(
        movimentarObjetivo,
        formData,
        operacao === "guardar" ? "Valor guardado com sucesso." : "Resgate realizado com sucesso.",
      )}
      className="grid gap-4 sm:grid-cols-2"
    >
      <RequestId />
      <input type="hidden" name="goal_id" value={objetivo.id} />
      <input type="hidden" name="operation" value={operacao} />
      <Field titulo="Conta">
        <select name="account_id" required defaultValue="" className={inputClass()}>
          <option value="" disabled>Selecione a conta</option>
          {contas.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome}</option>)}
        </select>
      </Field>
      <Field titulo="Valor">
        <CurrencyInput name="value" required />
      </Field>
      <Field titulo="Descrição">
        <input name="description" maxLength={100} placeholder="Opcional" className={inputClass()} />
      </Field>
      <Field titulo={frequencia === "unica" ? "Data realizada" : "Primeira ocorrência"}>
        <input
          type="date"
          name="date"
          required
          max={frequencia === "unica" ? hoje : undefined}
          defaultValue={hoje}
          className={inputClass()}
        />
      </Field>
      <Field titulo="Frequência">
        <select
          name="frequency"
          value={frequencia}
          onChange={(event) => setFrequencia(event.target.value)}
          className={inputClass()}
        >
          <option value="unica">Única (realizada agora)</option>
          <option value="semanal">Semanal (agendada)</option>
          <option value="mensal">Mensal (agendada)</option>
          <option value="anual">Anual (agendada)</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        {operacao === "resgatar" && (
          <p data-private-value="true" className="mb-2 text-xs font-semibold text-orange">
            Disponível agora: {formatarReais(Number(objetivo.saldo_atual))}. Cada resgate agendado será validado quando for realizado.
          </p>
        )}
        {frequencia !== "unica" && (
          <p className="mb-3 text-xs text-foreground-muted">
            O FinFlow mantém automaticamente uma janela de cinco anos de agendamentos. O saldo muda somente quando cada ocorrência for concluída.
          </p>
        )}
        <button
          disabled={pending || contas.length === 0}
          className="ff-focus rounded-full bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Processando..." : "Confirmar"}
        </button>
      </div>
    </form>
  );
}

export default function ObjetivosManager({
  objetivos,
  contas,
  userId,
  partnerName,
}: {
  objetivos: ObjetivoComPrevisao[];
  contas: Conta[];
  userId: string;
  partnerName: string | null;
}) {
  const [painel, setPainel] = useState<Painel>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{
    id: number;
    acao: "archive_goal" | "delete_goal";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const ativos = objetivos.filter((item) => !item.arquivado);
  const arquivados = objetivos.filter((item) => item.arquivado);
  const totalGuardado = ativos.reduce((total, item) => total + Number(item.saldo_atual), 0);
  const previstoFimAno = ativos.reduce((total, item) => total + Number(item.previstoFimAno), 0);
  const atingidos = ativos.filter((item) => Number(item.saldo_atual) >= Number(item.meta_valor)).length;

  function executar(acao: Acao, formData: FormData, sucesso: string) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const resultado = await acao(formData);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setPainel(null);
      setConfirmar(null);
      setAviso(sucesso);
    });
  }

  function abrirPainel(proximo: Exclude<Painel, null>) {
    setErro(null);
    setAviso(null);
    setPainel(proximo);
  }

  const painelTitulo = painel?.tipo === "novo"
    ? "Novo objetivo"
    : painel?.tipo === "editar"
      ? "Editar objetivo"
      : painel?.tipo === "historico"
        ? `Histórico · ${painel.objetivo.nome}`
        : painel?.tipo === "movimentar"
          ? `${painel.operacao === "guardar" ? "Guardar em" : "Resgatar de"} ${painel.objetivo.nome}`
          : "";

  return (
    <div className="mx-auto max-w-7xl">
      <header className="ff-page-hero mb-6 px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="absolute bottom-0 right-8 flex h-32 items-end gap-2 opacity-20"><span className="h-8 w-7 rounded-t-lg bg-mint" /><span className="h-14 w-7 rounded-t-lg bg-mint" /><span className="h-20 w-7 rounded-t-lg bg-mint" /><span className="h-28 w-7 rounded-t-lg bg-mint" /></div>
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Planejamento financeiro</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Objetivos</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/72">Transforme planos em progresso visível e movimente cada reserva com segurança.</p>
          </div>
          <button
            type="button"
            onClick={() => abrirPainel({ tipo: "novo" })}
            className="ff-focus self-start rounded-full bg-white px-5 py-3 text-sm font-extrabold text-[#075348] shadow-xl transition hover:-translate-y-0.5 hover:bg-mint"
          >
            + Novo objetivo
          </button>
        </div>
        <div className="relative mt-6 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4 backdrop-blur-sm"><p className="text-[10px] font-extrabold uppercase tracking-wider text-white/60">Total guardado</p><p data-private-value="true" className="mt-1 text-2xl font-black">{formatarReais(totalGuardado)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4 backdrop-blur-sm"><p className="text-[10px] font-extrabold uppercase tracking-wider text-white/60">Previsto no fim do ano</p><p data-private-value="true" className="mt-1 text-xl font-black text-mint">{formatarReais(previstoFimAno)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4 backdrop-blur-sm"><p className="text-[10px] font-extrabold uppercase tracking-wider text-white/60">Metas alcançadas</p><p className="mt-1 text-xl font-black">{atingidos} <span className="text-sm font-bold text-white/55">de {ativos.length}</span></p></div>
        </div>
      </header>

      {(erro || aviso) && (
        <div
          role="status"
          className={`mb-4 rounded-ff-md border px-4 py-3 text-sm font-semibold ${
            erro ? "border-red/40 bg-red/10 text-red" : "border-primary/40 bg-primary-soft text-primary-dark"
          }`}
        >
          {erro || aviso}
        </div>
      )}

      {painel && painel.tipo !== "historico" && (
        <ObjectiveActionModal title={painelTitulo} pending={pending} onClose={() => setPainel(null)}>
          {erro && (
            <p role="alert" className="mb-4 rounded-ff-sm border border-red/40 bg-red/10 px-4 py-3 text-sm font-semibold text-red">
              {erro}
            </p>
          )}
          {painel.tipo === "novo" && (
            <FormularioObjetivo pending={pending} executar={executar} fechar={() => setPainel(null)} partnerName={partnerName} />
          )}
          {painel.tipo === "editar" && (
            <div>
              <FormularioObjetivo objetivo={painel.objetivo} pending={pending} executar={executar} fechar={() => setPainel(null)} partnerName={partnerName} />
              <div className="mt-6 border-t border-border pt-5">
                {confirmar?.id === painel.objetivo.id ? <div role="alert" className={`rounded-xl border p-4 text-sm ${confirmar.acao === "delete_goal" ? "border-red/30 bg-red/10" : "border-orange/30 bg-orange/10"}`}><p className="mb-3 font-semibold text-foreground">{confirmar.acao === "delete_goal" ? "Excluir? Se houver saldo ou agendamentos, o objetivo será arquivado e o histórico preservado." : "Arquivar este objetivo?"}</p><div className="flex gap-2"><form action={(formData) => executar(alterarEstadoObjetivo, formData, "Objetivo atualizado.")}><RequestId /><input type="hidden" name="goal_id" value={painel.objetivo.id} /><input type="hidden" name="operacao" value={confirmar.acao} /><button disabled={pending} className={`min-h-11 rounded-full px-6 py-3 font-extrabold text-white ${confirmar.acao === "delete_goal" ? "bg-red" : "bg-orange"}`}>Confirmar</button></form><button type="button" onClick={() => setConfirmar(null)} className="min-h-11 rounded-full border border-border px-6 py-3 font-bold text-foreground-muted">Cancelar</button></div></div> : <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setConfirmar({ id: painel.objetivo.id, acao: "archive_goal" })} className="ff-focus flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface-muted px-5 py-3 text-sm font-bold text-foreground-muted"><GoalActionIcon action="archive" /> Arquivar objetivo</button><button type="button" onClick={() => setConfirmar({ id: painel.objetivo.id, acao: "delete_goal" })} className="ff-focus flex min-h-12 items-center justify-center gap-2 rounded-xl border border-red/30 bg-red/10 px-5 py-3 text-sm font-bold text-red"><GoalActionIcon action="delete" /> Excluir objetivo</button></div>}
              </div>
            </div>
          )}
          {painel.tipo === "movimentar" && (
            <FormularioMovimento
              objetivo={painel.objetivo}
              operacao={painel.operacao}
              contas={contas}
              pending={pending}
              executar={executar}
            />
          )}
        </ObjectiveActionModal>
      )}

      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold text-foreground">Seus objetivos</h2><span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-bold text-foreground-muted">{ativos.length} {ativos.length === 1 ? "ativo" : "ativos"}</span></div>
      <div className="grid gap-4 xl:grid-cols-2">
        {ativos.map((objetivo) => {
          const meta = Math.max(Number(objetivo.meta_valor), 0.01);
          const percentual = Math.min(100, Math.max(0, Number(objetivo.saldo_atual) / meta * 100));
          const proprio = objetivo.user_id === userId;
          const previsaoMetaAbaixo = objetivo.previstoMeta !== null && objetivo.previstoMeta < meta;
          const historicoAberto = painel?.tipo === "historico" && painel.objetivo.id === objetivo.id;
          return (
            <article key={objetivo.id} className="group relative overflow-hidden rounded-[20px] border border-border bg-surface p-4 shadow-[0_14px_38px_rgba(0,0,0,0.07)] transition duration-300 hover:border-primary/25 hover:shadow-[0_18px_44px_rgba(0,0,0,0.11)]">
              <div aria-hidden="true" className="absolute -right-16 -top-20 h-44 w-44 rounded-full opacity-[0.08] blur-2xl transition group-hover:opacity-[0.14]" style={{ backgroundColor: objetivo.cor }} />
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="relative flex min-w-0 gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/5 text-xl shadow-sm" style={{ backgroundColor: `${objetivo.cor}22`, color: objetivo.cor }}>
                    <FinancialIcon name={objetivo.icone} size={22} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-extrabold text-foreground">{objetivo.nome}</h2>
                    {objetivo.data_prazo && <p className="text-xs text-foreground-muted">Meta para {formatarData(objetivo.data_prazo)}</p>}
                  </div>
                </div>
                {proprio ? (
                  <button type="button" onClick={() => abrirPainel({ tipo: "editar", objetivo })} className="ff-focus relative rounded-full bg-surface-muted px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-primary-soft hover:text-primary">
                    Editar
                  </button>
                ) : (
                  <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-bold text-primary-dark">Compartilhado</span>
                )}
              </div>
              <div className="relative mb-2 mt-4 flex items-end justify-between gap-3 rounded-xl bg-surface-muted p-3">
                <div><span className="block text-[10px] font-extrabold uppercase tracking-[.12em] text-foreground-muted">Guardado</span><strong data-private-value="true" className="text-2xl font-black tracking-tight text-foreground">{formatarReais(Number(objetivo.saldo_atual))}</strong></div>
                <div className="text-right"><strong className="block text-sm text-foreground">{Math.round(percentual)}%</strong><span className="text-[11px] text-foreground-muted">Meta {formatarReais(meta)}</span></div>
              </div>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${percentual}%`, backgroundColor: objetivo.cor }} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-foreground-muted">
                {objetivo.previstoMeta !== null && (
                  <span className="rounded-lg border border-border bg-surface-muted px-3 py-2"
                    data-private-value="true"
                    aria-label={`Previsão na data-meta: ${formatarReais(objetivo.previstoMeta)}${previsaoMetaAbaixo ? ", abaixo da meta" : ""}`}
                  >
                    <small className="block text-[10px] uppercase tracking-wide">Na data-meta</small>
                    <strong className={previsaoMetaAbaixo ? "text-red" : "text-foreground-muted"}>
                      {formatarReais(objetivo.previstoMeta)}
                    </strong>
                    {previsaoMetaAbaixo && <span className="block text-[10px] text-red">Abaixo da meta</span>}
                  </span>
                )}
                <span data-private-value="true" className="rounded-lg border border-border bg-surface-muted px-3 py-2"><small className="block text-[10px] uppercase tracking-wide">Fim do ano</small><strong className="text-foreground">{formatarReais(objetivo.previstoFimAno)}</strong></span>
              </div>
              <div role="group" aria-label={`Ações do objetivo ${objetivo.nome}`} className="relative mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button type="button" aria-haspopup="dialog" onClick={() => abrirPainel({ tipo: "movimentar", objetivo, operacao: "guardar" })} className="ff-focus flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(22,150,110,0.2)] transition hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-[0_12px_24px_rgba(22,150,110,0.26)]">
                  <GoalActionIcon action="save" /> Guardar
                </button>
                <button type="button" aria-haspopup="dialog" onClick={() => abrirPainel({ tipo: "movimentar", objetivo, operacao: "resgatar" })} className="ff-focus flex min-h-11 items-center justify-center gap-2 rounded-xl border border-orange/35 bg-orange/10 px-3 py-2.5 text-xs font-extrabold text-orange transition hover:-translate-y-0.5 hover:border-orange/55 hover:bg-orange/15">
                  <GoalActionIcon action="withdraw" /> Resgatar
                </button>
                <button type="button" aria-expanded={historicoAberto} onClick={() => historicoAberto ? setPainel(null) : abrirPainel({ tipo: "historico", objetivo })} className="ff-focus flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-xs font-extrabold text-foreground transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary-soft hover:text-primary">
                  <GoalActionIcon action="history" /> Histórico
                </button>
              </div>
              {historicoAberto && (
                <section className="relative mt-4 border-t border-border pt-4" aria-label={`Histórico realizado de ${objetivo.nome}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-extrabold text-foreground">Histórico realizado</h3>
                    <button type="button" onClick={() => setPainel(null)} className="ff-focus text-xs font-bold text-foreground-muted transition hover:text-primary">Fechar</button>
                  </div>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {objetivo.movimentos.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{item.descricao}</p>
                          <p className="text-xs text-foreground-muted">{formatarData(item.data)} · Realizado</p>
                        </div>
                        <p data-private-value="true" className={`font-extrabold ${item.operacao === "guardar" ? "text-primary" : "text-orange"}`}>
                          {item.operacao === "guardar" ? "+" : "−"}{formatarReais(item.valor)}
                        </p>
                      </div>
                    ))}
                    {objetivo.movimentos.length === 0 && (
                      <p className="rounded-xl bg-surface-muted px-3 py-4 text-sm text-foreground-muted">Ainda não há movimentações realizadas neste objetivo.</p>
                    )}
                  </div>
                </section>
              )}
              {proprio && partnerName && (
                <form
                  action={(formData) => executar(
                    alterarCompartilhamentoObjetivo,
                    formData,
                    objetivo.compartilhado ? "Objetivo agora é privado." : "Objetivo compartilhado com seu parceiro.",
                  )}
                  className="mt-3 rounded-ff-sm border border-border bg-surface-muted p-3"
                >
                  <RequestId key={`sharing-${objetivo.id}-${objetivo.version}-${objetivo.compartilhado}`} />
                  <input type="hidden" name="goal_id" value={objetivo.id} />
                  <input type="hidden" name="expected_version" value={objetivo.version ?? 1} />
                  <input type="hidden" name="shared" value={objetivo.compartilhado ? "false" : "true"} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{objetivo.compartilhado ? `Visível para ${partnerName}` : "Objetivo privado"}</p>
                      <p className="mt-0.5 text-xs text-foreground-muted">{objetivo.compartilhado ? "Somente o titular pode retirar o compartilhamento." : "Compartilhe apenas o objetivo que deseja acompanhar em conjunto."}</p>
                    </div>
                    <button disabled={pending} className={`rounded-ff-sm px-3 py-2 text-xs font-bold disabled:opacity-50 ${objetivo.compartilhado ? "border border-border bg-surface text-foreground" : "bg-primary text-white"}`}>
                      {pending ? "Salvando..." : objetivo.compartilhado ? "Tornar privado" : `Compartilhar com ${partnerName}`}
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
      </div>

      {ativos.length === 0 && (
        <div className="rounded-[22px] border border-dashed border-border p-10 text-center text-sm text-foreground-muted">
          <span aria-hidden="true" className="text-3xl text-primary">◎</span><h2 className="mt-2 font-extrabold text-foreground">Seu primeiro objetivo começa aqui</h2><p className="mt-1">Crie uma meta para começar a guardar.</p>
        </div>
      )}

      {arquivados.length > 0 && (
        <details className="group/archive mt-6 rounded-[22px] border border-border bg-surface p-4 shadow-sm">
          <summary className="ff-focus flex cursor-pointer list-none items-center justify-between font-bold text-foreground"><span>Objetivos arquivados ({arquivados.length})</span><span className="text-primary transition group-open/archive:rotate-180">⌄</span></summary>
          <div className="mt-3 space-y-2">
            {arquivados.map((objetivo) => (
              <div key={objetivo.id} className="rounded-ff-sm bg-surface-muted px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-semibold text-foreground"><FinancialIcon name={objetivo.icone} size={18} /> {objetivo.nome}</span>
                  {objetivo.user_id === userId ? <div className="flex items-center gap-3">
                    {objetivo.compartilhado && partnerName && (
                      <form action={(formData) => executar(alterarCompartilhamentoObjetivo, formData, "Objetivo agora é privado.")}>
                        <RequestId key={`archived-sharing-${objetivo.id}-${objetivo.version}-${objetivo.compartilhado}`} />
                        <input type="hidden" name="goal_id" value={objetivo.id} />
                        <input type="hidden" name="expected_version" value={objetivo.version ?? 1} />
                        <input type="hidden" name="shared" value="false" />
                        <button disabled={pending} className="text-xs font-bold text-foreground-muted">Tornar privado</button>
                      </form>
                    )}
                    <form action={(formData) => executar(alterarEstadoObjetivo, formData, "Objetivo reativado.")}>
                      <RequestId />
                      <input type="hidden" name="goal_id" value={objetivo.id} />
                      <input type="hidden" name="operacao" value="reactivate_goal" />
                      <button disabled={pending} className="text-xs font-bold text-primary">Reativar</button>
                    </form>
                  </div> : <span className="text-xs font-bold text-foreground-muted">Compartilhado</span>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
