/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-30-notificacoes-financeiras",
  items: [
    "Novo aviso no dia em que a fatura do cartão fecha",
    "Alertas de movimentações vencidas ficaram mais confiáveis",
    "Lembrete genérico de revisão ao meio-dia foi removido",
  ],
} as const;
