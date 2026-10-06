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
  FINFLOW_SHARED_LINK_LIMIT: "Você atingiu o limite de vínculos compartilhados do seu plano.",
  AI_ACCOUNT_HAS_TRANSACTIONS: "Esta conta possui lançamentos e será preservada no histórico.",
  AI_CATEGORY_HAS_REFERENCES: "Esta categoria possui lançamentos e será arquivada para preservar o histórico.",
  AI_CATEGORY_TARGET_NOT_ALLOWED: "A meta mensal vale só para categorias de receita, e o limite mensal só para as de despesa.",
  AI_INVALID_MONTHLY_GOAL: "A meta mensal precisa ser maior que zero.",
  AI_INVALID_MONTHLY_LIMIT: "O limite mensal precisa ser maior que zero.",
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

const EMAIL_SUPORTE = "Finflowfinancas@gmail.com";
const PADRAO_TETO_SEGURANCA = /FINFLOW_TETO_SEGURANCA:([a-z_]+):(diario|total):(\d+)/i;
const RECURSOS_TETO: Readonly<Record<string, string>> = {
  lancamentos: "lançamentos",
  compras_cartao: "compras no cartão",
  contas: "contas",
  objetivos: "objetivos",
  cartoes: "cartões",
  categorias: "categorias",
  convites_parceria: "convites de conta conjunta",
  feedbacks: "feedbacks",
  historico_finn: "mensagens no histórico do Finn",
};

/**
 * Teto de segurança por usuário (auditoria V08). O banco recusa criações
 * acima do teto com `FINFLOW_TETO_SEGURANCA:<recurso>:<diario|total>:<teto>`.
 * Vale em qualquer plano; não é limite de plano, então não oferece upgrade.
 * Mesmo texto do app (lib/teto-seguranca.ts). Retorna null para outros erros.
 */
export function mensagemTetoSeguranca(erro: string | { message?: string | null } | null | undefined): string | null {
  const texto = typeof erro === "string" ? erro : erro?.message ?? "";
  const encontrado = texto.match(PADRAO_TETO_SEGURANCA);
  if (!encontrado) return null;
  const teto = Number(encontrado[3]);
  if (!Number.isSafeInteger(teto) || teto <= 0) return null;
  const recurso = RECURSOS_TETO[encontrado[1].toLowerCase()] ?? "itens";
  const quantidade = teto.toLocaleString("pt-BR");
  if (encontrado[2].toLowerCase() === "diario") {
    return `Você atingiu o limite de segurança de ${quantidade} ${recurso} por dia. Tente de novo amanhã. Se precisar de mais, fale com o suporte: ${EMAIL_SUPORTE}`;
  }
  return `Você atingiu o limite de segurança de ${quantidade} ${recurso}. Esse limite inclui os itens arquivados. Exclua o que não usa mais ou fale com o suporte: ${EMAIL_SUPORTE}`;
}

/** Mensagem de erro sem tradução própria. */
export const MENSAGEM_ERRO_GENERICA = "Não foi possível concluir a operação. Nenhuma alteração financeira foi feita.";

export function traduzirErro(codigo: string): string {
  if (MENSAGENS[codigo]) return MENSAGENS[codigo];
  const teto = mensagemTetoSeguranca(codigo);
  if (teto) return teto;
  if (codigo.includes("NOT_FOUND")) return "Não encontrei o item financeiro solicitado ou você não possui acesso a ele.";
  if (codigo.includes("ARCHIVED")) return "O item está arquivado e precisa ser reativado antes desta ação.";
  if (codigo.startsWith("AI_INVALID_") || codigo.startsWith("AI_MISSING_") || codigo.includes("REQUIRED")) {
    return "Os dados informados não atendem às regras desta operação. Revise os valores e tente novamente.";
  }
  return MENSAGEM_ERRO_GENERICA;
}
