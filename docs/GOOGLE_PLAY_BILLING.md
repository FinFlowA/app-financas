# Assinaturas Google Play

## Estado da integração

O código do Android está preparado para vender Pro e Plus como assinaturas da Google Play. A liberação do plano nunca depende apenas do aparelho: o recibo é consultado na Google Play Developer API, persistido no Supabase e só então o app finaliza a transação.

## Regra multiplataforma

O plano pertence ao usuário FinFlow (`auth.users.id`), não ao canal de pagamento. Paddle e Google Play gravam na mesma tabela `subscriptions`, e tanto o site quanto o app leem a RPC `get_my_entitlement`.

- compra feita no site pelo Paddle ativa o mesmo plano no app;
- compra feita no Android pela Google Play ativa o mesmo plano no site;
- o usuário precisa entrar com a mesma conta FinFlow nos dois ambientes;
- se mais de uma assinatura estiver válida, prevalece o plano mais alto;
- cancelar um provedor não remove o acesso concedido por outra assinatura ainda válida;
- o app reapura o entitlement ao voltar ao primeiro plano; o site reapura nas páginas dinâmicas e na navegação.

Também estão implementados:

- compra mensal e anual com preço localizado retornado pela loja;
- `obfuscatedAccountId` vinculado ao usuário autenticado;
- restauração de compras;
- abertura da tela de gerenciamento de assinaturas da Play Store;
- reconhecimento de compra pendente sem conceder acesso;
- confirmação no servidor e acknowledgement;
- sincronização do ciclo de vida por Real-time Developer Notifications (RTDN);
- deduplicação de notificações por `messageId`;
- proteção do token de compra por RLS/service role.

O módulo `expo-iap` contém código nativo. Por isso, ele não funciona no Expo Go e exigiu a mudança de `runtimeVersion` para `2.0.0-r3`. Teste com um development build ou uma faixa de teste da Play Store.

## Identificadores reservados

Crie no Play Console exatamente estes dois produtos de assinatura:

| Plano exibido | Plano interno | Product ID |
| --- | --- | --- |
| Pro | `smart` | `finflow_pro` |
| Plus | `premium` | `finflow_plus` |

Em cada produto, crie dois planos básicos:

| Ciclo | Base plan ID | Preço de referência no Brasil |
| --- | --- | --- |
| Mensal | `monthly` | Pro R$ 19,90 / Plus R$ 39,90 |
| Anual | `annual` | Pro R$ 199,00 / Plus R$ 399,00 |

IDs de produto e de plano básico não devem ser improvisados depois que o catálogo estiver em uso. Os preços mostrados pelo app vêm da própria Play Store, incluindo moeda e localização.

## Configuração quando o app entrar no Play Console

1. Crie o app Android com o package `com.luishpalacio.meuappfinancas`.
2. Envie um AAB para a faixa de teste interno. A Play Billing não pode ser testada apenas por sideload comum.
3. Cadastre e ative os produtos e planos básicos da tabela acima.
4. No Google Cloud vinculado ao Play Console, habilite a Google Play Android Developer API.
5. Crie uma service account exclusiva e conceda no Play Console apenas acesso necessário a pedidos e assinaturas.
6. Cadastre os secrets server-side listados em `.env.example` nas Supabase Edge Functions.
7. Aplique a migration `20260923000100_google_play_billing.sql` e publique as funções `google-play-verify-purchase` e `google-play-rtdn`.
8. Crie um tópico Pub/Sub e conceda `Pub/Sub Publisher` a `google-play-developer-notifications@system.gserviceaccount.com`.
9. Configure esse tópico em **Monetize > Monetization setup > Real-time developer notifications** no Play Console.
10. Crie uma push subscription para a URL pública da função `google-play-rtdn`, com autenticação OIDC. A audiência deve ser a mesma URL; o e-mail da service account de push deve coincidir com `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`.
11. Preencha as quatro variáveis públicas `EXPO_PUBLIC_GOOGLE_PLAY_*` no perfil EAS. Elas são IDs públicos, não credenciais.
12. Gere um novo development build, adicione os testadores de licença no Play Console e faça compras com os métodos de teste.

## Teste de aceite

- Uma compra `PENDING` não muda o plano.
- Uma compra confirmada muda o entitlement somente após validação do servidor.
- Fechar o app antes da confirmação e usar **Restaurar compras** conclui o fluxo.
- Cancelar renovação mantém o acesso até `expiryTime`; expiração remove o acesso.
- Período de carência mantém o acesso; conta suspensa/on hold não mantém.
- A mesma notificação RTDN repetida não cria linhas duplicadas.
- Um recibo de outro usuário é recusado pelo `obfuscatedAccountId`.
- A assinatura aparece em **Pagamentos e assinaturas** na Play Store e o botão **Gerenciar** abre essa tela.

## Ativação

Enquanto `billing_settings.billing_enabled` estiver falso, os botões permanecem desabilitados. Ative somente depois de o catálogo estar ativo, as Edge Functions estarem publicadas e o teste interno passar de ponta a ponta.

Não coloque a chave privada da service account em `EXPO_PUBLIC_*`, EAS Update ou no repositório.
