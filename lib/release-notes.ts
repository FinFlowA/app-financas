/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-09-01-transfer-status-v12",
  items: [
    "Formulários de criação e edição agora abrem em telas próprias, com navegação mais estável",
    "Objetivos com apenas saldo inicial podem ser excluídos; objetivos movimentados preservam o histórico",
    "O histórico dos objetivos mostra apenas movimentações realizadas e fica junto ao respectivo card no site",
    "O fluxo de caixa detalha valores guardados e resgatados dos objetivos com cores próprias",
    "Recorrências fixas mantêm automaticamente uma janela móvel de cinco anos, sem pedir quantidade de ocorrências",
    "Seletores de conta, paletas de cores, barra inferior e criação de contas receberam correções visuais e de navegação",
    "Telas de criação e configuração agora respeitam as barras do aparelho e mantêm suas ações no rodapé",
    "A navegação inferior respeita os botões do aparelho, as abas atualizam ao puxar e o teclado não cobre mais o valor da transação",
    "Transferências entre contas agora podem ser concluídas e reabertas com segurança",
  ],
} as const;
