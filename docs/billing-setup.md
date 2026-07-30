# Assinaturas seguras do FinFlow

## Estado inicial

`billing_settings` começa com:

- `billing_enabled = false`
- `limits_enabled = false`

Assim, nenhuma cobrança é iniciada e os limites ficam liberados durante o
desenvolvimento. Isso não transforma contas Free em Premium.

## Aplicar no Supabase

1. Vincule o Supabase CLI ao projeto correto.
2. Revise e aplique `supabase/migrations/20260730_secure_subscriptions.sql`.
3. Configure os secrets no Supabase, nunca no Expo:

```text
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
FINFLOW_BILLING_RETURN_URL
FINFLOW_AI_ALLOWED_EMAILS
GROQ_API_KEY
```

4. Publique as funções:

```text
create-subscription-checkout
sync-subscription
cancel-subscription
mercado-pago-webhook
groq-proxy
```

5. No Mercado Pago, configure notificações de assinatura e pagamentos para:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercado-pago-webhook
```

6. Teste com credenciais e usuários de teste. Só depois coloque o Access Token
de produção.

## Ativar cobranças

Depois de validar checkout, webhook, cancelamento, renovação, atraso e reembolso:

```sql
update public.billing_settings
set billing_enabled = true
where id = true;
```

Os limites devem permanecer desligados até o ciclo completo estar aprovado.
Para ligá-los posteriormente:

```sql
update public.billing_settings
set limits_enabled = true
where id = true;
```

## Regras de segurança

- O aplicativo não grava em `subscriptions`.
- Somente funções com `service_role` confirmam direitos pagos.
- O retorno do navegador nunca ativa o plano.
- Webhooks são validados por assinatura e reconciliados com a API do provedor.
- Eventos são idempotentes.
- Tokens de pagamento e chaves de IA nunca entram no bundle.
- Google Play e Apple usam seus próprios provedores, mas gravam direitos na
  mesma tabela `subscriptions`.
