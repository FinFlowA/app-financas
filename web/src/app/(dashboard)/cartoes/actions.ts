"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { traduzirErro } from "@/lib/error-messages";

const CORES_DISPONIVEIS = ["#457B9D", "#16966E", "#F28A55", "#805AD5", "#EE6B63", "#6D597A"];

type Resultado = { erro: string | null };

export async function criarCartao(formData: FormData): Promise<Resultado> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: "Sua sessão expirou. Entre novamente." };

  const nome = String(formData.get("nome") ?? "").trim();
  const limite = Number(String(formData.get("limite") ?? "").replace(",", "."));
  const diaVencimento = Number(formData.get("dia_vencimento"));
  const diaFechamento = Number(formData.get("dia_fechamento"));
  const cor = String(formData.get("cor") ?? CORES_DISPONIVEIS[0]);

  if (!nome) return { erro: "Dê um nome para o cartão." };
  if (!Number.isFinite(limite) || limite <= 0) return { erro: "Informe um limite válido." };
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    return { erro: "Dia de vencimento inválido (use de 1 a 31)." };
  }
  if (!Number.isInteger(diaFechamento) || diaFechamento < 1 || diaFechamento > 31) {
    return { erro: "Dia de fechamento inválido (use de 1 a 31)." };
  }
  if (!CORES_DISPONIVEIS.includes(cor)) return { erro: "Cor inválida." };

  const { error } = await supabase.from("cartoes").insert([{
    nome,
    limite,
    dia_vencimento: diaVencimento,
    dia_fechamento: diaFechamento,
    cor,
    user_id: user.id,
    ativo: true,
  }]);

  if (error) return { erro: "Não foi possível criar o cartão. Tente novamente." };

  revalidatePath("/cartoes");
  return { erro: null };
}

export async function criarCompra(formData: FormData): Promise<Resultado> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: "Sua sessão expirou. Entre novamente." };

  const cardId = Number(formData.get("card_id"));
  const categoryId = Number(formData.get("category_id"));
  const descricao = String(formData.get("description") ?? "").trim();
  const value = Number(String(formData.get("value") ?? "").replace(",", "."));
  const purchaseDate = String(formData.get("purchase_date") ?? "").trim();

  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { erro: "Selecione uma categoria." };
  if (!descricao) return { erro: "Descreva a compra." };
  if (!Number.isFinite(value) || value <= 0) return { erro: "Informe um valor válido." };
  if (!purchaseDate) return { erro: "Informe a data da compra." };

  const { data, error } = await supabase.rpc("execute_offline_financial_action", {
    p_action_type: "create_card_purchase",
    p_payload: {
      card_id: cardId,
      category_id: categoryId,
      description: descricao,
      value,
      purchase_date: purchaseDate,
      frequency: "unica",
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

  revalidatePath("/cartoes");
  return { erro: null };
}

export async function pagarFatura(formData: FormData): Promise<Resultado> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: "Sua sessão expirou. Entre novamente." };

  const cardId = Number(formData.get("card_id"));
  const invoiceMonth = String(formData.get("invoice_month") ?? "").trim();
  const accountId = Number(formData.get("account_id"));
  const paymentAmount = Number(String(formData.get("payment_amount") ?? "").replace(",", "."));

  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!/^\d{4}-\d{2}$/.test(invoiceMonth)) return { erro: "Mês de fatura inválido." };
  if (!Number.isInteger(accountId) || accountId <= 0) return { erro: "Selecione uma conta." };
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return { erro: "Informe um valor válido." };

  const { data, error } = await supabase.rpc("finance_pay_invoice", {
    p_card_id: cardId,
    p_invoice_month: invoiceMonth,
    p_account_id: accountId,
    p_payment_amount: paymentAmount,
    p_remainder_mode: "full",
    p_interest_value: null,
    p_interest_percent: null,
    p_request_id: crypto.randomUUID(),
  });

  if (error) return { erro: traduzirErro(error.message) };
  if (data && typeof data === "object" && "ok" in data && data.ok === false) {
    const codigo = "error_code" in data && typeof data.error_code === "string" ? data.error_code : "UNKNOWN";
    return { erro: traduzirErro(codigo) };
  }

  revalidatePath("/cartoes");
  revalidatePath("/");
  revalidatePath("/transacoes");
  return { erro: null };
}

export { CORES_DISPONIVEIS };
