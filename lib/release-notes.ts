/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-01-projecao-objetivos",
  items: [
    "Objetivos com prazo agora mostram o saldo previsto na data da meta, considerando as transferências agendadas",
    "Histórico com filtro por ano e lançamentos ordenados da data mais próxima para a mais distante",
    "Avisos de atrasos agora abrem o filtro correto e indicam quando há pendências",
    "O sino deixa de exibir a bolinha vermelha depois que os avisos são visualizados",
    "Receitas e despesas antigas sem categoria visível passam a aparecer em Outros, sem sumir dos gráficos",
  ],
} as const;
