/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-31-estabilidade-e-prioridade",
  items: [
    "Mais estabilidade ao salvar lançamentos em caso de sessão ou conexão temporariamente indisponível",
    "Avisos obrigatórios de cadastro agora têm prioridade sobre lembretes vencidos",
    "Cancelamento da exclusão de conta com o visual padrão do FinFlow",
    "Cartões pagos após o vencimento agora destacam a próxima fatura e sua data",
    "Restaurado o ciclo estável de abertura da aba Ajustes",
    "Corrigida a abertura da tela de Configurações em contas antigas",
    "Contas antigas agora recebem um aviso para completar informações obrigatórias",
    "Cadastro agora confirma idade mínima e aceite dos documentos",
    "Separação de parceria com decisão segura sobre cada caixinha",
    "Melhorias de estabilidade e atualização das informações legais",
  ],
} as const;
