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
  id: "2.0.0-2026-10-05-novidades-v19",
  items: [
    "Parcelas agora podem ser semanais, mensais ou anuais: escolha na Periodicidade",
    "A Visão do mês mostra o que já entrou e saiu, e o Balanço é a diferença entre os dois",
    "Ao lançar, cada conta aparece com a cor que você escolheu para ela",
    "Mudar a data de uma série semanal não junta mais as ocorrências no mesmo dia",
  ],
} as const;
