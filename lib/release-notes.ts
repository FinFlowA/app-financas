/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-layout-e-tutorial",
  items: [
    "Novo tutorial pulável apresenta os recursos essenciais para quem acabou de criar a conta",
    "Histórico, Objetivos, Fluxo e Ajustes agora possuem cabeçalhos verdes padronizados e mais confortáveis",
    "Cabeçalhos de Histórico, Objetivos e Ajustes ficam compactos enquanto você navega pela tela",
    "Fluxo de Caixa ganhou gráfico maior, arraste horizontal e saldo acumulado referente ao mês selecionado",
    "A Visão do mês na tela inicial ficou mais direta e sem abrir informações repetidas",
  ],
} as const;
