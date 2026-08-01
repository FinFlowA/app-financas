/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-hotfix-foco-login",
  items: [
    "Corrigimos a perda de foco que fazia os campos de login piscarem e fechava o teclado",
    "A digitação dos dados de acesso agora permanece estável no celular",
  ],
} as const;
