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
  id: "2.0.0-2026-10-06-novidades-v20",
  items: [
    "Defina uma meta mensal nas categorias de receita e um limite mensal nas de despesa",
    "Em Gerenciar Categorias, cada meta e limite mostra quanto do mês já foi usado e o que ainda está agendado",
    "No Histórico, toque no mês para escolher qualquer mês e ano",
  ],
} as const;
