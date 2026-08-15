/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-15-parcelas-objetivos-v7",
  items: [
    "Compras parceladas no cartão agora entram nos gastos por categoria somente no mês de cada parcela",
    "Objetivos com projeção abaixo da meta destacam o valor em vermelho para facilitar o planejamento",
    "Faturas zeradas passam a constar como pagas depois da data de fechamento, sem criar débito ou pagamento artificial",
    "Os cards de cartão deixam mais claro quando a fatura atual foi paga e já apresentam a próxima fatura",
    "Os cards de objetivos receberam descrições mais claras para leitores de tela e navegação assistida",
  ],
} as const;
