/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.1.0-2026-08-08-pagamentos-agrupados-v3",
  items: [
    "Pagamentos parciais agora permanecem no mesmo agendamento, com valores realizados e saldo restante no Histórico",
    "Ao abrir um agendamento, você pode consultar cada pagamento, sua data, valor e eventuais juros, descontos ou estornos",
    "A IA financeira entende melhor pedidos, faz as perguntas necessárias e sempre mostra uma prévia antes de alterar algo",
    "Criações e edições compatíveis podem ficar protegidas no celular até a conexão voltar, com aviso se houver conflito",
    "O cadastro ganhou senha forte, campo Nome simplificado e um tutorial completo das principais funções",
    "O Histórico combina tipos, ordena transações e faturas por data e permite informar quanto foi pago ou recebido",
    "O sino mostra vencimentos de hoje; o olho oculta valores e os avisos locais são removidos ao sair da conta",
  ],
} as const;
