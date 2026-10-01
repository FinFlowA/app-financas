/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-10-01-correcoes-v17",
  items: [
    "O cabeçalho dos Cartões ganhou as ondas animadas da tela inicial",
    "As listas de conta e categoria da nova transação surgem com uma animação suave",
    "A tela de nova transação voltou a ocupar a tela inteira",
    "Formulários mais leves: a tela de fundo não é mais redesenhada sem parar enquanto você preenche",
    "Versões novas passam a valer já na primeira abertura do app",
    "Conta, destino e categoria da nova transação abrem uma lista completa, com busca que continua visível com o teclado aberto",
    "O teclado não cobre mais o número de parcelas, o campo de mensagem do Finn nem as senhas na área de Segurança",
    "O Finn mostra três pontinhos enquanto pensa, e um círculo ao lado do campo indica quantas consultas restam no dia",
    "Lembretes de vencimento dos próximos dias são agendados de uma vez e chegam mesmo sem abrir o app",
    "O link de nova senha não aparece mais como expirado quando aberto logo depois de recebido",
    "Transferências entre contas voltam a ser criadas e conciliadas normalmente",
    "O calendário dos objetivos segue o visual do app, e a barra de abas some ao abrir Cartões pela tela inicial",
    "Atualizações do app são instaladas em segundo plano, sem pedir para reiniciar",
  ],
} as const;
