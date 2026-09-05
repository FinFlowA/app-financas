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
  OFFLINE_VERSION_CONFLICT: "Este item foi alterado em outro dispositivo. Atualize a página e tente novamente.",
  AI_PARTNERSHIP_NOT_FOUND: "Você precisa ter uma parceria aceita para compartilhar este item.",
  FINFLOW_RESOURCE_ARCHIVED: "Reative o item antes de compartilhá-lo.",
  AI_ACCOUNT_HAS_TRANSACTIONS: "Esta conta possui lançamentos e será preservada no histórico.",
  AI_CATEGORY_HAS_REFERENCES: "Esta categoria possui lançamentos e será arquivada para preservar o histórico.",
  AI_GOAL_HAS_PENDING_SCHEDULES: "Este objetivo possui agendamentos pendentes e não pode ser excluído agora.",
  AI_CARD_HAS_ITEMS: "Este cartão possui compras e será arquivado para preservar o histórico.",
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
  AI_ACTION_STATE_CHANGED: "Os dados mudaram desde que a tela foi aberta. Atualize e revise a operação.",
  AI_TRANSACTION_ALREADY_PAID: "Este lançamento já foi concluído.",
  AI_TRANSACTION_NOT_PAID: "Este lançamento ainda está pendente.",
  AI_INVALID_REALIZED_VALUE: "O valor realizado não atende às regras deste lançamento.",
  AI_SAME_ACCOUNT: "Escolha contas diferentes para realizar a transferência.",
  AI_PARTIAL_PAYMENT_MISMATCH: "Para pagamento parcial, informe um valor menor que o saldo da fatura.",
  // Séries recorrentes antigas (criadas antes do identificador [Serie:N])
  // nunca são agrupadas automaticamente: duas parcelas idênticas e
  // adjacentes são matematicamente indistinguíveis, então qualquer operação
  // em massa nelas falha de propósito, item por item.
  AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL: "Esta é uma série recorrente antiga e não pode ser excluída ou editada em massa com segurança. Repita a ação escolhendo \"Somente este item\" em cada lançamento pendente.",
  AI_LEGACY_SERIES_AMBIGUOUS: "Não foi possível identificar com segurança quais lançamentos pertencem a esta série (pode haver uma edição ou exclusão anterior no meio dela). Exclua ou edite os itens pendentes individualmente.",
  AI_TRANSACTION_NOT_IN_SERIES: "Este lançamento não faz parte de uma série reconhecida. Repita a ação escolhendo \"Somente este item\".",
  AI_NO_OPEN_SERIES_ITEMS: "Não há itens pendentes desta série para excluir ou editar.",
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
