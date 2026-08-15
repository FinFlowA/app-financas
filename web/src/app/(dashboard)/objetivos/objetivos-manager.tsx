"use client";

import { useState, useTransition } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { hojeEmSaoPaulo } from "@/lib/date";
import { formatarData, formatarReais } from "@/lib/format";
import type { Caixinha, Conta } from "@/lib/types";
import {
  alterarCompartilhamentoObjetivo,
  alterarEstadoObjetivo,
  CORES_OBJETIVO,
  criarObjetivo,
  editarObjetivo,
  ICONES_OBJETIVO,
  movimentarObjetivo,
} from "./actions";

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

function RequestId({ name = "request_id" }: { name?: string }) {
  const [id] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={name} value={id} />;
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
  return "w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary";
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
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
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
      <Field titulo="Cor">
        <input type="hidden" name="cor" value={cor} />
        <div className="flex flex-wrap gap-2">
          {CORES_OBJETIVO.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Usar cor ${item}`}
              aria-pressed={cor === item}
              onClick={() => setCor(item)}
              className="h-8 w-8 rounded-full"
              style={{
                backgroundColor: item,
                outline: cor === item ? "3px solid var(--color-foreground)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </Field>
      <Field titulo="Ícone">
        <input type="hidden" name="icone" value={icone} />
        <div className="flex flex-wrap gap-2">
          {ICONES_OBJETIVO.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Usar ícone ${item}`}
              aria-pressed={icone === item}
              onClick={() => setIcone(item)}
              className={`h-10 w-10 rounded-ff-sm border text-lg ${
                icone === item ? "border-primary bg-primary-soft" : "border-border"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </Field>
      {!objetivo && partnerName && (
        <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-ff-sm border border-border bg-surface-muted p-3 text-sm text-foreground">
          <input type="checkbox" name="compartilhado" value="true" className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <strong className="block">Compartilhar com {partnerName}</strong>
            <span className="mt-0.5 block text-xs text-foreground-muted">Seu parceiro poderá acompanhar e movimentar este objetivo. Você continua sendo o titular.</span>
          </span>
        </label>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button
          disabled={pending}
          className="rounded-ff-sm bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? "Salvando..." : objetivo ? "Salvar alterações" : "Criar objetivo"}
        </button>
        <button
          type="button"
          onClick={fechar}
          className="rounded-ff-sm px-4 py-2.5 text-sm font-semibold text-foreground-muted"
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
  const limite = frequencia === "semanal" ? 260 : frequencia === "mensal" ? 60 : 5;
  const ocorrenciasPadrao = frequencia === "anual" ? 5 : 12;
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
      <Field titulo="Ocorrências">
        <input
          key={frequencia}
          name="recurrence_count"
          type="number"
          min={2}
          max={limite}
          defaultValue={ocorrenciasPadrao}
          disabled={frequencia === "unica"}
          required={frequencia !== "unica"}
          className={`${inputClass()} disabled:opacity-50`}
        />
      </Field>
      <div className="sm:col-span-2">
        {operacao === "resgatar" && (
          <p data-private-value="true" className="mb-2 text-xs font-semibold text-orange">
            Disponível agora: {formatarReais(Number(objetivo.saldo_atual))}. Cada resgate agendado será validado quando for realizado.
          </p>
        )}
        {frequencia !== "unica" && (
          <p className="mb-3 text-xs text-foreground-muted">
            A recorrência cria agendamentos pendentes. O saldo muda somente quando cada ocorrência for concluída.
          </p>
        )}
        <button
          disabled={pending || contas.length === 0}
          className="rounded-ff-sm bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
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
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">Planejamento financeiro</p>
          <h1 className="text-2xl font-extrabold text-foreground">Objetivos</h1>
        </div>
        <button
          onClick={() => { setPainel({ tipo: "novo" }); setErro(null); setAviso(null); }}
          className="rounded-ff-md bg-primary px-4 py-2.5 text-sm font-bold text-white"
        >
          + Novo objetivo
        </button>
      </div>

      <section className="mb-6 rounded-ff-lg border border-border bg-gradient-to-br from-primary-dark to-primary p-5 text-white">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase opacity-75">Total guardado</p>
            <p data-private-value="true" className="mt-1 text-2xl font-black">{formatarReais(totalGuardado)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase opacity-75">Previsto no fim do ano</p>
            <p data-private-value="true" className="mt-1 text-xl font-extrabold">{formatarReais(previstoFimAno)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase opacity-75">Metas alcançadas</p>
            <p className="mt-1 text-xl font-extrabold">{atingidos} de {ativos.length}</p>
          </div>
        </div>
      </section>

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

      {painel && (
        <section
          key={`${painel.tipo}-${"objetivo" in painel ? painel.objetivo.id : "novo"}`}
          className="mb-6 rounded-ff-lg border border-primary/40 bg-surface p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-foreground">{painelTitulo}</h2>
            <button onClick={() => setPainel(null)} aria-label="Fechar" className="rounded-full bg-surface-muted px-3 py-1.5 text-foreground">×</button>
          </div>
          {painel.tipo === "novo" && (
            <FormularioObjetivo pending={pending} executar={executar} fechar={() => setPainel(null)} partnerName={partnerName} />
          )}
          {painel.tipo === "editar" && (
            <FormularioObjetivo objetivo={painel.objetivo} pending={pending} executar={executar} fechar={() => setPainel(null)} partnerName={partnerName} />
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
          {painel.tipo === "historico" && (
            <div className="space-y-2">
              {painel.objetivo.movimentos.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ff-sm bg-surface-muted px-3 py-3">
                  <div>
                    <p className="font-semibold text-foreground">{item.descricao}</p>
                    <p className="text-xs text-foreground-muted">
                      {formatarData(item.data)} · {item.status === "paga" ? "Realizado" : "Pendente"}
                    </p>
                  </div>
                  <p data-private-value="true" className={`font-extrabold ${item.operacao === "guardar" ? "text-primary" : "text-orange"}`}>
                    {item.operacao === "guardar" ? "+" : "−"}{formatarReais(item.valor)}
                  </p>
                </div>
              ))}
              {painel.objetivo.movimentos.length === 0 && (
                <p className="text-sm text-foreground-muted">Ainda não há movimentações neste objetivo.</p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {ativos.map((objetivo) => {
          const meta = Math.max(Number(objetivo.meta_valor), 0.01);
          const percentual = Math.min(100, Math.max(0, Number(objetivo.saldo_atual) / meta * 100));
          const proprio = objetivo.user_id === userId;
          return (
            <article key={objetivo.id} className="rounded-ff-lg border border-border bg-surface p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl" style={{ backgroundColor: `${objetivo.cor}22` }}>
                    {objetivo.icone}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-extrabold text-foreground">{objetivo.nome}</h2>
                    {objetivo.data_prazo && <p className="text-xs text-foreground-muted">Meta para {formatarData(objetivo.data_prazo)}</p>}
                  </div>
                </div>
                {proprio ? (
                  <button onClick={() => setPainel({ tipo: "editar", objetivo })} className="rounded-ff-sm bg-surface-muted px-3 py-1.5 text-xs font-bold text-foreground">
                    Editar
                  </button>
                ) : (
                  <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-bold text-primary-dark">Compartilhado</span>
                )}
              </div>
              <div className="mb-1 flex items-baseline justify-between">
                <strong data-private-value="true" className="text-xl text-foreground">{formatarReais(Number(objetivo.saldo_atual))}</strong>
                <span className="text-xs text-foreground-muted">de {formatarReais(meta)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full" style={{ width: `${percentual}%`, backgroundColor: objetivo.cor }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-foreground-muted">
                {objetivo.previstoMeta !== null && <span data-private-value="true">Na data-meta: {formatarReais(objetivo.previstoMeta)}</span>}
                <span data-private-value="true">Fim do ano: {formatarReais(objetivo.previstoFimAno)}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button onClick={() => setPainel({ tipo: "movimentar", objetivo, operacao: "guardar" })} className="rounded-ff-sm bg-primary-soft py-2 text-xs font-bold text-primary-dark">Guardar</button>
                <button onClick={() => setPainel({ tipo: "movimentar", objetivo, operacao: "resgatar" })} className="rounded-ff-sm border border-border py-2 text-xs font-bold text-foreground">Resgatar</button>
                <button onClick={() => setPainel({ tipo: "historico", objetivo })} className="rounded-ff-sm border border-border py-2 text-xs font-bold text-foreground">Histórico</button>
              </div>
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
              {proprio && <div className="mt-3 border-t border-border pt-3">
                {confirmar?.id === objetivo.id ? (
                  <div className="rounded-ff-sm bg-surface-muted p-3 text-xs">
                    <p className="mb-2 font-semibold text-foreground">
                      {confirmar.acao === "delete_goal"
                        ? "Excluir? Se houver saldo ou agendamentos, o objetivo será arquivado e o histórico preservado."
                        : "Arquivar este objetivo?"}
                    </p>
                    <div className="flex gap-3">
                      <form action={(formData) => executar(alterarEstadoObjetivo, formData, "Objetivo atualizado.")}>
                        <RequestId />
                        <input type="hidden" name="goal_id" value={objetivo.id} />
                        <input type="hidden" name="operacao" value={confirmar.acao} />
                        <button disabled={pending} className="font-bold text-red">Confirmar</button>
                      </form>
                      <button onClick={() => setConfirmar(null)} className="font-bold text-foreground-muted">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setConfirmar({ id: objetivo.id, acao: "archive_goal" })} className="text-xs font-semibold text-foreground-muted">Arquivar</button>
                    <button onClick={() => setConfirmar({ id: objetivo.id, acao: "delete_goal" })} className="text-xs font-semibold text-red">Excluir</button>
                  </div>
                )}
              </div>}
            </article>
          );
        })}
      </div>

      {ativos.length === 0 && (
        <div className="rounded-ff-lg border border-dashed border-border p-8 text-center text-sm text-foreground-muted">
          Crie seu primeiro objetivo para começar a guardar.
        </div>
      )}

      {arquivados.length > 0 && (
        <details className="mt-6 rounded-ff-lg border border-border bg-surface p-4">
          <summary className="cursor-pointer font-bold text-foreground">Objetivos arquivados ({arquivados.length})</summary>
          <div className="mt-3 space-y-2">
            {arquivados.map((objetivo) => (
              <div key={objetivo.id} className="rounded-ff-sm bg-surface-muted px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-foreground">{objetivo.icone} {objetivo.nome}</span>
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
