"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { traduzirErro } from "@/lib/error-messages";

const CORES_DISPONIVEIS = [
  "#16966E",
  "#4D76E8",
  "#F28A55",
  "#805AD5",
  "#EE6B63",
  "#56D39B",
];

export type ResultadoCriarObjetivo = { erro: string | null };

export async function criarObjetivo(formData: FormData): Promise<ResultadoCriarObjetivo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: "Sua sessão expirou. Entre novamente." };

  const nome = String(formData.get("nome") ?? "").trim();
  const metaValor = Number(String(formData.get("meta_valor") ?? "").replace(",", "."));
  const dataPrazo = String(formData.get("data_prazo") ?? "").trim();
  const cor = String(formData.get("cor") ?? CORES_DISPONIVEIS[0]);
  const icone = String(formData.get("icone") ?? "🎯");

  if (!nome) return { erro: "Dê um nome para o objetivo." };
  if (!Number.isFinite(metaValor) || metaValor <= 0) return { erro: "Informe uma meta válida." };
  if (!CORES_DISPONIVEIS.includes(cor)) return { erro: "Cor inválida." };

  const { error } = await supabase.from("caixinhas").insert([{
    nome,
    meta_valor: metaValor,
    saldo_atual: 0,
    cor,
    icone,
    user_id: user.id,
    compartilhado: false,
    data_prazo: dataPrazo || null,
  }]);

  if (error) return { erro: "Não foi possível criar o objetivo. Tente novamente." };

  revalidatePath("/objetivos");
  return { erro: null };
}

export { CORES_DISPONIVEIS };

export type ResultadoMovimentoObjetivo = { erro: string | null };

/**
 * Guarda ou resgata dinheiro de um objetivo reutilizando a mesma RPC atômica
 * (public.execute_offline_financial_action, ação "move_goal") que a fila
 * offline e o assistente de IA já usam em produção: trava conta e objetivo,
 * revalida tudo no servidor e só grava se as duas escritas puderem ser
 * aplicadas juntas — nunca duplica nem perde valor pela metade.
 */
export async function movimentarObjetivo(formData: FormData): Promise<ResultadoMovimentoObjetivo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: "Sua sessão expirou. Entre novamente." };

  const goalId = Number(formData.get("goal_id"));
  const accountId = Number(formData.get("account_id"));
  const operation = String(formData.get("operation") ?? "");
  const goalName = String(formData.get("goal_name") ?? "objetivo");
  const value = Number(String(formData.get("value") ?? "").replace(",", "."));

  if (!Number.isInteger(goalId) || goalId <= 0) return { erro: "Objetivo inválido." };
  if (!accountId || !Number.isInteger(accountId) || accountId <= 0) return { erro: "Selecione uma conta." };
  if (operation !== "guardar" && operation !== "resgatar") return { erro: "Operação inválida." };
  if (!Number.isFinite(value) || value <= 0) return { erro: "Informe um valor válido." };

  const hoje = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("execute_offline_financial_action", {
    p_action_type: "move_goal",
    p_payload: {
      operation,
      goal_id: goalId,
      account_id: accountId,
      value,
      description: operation === "guardar" ? `Guardar em: ${goalName}` : `Resgate de: ${goalName}`,
      realization_date: hoje,
    },
    p_idempotency_key: crypto.randomUUID(),
    p_expected_user_id: user.id,
    p_client_created_at: new Date().toISOString(),
  });

  if (error) return { erro: traduzirErro(error.message) };
  if (data && typeof data === "object" && "ok" in data && data.ok === false) {
    const codigo = "error_code" in data && typeof data.error_code === "string" ? data.error_code : "UNKNOWN";
    return { erro: traduzirErro(codigo) };
  }

  revalidatePath("/objetivos");
  revalidatePath("/");
  revalidatePath("/transacoes");
  return { erro: null };
}
