"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
  type ActionResponse,
} from "@/lib/finance-action";
import { moneyIsPositive, parseMoney } from "@/lib/money";

export const CORES_CARTAO = [
  "#457B9D", "#16966E", "#F28A55", "#805AD5", "#EE6B63", "#6D597A",
  "#3A86FF", "#8338EC", "#E9C46A", "#264653",
] as const;

export type ResultadoCartao = ActionResponse;

function revalidarCartoes(cardId?: number) {
  revalidatePath("/cartoes");
  if (cardId) revalidatePath(`/cartoes/${cardId}`);
  revalidatePath("/");
  revalidatePath("/transacoes");
  revalidatePath("/relatorios");
}

function validarDia(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function validarCor(value: string): string {
  return CORES_CARTAO.includes(value as (typeof CORES_CARTAO)[number]) ? value : CORES_CARTAO[0];
}

function validarDataISO(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [ano, mes, dia] = value.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 12));
  return data.toISOString().slice(0, 10) === value;
}

export async function criarCartao(formData: FormData): Promise<ResultadoCartao> {
  const nome = formString(formData, "nome");
  const limite = parseMoney(formData.get("limite"));
  const vencimento = formInteger(formData, "dia_vencimento");
  const fechamento = formInteger(formData, "dia_fechamento");
  if (!nome) return { erro: "Dê um nome para o cartão." };
  if (!moneyIsPositive(limite)) return { erro: "Informe um limite válido." };
  if (!validarDia(vencimento) || !validarDia(fechamento)) return { erro: "Use dias entre 1 e 31." };

  const resultado = await executeManualFinancialAction("create_card", {
    name: nome,
    value: limite,
    color: validarCor(formString(formData, "cor")),
    due_day: vencimento,
    closing_day: fechamento,
  }, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes();
  return resultado;
}

export async function editarCartao(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const nome = formString(formData, "nome");
  const limite = parseMoney(formData.get("limite"));
  const vencimento = formInteger(formData, "dia_vencimento");
  const fechamento = formInteger(formData, "dia_fechamento");
  if (!Number.isInteger(cardId) || cardId <= 0 || !Number.isInteger(expectedVersion) || expectedVersion <= 0) return { erro: "Cartão inválido." };
  if (!nome) return { erro: "Dê um nome para o cartão." };
  if (!moneyIsPositive(limite)) return { erro: "Informe um limite válido." };
  if (!validarDia(vencimento) || !validarDia(fechamento)) return { erro: "Use dias entre 1 e 31." };

  const resultado = await executeOptimisticUpdate("update_card", {
    card_id: cardId,
    expected_version: expectedVersion,
    changes: {
      name: nome,
      value: limite,
      color: validarCor(formString(formData, "cor")),
      due_day: vencimento,
      closing_day: fechamento,
    },
  }, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}

export async function alterarEstadoCartao(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const operacao = formString(formData, "operacao");
  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!["archive_card", "delete_card", "reactivate_card"].includes(operacao)) return { erro: "Operação inválida." };
  const resultado = await executeManualFinancialAction(
    operacao as "archive_card" | "delete_card" | "reactivate_card",
    { card_id: cardId },
    formString(formData, "request_id"),
  );
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}

export async function criarCompra(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const categoryId = formInteger(formData, "category_id");
  const description = formString(formData, "description");
  const informedValue = parseMoney(formData.get("value"));
  const purchaseDate = formString(formData, "purchase_date");
  const frequency = formString(formData, "frequency") || "unica";
  const installments = formInteger(formData, "installments");
  const valueMode = formString(formData, "value_mode") || "total";
  const recurrenceCount = formInteger(formData, "recurrence_count");

  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { erro: "Selecione uma categoria de despesa." };
  if (!description) return { erro: "Descreva a compra." };
  if (!moneyIsPositive(informedValue)) return { erro: "Informe um valor válido." };
  if (!validarDataISO(purchaseDate)) return { erro: "Informe uma data de compra válida." };
  if (!["unica", "parcelada", "mensal"].includes(frequency)) return { erro: "Tipo de compra inválido." };
  if (frequency === "parcelada" && (!Number.isInteger(installments) || installments < 2 || installments > 48)) {
    return { erro: "Use entre 2 e 48 parcelas." };
  }
  if (frequency === "parcelada" && !["total", "parcela"].includes(valueMode)) {
    return { erro: "Escolha como o valor parcelado foi informado." };
  }
  if (frequency === "mensal" && (!Number.isInteger(recurrenceCount) || recurrenceCount < 2 || recurrenceCount > 60)) {
    return { erro: "Use entre 2 e 60 cobranças mensais." };
  }

  const total = frequency === "parcelada" && valueMode === "parcela"
    ? Math.round(informedValue * installments * 100) / 100
    : informedValue;
  if (!moneyIsPositive(total)) return { erro: "O total da compra é inválido." };
  const payload: Record<string, unknown> = {
    card_id: cardId,
    category_id: categoryId,
    description,
    value: total,
    purchase_date: purchaseDate,
    frequency,
  };
  if (frequency === "parcelada") {
    payload.installments = installments;
    if (valueMode === "parcela") payload.installment_value = informedValue;
  }
  if (frequency === "mensal") payload.recurrence_count = recurrenceCount;

  const resultado = await executeManualFinancialAction("create_card_purchase", payload, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}

export async function editarCompra(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const purchaseId = formInteger(formData, "purchase_id");
  const description = formString(formData, "description");
  const oldDescription = formString(formData, "old_description");
  const categoryId = formInteger(formData, "category_id");
  const oldCategoryId = formInteger(formData, "old_category_id");
  const scope = formString(formData, "series_scope") === "open_series" ? "open_series" : "one";
  const requestId = formString(formData, "request_id");
  const categoryRequestId = formString(formData, "category_request_id");
  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!Number.isInteger(purchaseId) || purchaseId <= 0) return { erro: "Compra inválida." };
  if (!description) return { erro: "Informe a descrição." };
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { erro: "Selecione uma categoria." };

  if (description !== oldDescription) {
    const updateDescription = await executeManualFinancialAction("update_card_purchase", {
      purchase_id: purchaseId, field: "description", new_value: description, series_scope: scope,
    }, requestId);
    if (updateDescription.erro) return updateDescription;
  }
  if (categoryId !== oldCategoryId) {
    const updateCategory = await executeManualFinancialAction("update_card_purchase", {
      purchase_id: purchaseId, field: "category_id", new_value: categoryId, series_scope: scope,
    }, categoryRequestId);
    if (updateCategory.erro) {
      if (description !== oldDescription) revalidarCartoes(cardId);
      return { erro: description !== oldDescription ? `A descrição foi salva, mas a categoria não: ${updateCategory.erro}` : updateCategory.erro };
    }
  }
  revalidarCartoes(cardId);
  return { erro: null };
}

export async function excluirCompra(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const purchaseId = formInteger(formData, "purchase_id");
  const scope = formString(formData, "series_scope") === "open_series" ? "open_series" : "one";
  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!Number.isInteger(purchaseId) || purchaseId <= 0) return { erro: "Compra inválida." };
  const resultado = await executeManualFinancialAction("delete_card_purchase", {
    purchase_id: purchaseId, series_scope: scope,
  }, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}

export async function pagarFatura(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const invoiceMonth = formString(formData, "invoice_month");
  const accountId = formInteger(formData, "account_id");
  const paymentAmount = parseMoney(formData.get("payment_amount"));
  const invoiceAmount = parseMoney(formData.get("invoice_amount"));
  const remainderMode = formString(formData, "remainder_mode");
  const interestMode = formString(formData, "interest_mode");
  const interestValue = parseMoney(formData.get("interest"));

  if (!Number.isInteger(cardId) || cardId <= 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoiceMonth)) return { erro: "Fatura inválida." };
  if (!Number.isInteger(accountId) || accountId <= 0) return { erro: "Selecione uma conta." };
  if (!moneyIsPositive(paymentAmount)) return { erro: "Informe quanto foi pago." };
  if (!moneyIsPositive(invoiceAmount)) return { erro: "O total da fatura mudou. Atualize a página e tente novamente." };
  if (paymentAmount > invoiceAmount + 0.005) return { erro: "O pagamento não pode ultrapassar o total da fatura." };
  if (!["full", "keep_open", "carry"].includes(remainderMode)) return { erro: "Escolha o destino do saldo restante." };
  if (remainderMode === "full" && Math.abs(paymentAmount - invoiceAmount) > 0.005) return { erro: "Para pagamento integral, informe o total da fatura." };
  if (remainderMode !== "full" && paymentAmount >= invoiceAmount - 0.005) return { erro: "Pagamento parcial deve ser menor que a fatura." };
  if (remainderMode === "carry" && Number.isFinite(interestValue)) {
    if (interestValue < 0) return { erro: "Os juros não podem ser negativos." };
    if (!["valor", "percentual"].includes(interestMode)) return { erro: "Escolha como os juros foram informados." };
    if (interestMode === "percentual" && interestValue > 1000) return { erro: "O percentual de juros é inválido." };
    if (interestMode === "valor" && interestValue > 999_999_999_999.99) return { erro: "O valor dos juros é inválido." };
    if (interestMode === "valor" && invoiceAmount - paymentAmount + interestValue > 999_999_999_999.99) {
      return { erro: "O saldo com juros ultrapassa o limite permitido." };
    }
    if (interestMode === "percentual" && (invoiceAmount - paymentAmount) * (1 + interestValue / 100) > 999_999_999_999.99) {
      return { erro: "O saldo com juros ultrapassa o limite permitido." };
    }
  }

  const payload: Record<string, unknown> = {
    card_id: cardId, invoice_month: invoiceMonth, account_id: accountId,
    payment_amount: paymentAmount, remainder_mode: remainderMode,
  };
  if (remainderMode === "carry" && Number.isFinite(interestValue) && interestValue >= 0) {
    if (interestMode === "percentual") payload.interest_percent = interestValue;
    else payload.interest_value = interestValue;
  }
  const resultado = await executeManualFinancialAction("pay_invoice", payload, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}

export async function estornarPagamentoFatura(formData: FormData): Promise<ResultadoCartao> {
  const cardId = formInteger(formData, "card_id");
  const transactionId = formInteger(formData, "transaction_id");
  if (!Number.isInteger(cardId) || cardId <= 0) return { erro: "Cartão inválido." };
  if (!Number.isInteger(transactionId) || transactionId <= 0) return { erro: "Pagamento não encontrado." };
  const resultado = await executeManualFinancialAction("reverse_invoice_payment", { transaction_id: transactionId }, formString(formData, "request_id"));
  if (!resultado.erro) revalidarCartoes(cardId);
  return resultado;
}
