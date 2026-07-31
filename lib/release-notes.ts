/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-30-estabilidade-configuracoes",
  items: [
    "Corrigida a abertura da tela de Configurações em contas antigas",
    "Contas antigas agora recebem um aviso para completar informações obrigatórias",
    "Cadastro agora confirma idade mínima e aceite dos documentos",
    "Separação de parceria com decisão segura sobre cada caixinha",
    "Melhorias de estabilidade e atualização das informações legais",
  ],
} as const;
