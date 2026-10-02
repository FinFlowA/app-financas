/**
 * Novidades mostradas UMA vez depois que uma atualização entra no app.
 *
 * Só troque o `id` (e as mensagens) quando houver mudança relevante para
 * quem usa o app: recurso novo, mudança visível no jeito de usar ou correção
 * de um problema que as pessoas percebiam. Correções pequenas e ajustes
 * internos mantêm o `id`: a atualização entra em silêncio, sem nenhuma tela
 * (decisão do responsável pelo produto em 01/10/2026).
 *
 * Ao trocar o `id`, as mensagens descrevem só o que mudou desde a última
 * lista exibida.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-10-02-novidades-v18",
  items: [
    "Novo filtro \"Considerar atrasados\" no Fluxo de caixa: desligado, os lançamentos vencidos e ainda não concluídos saem do saldo previsto e do gráfico",
    "As compras no cartão entram nas Saídas e no Balanço do mês da fatura, cada parcela no seu mês, sem contar o pagamento da fatura duas vezes",
    "Toque em Balanço atual, na tela inicial, para ver como o valor é calculado",
    "Notificações com textos mais claros e sem emojis, e nenhum aviso chega só por abrir o app",
    "Os lembretes de vencimento da fatura param assim que ela é paga",
    "O aviso de prazo dos objetivos mostra quanto falta da meta, em porcentagem, e a data final",
    "No chat, o Finn aparece como um contato: toque no topo da conversa para ver as informações dele, com o Finn acenando",
  ],
} as const;
