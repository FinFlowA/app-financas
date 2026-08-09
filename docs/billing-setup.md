# Assinaturas seguras do FinFlow

## Estado inicial

`billing_settings` começa com:

- `billing_enabled = false`
- `limits_enabled = false`

Assim, nenhuma cobrança é iniciada e os limites ficam liberados durante o
desenvolvimento. Isso não transforma contas Free em Premium.

## Aplicar no Supabase

1. Vincule o Supabase CLI ao projeto correto.
2. Revise e aplique, nesta ordem:

   - `supabase/migrations/20260730_secure_subscriptions.sql`
   - `supabase/migrations/20260808001000_harden_external_edges.sql`

   A segunda migration deve entrar antes das Edge Functions novas. Ela cria os
   claims idempotentes, os limites atômicos, a retenção e as validações de
   integridade usadas pelas funções. Se uma tabela central estiver ausente, a
   migration falha sem publicar uma proteção parcial.

### Pré-verificação dos dados legados

A migration não inventa uma categoria para dados antigos. Antes de publicá-la,
revise os resultados destas consultas somente leitura; linhas retornadas precisam
ser corrigidas com a categoria real do usuário:

```sql
select t.id, t.user_id, t.tipo, t.descricao, t.categoria_id
from public.transacoes t
left join public.categorias c on c.id = t.categoria_id
where (
  not exists (
    select 1 from public.contas a
    where a.id = t.conta_id
      and (
        a.user_id = t.user_id
        or (
          a.compartilhado is true
          and exists (
            select 1 from public.parcerias p
            where p.status = 'aceito'
              and (
                (p.solicitante_id = a.user_id and p.convidado_id = t.user_id)
                or (p.convidado_id = a.user_id and p.solicitante_id = t.user_id)
              )
          )
        )
      )
  )
) or (
  t.categoria_id is null
  and coalesce(t.descricao, '') !~ '\[(Destino:[0-9]+|Objetivo:[0-9]+:(guardar|resgatar)|PagFatura:[^]]+)\]\s*$'
) or (
  t.categoria_id is not null
  and (
    c.id is null or c.user_id <> t.user_id or c.tipo <> t.tipo
    or coalesce(t.descricao, '') ~ '\[(Destino:|Objetivo:|PagFatura:)'
  )
);

select i.id, i.user_id, i.descricao, i.categoria_id
from public.fatura_itens i
left join public.categorias c on c.id = i.categoria_id
where (
  not exists (
    select 1 from public.cartoes card
    where card.id = i.cartao_id and card.user_id = i.user_id
  )
) or (
  i.categoria_id is null
  and coalesce(i.descricao, '') !~ '^Saldo da fatura anterior( \([0-9]{4}-(0[1-9]|1[0-2])\))?$'
) or (
  i.categoria_id is not null
  and (c.id is null or c.user_id <> i.user_id or c.tipo <> 'despesa')
);
```

Depois da migration, qualquer INSERT/UPDATE com conta, cartão ou categoria de
outro usuário, ou categoria incompatível com o tipo, falha no banco. Movimentos
internos legítimos continuam usando categoria nula e marcadores validados.
3. Configure os secrets no Supabase, nunca no Expo:

```text
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
FINFLOW_BILLING_RETURN_URL
FINFLOW_ALLOWED_ORIGINS
```

`FINFLOW_ALLOWED_ORIGINS` recebe origens web completas separadas por vírgula,
por exemplo `https://app.exemplo.com,https://preview.exemplo.com`. `*` é
ignorado. Localhost continua liberado para desenvolvimento. Android e iOS não
enviam `Origin` e, por isso, não dependem de CORS.

A configuração da IA é independente da cobrança e está documentada em
[`ai-setup.md`](./ai-setup.md). Chaves OpenAI/Groq continuam exclusivas dos
secrets do Supabase.

4. Publique as funções:

```text
create-subscription-checkout
sync-subscription
cancel-subscription
mercado-pago-webhook
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
- Eventos usam claim com lease: uma duplicata só recebe sucesso depois que a
  tentativa original terminou. Falhas podem ser retomadas sem perder o evento.
- O corpo bruto do webhook não é preservado; apenas metadados allowlisted ficam
  por até 180 dias. Eventos não processados e sem lease ativo expiram em 30 dias;
  os códigos de erro antigos que não eram allowlisted são redigidos.
- Checkout tem chave de idempotência, cooldown e limite por usuário/produto.
- Os quatro produtos aceitos têm allowlist também na Edge Function. Um produto
  novo exige atualizar a allowlist e a tabela `billing_products` na mesma versão.
- Uma criação cujo resultado no provedor ficou ambíguo falha fechada e exige
  reconciliação, em vez de criar uma assinatura duplicada.
- Tokens de pagamento e chaves de IA nunca entram no bundle.
- Google Play e Apple usam seus próprios provedores, mas gravam direitos na
  mesma tabela `subscriptions`.
