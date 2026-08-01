/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-hotfix-login",
  items: [
    "Corrigimos a digitação na tela de login para manter os campos estáveis quando o teclado abre",
    "Melhoramos o foco, a rolagem e a visualização dos campos de acesso no celular",
  ],
} as const;
