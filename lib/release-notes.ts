/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-31-fatura-zerada-e-cores",
  items: [
    "O cartão agora mostra a próxima fatura quando a atual estiver paga ou zerada",
    "A seleção de cores cabe na tela e pode ser arrastada para os lados",
    "O balanço identifica claramente o valor previsto até o fim do mês",
  ],
} as const;
