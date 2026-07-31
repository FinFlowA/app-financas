/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2026-07-31-parcelas-historico-alertas",
  items: [
    "Compras parceladas agora aceitam o valor total ou o valor de cada parcela",
    "Busca do histórico filtra corretamente os itens e o valor das faturas",
    "Balanço mensal separa o realizado do total agendado",
    "Valores recebem formatação monetária automática durante a digitação",
    "Cores ganharam mais opções fixas e as notificações pendentes foram revisadas",
  ],
} as const;
