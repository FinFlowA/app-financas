/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-30-categorias-e-seguranca",
  items: [
    "Categorias em ordem alfabética ao lançar ou editar transações",
    "Avisos de atualização agora mostram as melhorias da versão correta",
    "Proteções adicionais para contas, transações e compartilhamentos",
  ],
} as const;
