/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-02-desempenho-interface",
  items: [
    "Toques e mudanças de aba respondem com mais rapidez",
    "Início, Histórico, Objetivos e Fluxo de Caixa foram otimizados",
    "Rolagem e abertura de filtros, formulários e janelas ficaram mais leves",
  ],
} as const;
