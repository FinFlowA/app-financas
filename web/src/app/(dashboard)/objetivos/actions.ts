"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
  setFinancialResourceSharing,
  type ActionResponse,
} from "@/lib/finance-action";
import { hojeEmSaoPaulo } from "@/lib/date";
import { moneyIsPositive, parseMoney } from "@/lib/money";

export const CORES_OBJETIVO = [
  "#16966E", "#4D76E8", "#F28A55", "#805AD5", "#EE6B63", "#56D39B",
] as const;

export const ICONES_OBJETIVO = ["🎯", "✈️", "🏠", "🚗", "🎓", "💻", "🏖️", "💍"] as const;

export type ResultadoObjetivo = ActionResponse;

function revalidarObjetivos() {
  revalidatePath("/objetivos");
  revalidatePath("/");
  revalidatePath("/transacoes");
  revalidatePath("/relatorios");
}

function resourceIdFromResult(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return null;
  const id = Number((result as Record<string, unknown>).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validarCor(cor: string): string {
  return CORES_OBJETIVO.includes(cor as (typeof CORES_OBJETIVO)[number]) ? cor : CORES_OBJETIVO[0];
}

function validarIcone(icone: string): string {
  return ICONES_OBJETIVO.includes(icone as (typeof ICONES_OBJETIVO)[number]) ? icone : ICONES_OBJETIVO[0];
}

function validarDataISO(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [ano, mes, dia] = value.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 12));
  return data.toISOString().slice(0, 10) === value;
}

export async function criarObjetivo(formData: FormData): Promise<ResultadoObjetivo> {
  const nome = formString(formData, "nome");
  const meta = parseMoney(formData.get("meta_valor"));
  const saldoInicialInformado = formString(formData, "saldo_inicial");
  const saldoInicial = saldoInicialInformado ? parseMoney(saldoInicialInformado) : 0;
  const dataPrazo = formString(formData, "data_prazo");
  const requestId = formString(formData, "request_id");
  const compartilhado = formString(formData, "compartilhado") === "true";

  if (!nome) return { erro: "Dê um nome para o objetivo." };
  if (!moneyIsPositive(meta)) return { erro: "Informe uma meta válida." };
  if (!Number.isFinite(saldoInicial) || saldoInicial < 0) return { erro: "Informe um saldo inicial válido." };
  if (saldoInicial > meta) return { erro: "O saldo inicial não pode ser maior que a meta." };
  if (dataPrazo && !validarDataISO(dataPrazo)) return { erro: "Informe uma data-meta válida." };

  const payload: Record<string, unknown> = {
    name: nome,
    target_amount: meta,
    initial_balance: saldoInicial,
    color: validarCor(formString(formData, "cor")),
    icon: validarIcone(formString(formData, "icone")),
  };
  if (dataPrazo) payload.target_date = dataPrazo;

  const resultado = await executeManualFinancialAction("create_goal", payload, requestId);
  if (!resultado.erro && compartilhado) {
    const goalId = resourceIdFromResult(resultado.data);
    if (!goalId) {
      revalidarObjetivos();
      return { erro: "O objetivo foi criado como privado, mas não foi possível identificá-lo para o compartilhamento." };
    }
    const sharing = await setFinancialResourceSharing("goal", goalId, true, 1);
    if (sharing.erro) {
      revalidarObjetivos();
      return { erro: `O objetivo foi criado como privado. ${sharing.erro}` };
    }
  }
  if (!resultado.erro) revalidarObjetivos();
  return resultado;
}

export async function editarObjetivo(formData: FormData): Promise<ResultadoObjetivo> {
  const goalId = formInteger(formData, "goal_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const nome = formString(formData, "nome");
  const meta = parseMoney(formData.get("meta_valor"));
  const saldoAtual = parseMoney(formData.get("saldo_atual"));
  const dataPrazo = formString(formData, "data_prazo");
  const requestId = formString(formData, "request_id");

  if (!Number.isInteger(goalId) || goalId <= 0 || !Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { erro: "Objetivo inválido. Atualize a página e tente novamente." };
  }
  if (!nome) return { erro: "Dê um nome para o objetivo." };
  if (!moneyIsPositive(meta)) return { erro: "Informe uma meta válida." };
  if (dataPrazo && !validarDataISO(dataPrazo)) return { erro: "Informe uma data-meta válida." };
  if (Number.isFinite(saldoAtual) && meta < saldoAtual) {
    return { erro: "A meta não pode ser menor que o valor já guardado." };
  }

  const resultado = await executeOptimisticUpdate("update_goal", {
    goal_id: goalId,
    expected_version: expectedVersion,
    changes: {
      name: nome,
      target_amount: meta,
      color: validarCor(formString(formData, "cor")),
      icon: validarIcone(formString(formData, "icone")),
      target_date: dataPrazo || null,
    },
  }, requestId);
  if (!resultado.erro) revalidarObjetivos();
  return resultado;
}

export async function alterarEstadoObjetivo(formData: FormData): Promise<ResultadoObjetivo> {
  const goalId = formInteger(formData, "goal_id");
  const operacao = formString(formData, "operacao");
  const requestId = formString(formData, "request_id");
  if (!Number.isInteger(goalId) || goalId <= 0) return { erro: "Objetivo inválido." };
  if (!["archive_goal", "delete_goal", "reactivate_goal"].includes(operacao)) {
    return { erro: "Operação inválida." };
  }
  const resultado = await executeManualFinancialAction(
    operacao as "archive_goal" | "delete_goal" | "reactivate_goal",
    { goal_id: goalId },
    requestId,
  );
  if (!resultado.erro) revalidarObjetivos();
  return resultado;
}

export async function alterarCompartilhamentoObjetivo(formData: FormData): Promise<ResultadoObjetivo> {
  const goalId = formInteger(formData, "goal_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const sharedValue = formString(formData, "shared");
  const requestId = formString(formData, "request_id");
  if (!Number.isSafeInteger(goalId) || goalId <= 0
    || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0
    || !["true", "false"].includes(sharedValue)) {
    return { erro: "Não foi possível validar o objetivo. Atualize a página e tente novamente." };
  }

  const resultado = await setFinancialResourceSharing(
    "goal",
    goalId,
    sharedValue === "true",
    expectedVersion,
    requestId,
  );
  if (!resultado.erro) revalidarObjetivos();
  return resultado;
}

export async function movimentarObjetivo(formData: FormData): Promise<ResultadoObjetivo> {
  const goalId = formInteger(formData, "goal_id");
  const accountId = formInteger(formData, "account_id");
  const operation = formString(formData, "operation");
  const description = formString(formData, "description");
  const value = parseMoney(formData.get("value"));
  const frequency = formString(formData, "frequency") || "unica";
  const recurrenceCount = formInteger(formData, "recurrence_count");
  const date = formString(formData, "date") || hojeEmSaoPaulo();
  const requestId = formString(formData, "request_id");

  if (!Number.isInteger(goalId) || goalId <= 0) return { erro: "Objetivo inválido." };
  if (!Number.isInteger(accountId) || accountId <= 0) return { erro: "Selecione uma conta." };
  if (operation !== "guardar" && operation !== "resgatar") return { erro: "Operação inválida." };
  if (!moneyIsPositive(value)) return { erro: "Informe um valor válido." };
  if (!["unica", "semanal", "mensal", "anual"].includes(frequency)) return { erro: "Frequência inválida." };
  if (!validarDataISO(date)) return { erro: "Informe uma data válida." };
  if (frequency === "unica" && date > hojeEmSaoPaulo()) {
    return { erro: "Um movimento realizado não pode ter data futura. Use uma recorrência para agendar." };
  }
  const recurrenceLimit = frequency === "semanal" ? 260 : frequency === "mensal" ? 60 : 5;
  if (frequency !== "unica" && (
    !Number.isInteger(recurrenceCount)
    || recurrenceCount < 2
    || recurrenceCount > recurrenceLimit
  )) {
    return { erro: `Use entre 2 e ${recurrenceLimit} ocorrências para esta frequência.` };
  }

  const payload: Record<string, unknown> = {
    operation,
    goal_id: goalId,
    account_id: accountId,
    value,
    description: description || (operation === "guardar" ? "Aporte" : "Resgate"),
    frequency,
  };
  if (frequency === "unica") payload.realization_date = date;
  else {
    payload.scheduled_date = date;
    payload.recurrence_count = recurrenceCount;
  }

  const resultado = await executeManualFinancialAction("move_goal", payload, requestId);
  if (!resultado.erro) revalidarObjetivos();
  return resultado;
}
