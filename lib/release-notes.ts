/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-02-historico-categorias-objetivos",
  items: [
    "Histórico com seleção mais simples de mês e ano junto aos filtros",
    "Categorias podem ser excluídas ou arquivadas sem mover seus lançamentos",
    "Parcelamentos permitem apagar todas as parcelas que ainda estão em aberto",
    "Transferências para objetivos mostram a descrição e não entram no balanço mensal",
    "Objetivos mostram a previsão de saldo até o fim do ano",
    "Tela de acesso protegido e login receberam melhorias visuais",
  ],
} as const;
