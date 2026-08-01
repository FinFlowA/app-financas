/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-verificacao-telefone",
  items: [
    "Seu telefone agora é confirmado por um código de segurança enviado por SMS",
    "A troca do número fica protegida na área Segurança e só é concluída após a confirmação",
    "O FinFlow impede que o mesmo telefone seja vinculado a contas diferentes",
    "Termos de Uso e Política de Privacidade foram atualizados para explicar a verificação por SMS",
  ],
} as const;
