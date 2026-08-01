/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-07-31",
  items: [
    "Novo visual FinFlow nas telas principais, autenticação, botões e avisos",
    "Nova central de contas na tela inicial, com seleção, edição, arquivamento e criação em um só lugar",
    "Histórico, objetivos e Fluxo de Caixa reorganizados para uma leitura mais rápida e confortável",
    "Parcerias agora possuem avisos obrigatórios e um resumo seguro ao encerrar o vínculo",
    "Contas sem lançamentos podem ser excluídas com confirmação clara do saldo removido",
  ],
} as const;
