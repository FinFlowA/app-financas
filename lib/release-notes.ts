/**
 * Atualize este arquivo em toda publicação do app.
 *
 * O `id` controla se o usuário já viu as novidades desta versão. Por isso,
 * cada nova OTA/build deve receber um id novo e suas próprias mensagens.
 */
export const RELEASE_NOTES = {
  id: "2.0.0-2026-08-22-objetivos-conta-v8",
  items: [
    "Guardar e resgatar em objetivos compartilhados agora funciona para as duas pessoas da parceria",
    "Transferências parceladas para objetivos podem ser concluídas sem deixar saldo e histórico divergentes",
    "O estorno pelo Histórico foi corrigido e reabre o lançamento de forma segura",
    "A exclusão de conta agora confirma sua senha e remove os dados em uma única operação protegida",
    "Links de recuperação de senha ficaram mais confiáveis e protegidos pelo fluxo PKCE",
  ],
} as const;
