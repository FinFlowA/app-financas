/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-telefone-opcional",
  items: [
    "O telefone deixou de bloquear o acesso e agora é uma informação opcional",
    "A confirmação por e-mail continua protegendo a criação e as alterações da conta",
    "A área Segurança agora identifica com clareza quando um telefone não foi verificado",
    "Termos de Uso e Política de Privacidade foram atualizados para refletir essa mudança",
  ],
} as const;
