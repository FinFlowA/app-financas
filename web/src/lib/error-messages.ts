/** Traduz códigos de erro do backend financeiro (mesmo vocabulário usado pela
 * Edge Function finance-ai e pela fila offline) para mensagens em português.
 * Mantém o mesmo tom das mensagens já usadas no restante do FinFlow. */
const MENSAGENS: Record<string, string> = {
  OFFLINE_AUTH_REQUIRED: "Sua sessão expirou. Entre novamente.",
  OFFLINE_AUTH_MISMATCH: "Sua sessão mudou. Recarregue a página e tente de novo.",
  OFFLINE_INVALID_IDEMPOTENCY_KEY: "Não foi possível processar o pedido. Tente novamente.",
  OFFLINE_OPERATION_EXPIRED: "O pedido demorou demais para ser enviado. Tente novamente.",
  OFFLINE_INVALID_PAYLOAD: "Os dados enviados são inválidos.",
  OFFLINE_UNSUPPORTED_ACTION: "Essa operação não é suportada.",
  OFFLINE_IDEMPOTENCY_CONFLICT: "O pedido foi alterado durante o processamento. Tente novamente.",
  OFFLINE_RATE_LIMITED: "Muitas operações em pouco tempo. Aguarde um pouco e tente de novo.",
  AI_ACCOUNT_NOT_FOUND: "Não encontrei essa conta ou ela não está disponível para esta ação.",
  AI_ACCOUNT_ARCHIVED: "A conta está arquivada. Reative-a antes de movimentá-la.",
  AI_GOAL_NOT_FOUND: "Não encontrei esse objetivo ou ele não está disponível para esta ação.",
  AI_INSUFFICIENT_GOAL_BALANCE: "O objetivo não possui saldo suficiente para esse resgate.",
  AI_GOAL_HAS_BALANCE: "Resgate todo o saldo do objetivo antes de excluí-lo.",
  AI_CARD_NOT_FOUND: "Não encontrei esse cartão ou ele está arquivado.",
  AI_CARD_ARCHIVED: "Reative o cartão antes de alterar esta fatura.",
  AI_CARD_LIMIT_EXCEEDED: "Essa compra ultrapassa o limite disponível do cartão.",
  AI_INVOICE_CLOSED: "Essa fatura já está fechada e não aceita novas compras ou alterações.",
  AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE: "A categoria não existe, está arquivada ou não corresponde ao tipo do lançamento.",
  AI_INVOICE_ALREADY_SETTLED: "Esta fatura já foi paga ou está zerada.",
  AI_INVOICE_HAS_LATER_PAYMENT: "Existe um pagamento posterior ligado a este. Estorne primeiro o pagamento mais recente.",
  AI_PAYMENT_ABOVE_INVOICE: "O pagamento não pode ultrapassar o saldo atual da fatura.",
  AI_TOTAL_PAYMENT_MISMATCH: "O valor integral precisa ser igual ao saldo atual da fatura.",
  AI_INVALID_INVOICE_MONTH: "O mês da fatura é inválido.",
};

export function traduzirErro(codigo: string): string {
  if (MENSAGENS[codigo]) return MENSAGENS[codigo];
  if (codigo.includes("NOT_FOUND")) return "Não encontrei o item financeiro solicitado ou você não possui acesso a ele.";
  if (codigo.includes("ARCHIVED")) return "O item está arquivado e precisa ser reativado antes desta ação.";
  if (codigo.startsWith("AI_INVALID_") || codigo.startsWith("AI_MISSING_") || codigo.includes("REQUIRED")) {
    return "Os dados informados não atendem às regras desta operação. Revise os valores e tente novamente.";
  }
  return "Não foi possível concluir a operação. Nenhuma alteração financeira foi feita.";
}
