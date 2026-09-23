# Pagamentos e planos

## Provedores por plataforma

| Plataforma | Provedor atual ou planejado |
|---|---|
| Site | Paddle Billing |
| Android pela Play Store | Google Play Billing, futuro |
| iOS pela App Store | Apple In-App Purchase, futuro |
| Mercado Pago | Implementação legada mantida no repositório, não é o checkout web atual |

O retorno visual do checkout nunca concede acesso. Somente evento autenticado e processado no servidor atualiza a assinatura.

## Matriz comercial

| Interface | ID interno | Mensal | Anual |
|---|---|---:|---:|
| Gratuito | `free` | Grátis | Grátis |
| Pro | `smart` | R$ 19,90 | R$ 199,00 |
| Plus | `premium` | R$ 39,90 | R$ 399,00 |

Os valores exibidos no checkout são obtidos do Paddle e podem incluir localização e impostos. IDs de preço são configurados por ambiente.

### Limites funcionais

| Recurso | Gratuito | Pro | Plus |
|---|---:|---:|---:|
| Lançamentos/mês | 40 | 150 | Ilimitado |
| Contas | 2 | 5 | Ilimitado |
| Cartões | 1 | 3 | Ilimitado |
| Objetivos | 1 | 3 | Ilimitado |
| Categorias por tipo | 7 | 14 | Ilimitado |
| Vínculos compartilhados | 1 | 3 | Ilimitado |
| IA: consultas/dia | 0 | 60 | 200 |
| IA: ações/dia | 0 | 15 | 50 |

Fluxo diário, conciliação, relatórios completos e IA começam no Pro; análises avançadas exigem Plus. `billing_settings.limits_enabled` controla se os limites são efetivamente aplicados.

## Paddle no site

Componentes principais:

- `web/src/lib/paddle/pricing-tiers.ts`: catálogo permitido e configuração pública;
- `web/src/app/(dashboard)/planos/plans-client.tsx`: PricePreview e Checkout;
- `web/src/app/api/paddle/webhook/route.ts`: corpo bruto e verificação de assinatura;
- `web/src/lib/paddle/process-webhook.ts`: roteamento e upserts;
- `web/src/app/(dashboard)/planos/portal-actions.ts`: sessão do portal autenticada;
- `supabase/migrations/20260918000300_paddle_fulfillment.sql`: espelho e RPCs.

### Eventos tratados

- `customer.created`, `customer.updated`;
- criação, atualização, ativação, cancelamento, atraso, pausa, retomada e trial da assinatura;
- `transaction.completed`.

Eventos desconhecidos são ignorados depois da verificação. Falhas retornam status não-2xx para permitir retry.

### Estados de acesso

- Concedem acesso: `active`, `trialing`, `grace_period`.
- Cancelamento agendado não revoga antes da data efetiva.
- `canceled` do Paddle é armazenado como `cancelled`.
- `past_due` é convertido para `grace_period` conforme a regra atual.
- `paused` é espelhado, mas não está na lista de acesso pago.

## Portal do cliente

O usuário autenticado abre uma Server Action. O servidor resolve o customer Paddle por `auth.uid()`, seleciona suas assinaturas e cria uma sessão hospedada. O cliente nunca informa um customer ID confiável.

## Infraestrutura permanente

Não excluir como limpeza:

- produtos e preços;
- notification destinations e signing secrets;
- clientes, assinaturas e transações do provedor;
- linhas espelhadas no banco.

## Google Play Billing futuro

A implementação deve começar quando o aplicativo tiver cadastro e identificador definitivos no Play Console, antes da publicação pública:

1. criar produtos/base plans equivalentes;
2. integrar Google Play Billing no app;
3. validar purchase token no servidor;
4. consumir notificações em tempo real;
5. gravar o direito em `subscriptions` com provider `google_play`;
6. testar em faixa interna;
7. reconciliar restauração, renovação, cancelamento, grace period e chargeback.

Não abra Paddle dentro do app para vender recursos digitais distribuídos pela Play Store sem confirmar uma exceção vigente das políticas da loja.
# Assinaturas no Android

O site usa Paddle. O app Android usa Google Play Billing e compartilha o mesmo entitlement no Supabase. O procedimento técnico e o checklist do Play Console estão em [GOOGLE_PLAY_BILLING.md](./GOOGLE_PLAY_BILLING.md).

