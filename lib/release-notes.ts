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
  id: "2.0.0-2026-10-01-correcoes-v17",
  items: [
    "Conta, destino e categoria da nova transação abrem uma lista completa com busca, que surge com uma animação suave",
    "O teclado não cobre mais o número de parcelas, o campo do Finn nem as senhas em Segurança",
    "O Finn mostra três pontinhos enquanto pensa, e um círculo ao lado do campo indica quantas consultas restam no dia",
    "Lembretes de vencimento dos próximos dias chegam mesmo sem abrir o app",
    "O link de nova senha não aparece mais como expirado logo depois de recebido",
    "Transferências entre contas voltam a ser criadas e conciliadas normalmente",
    "O calendário dos objetivos segue o visual do app, e o cabeçalho dos Cartões ganhou as ondas animadas da tela inicial",
    "Atualizações entram sozinhas, já na primeira abertura, sem pedir para reiniciar",
    "Formulários mais leves e rápidos de preencher",
  ],
} as const;
