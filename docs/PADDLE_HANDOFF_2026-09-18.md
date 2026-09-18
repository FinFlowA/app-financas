# FinFlow — retomada da integração Paddle

Data do handoff: 18/09/2026

## Estado atual

- Código publicado na `main` até o commit `55018e3`.
- Deploy de produção confirmado como `Ready` em `https://finflow-mauve-chi.vercel.app`.
- Página de planos, checkout Paddle, página `/welcome`, portal do cliente e webhook estão publicados.
- Rota permanente: `POST /api/paddle/webhook`.
- Uma chamada sem assinatura retorna HTTP 400; o middleware não redireciona mais o webhook para o login.
- Build aprovado e 17 testes direcionados aprovados.
- Migrações do Supabase aplicadas até `20260918000300_paddle_fulfillment.sql`.
- Variáveis Paddle e Supabase configuradas na Vercel em Production, Preview e Development.
- Segredos estão fora do Git. Nunca copiar valores para este documento.

## Infraestrutura permanente — não excluir

- Notification destination: `ntfset_01m2tr4p5fn4vs3b3xnb4g4cxg`.
- URL: `https://finflow-mauve-chi.vercel.app/api/paddle/webhook`.
- Assinatura sandbox existente: `sub_01m2tq97bwf5ysqdtepssd406j`.
- Cliente sandbox existente: `ctm_01m2tq843xr23h5z83gnsrmfr3`.
- Transação sandbox concluída: `txn_01m2tq8468f1beg5cqj1gk679f`.
- Produtos, preços, clientes, assinaturas, transações e linhas espelhadas no banco são estado permanente.

## Catálogo sandbox

- Pro mensal: R$ 19,90 — `pri_01m2t95sany6c2th000xwbjd6p`.
- Pro anual: R$ 199,00 — `pri_01m2t95sffza6sycm34snnw88b`.
- Plus mensal: R$ 39,90 — `pri_01m2t95sxye0jx1awcckf3apra`.
- Plus anual: R$ 399,00 — `pri_01m2t95t3jr4qhtn24xsraz1tw`.

## Teste realizado

- Simulação permanente criada: `ntfsim_01m2tt7y524pn72hw4c82abrbn`.
- Run: `ntfsimrun_01m2tt8a68qr0dq8pvzqwq7rm4`.
- Evento: `ntfsimevt_01m2tt8a6gv3fvx6z5qg7baa3m`.
- Resultado Paddle: run `completed` e evento `success`.
- Isso confirma entrega e assinatura do webhook publicado.
- Não excluir essa simulação sem uma decisão explícita do proprietário.

## Ponto exato para continuar

1. Consultar `public.paddle_customers` no Supabase e confirmar a linha criada pela simulação.
2. Consultar `public.subscriptions` e verificar se a assinatura sandbox anterior ainda não foi espelhada. Ela foi comprada antes da criação do destination, portanto provavelmente precisa de backfill ou de um novo evento real.
3. Fazer um checkout sandbox novo pelo site já publicado, usando um usuário autenticado e o cartão de teste `4242 4242 4242 4242`.
4. Confirmar redirecionamento para `/welcome`.
5. Confirmar no Supabase:
   - cliente com `user_id` vinculado;
   - assinatura `active`;
   - plano e ciclo corretos;
   - `price_id`, `product_id` e período preenchidos.
6. Abrir `/planos` com o usuário pago e testar o botão do portal do cliente.
7. Pelo portal, agendar cancelamento no fim do período e confirmar que o acesso permanece ativo até o cancelamento efetivo.
8. Depois do cancelamento efetivo, confirmar a revogação do acesso.

## Pendências técnicas

- A chave API atual não tem `customer.write`. Isso bloqueou apenas uma tentativa opcional de disparar evento alterando metadados; não é necessário ampliar a permissão para o fluxo normal.
- Confirmar no banco a gravação gerada pela simulação; a consulta automática foi interrompida por limite temporário da ferramenta.
- Validar o checkout publicado ponta a ponta após o deploy do webhook.
- Avaliar backfill da assinatura antiga apenas se for necessário manter essa assinatura de teste associada ao usuário.
- Testar estados `past_due`, `paused` e `canceled` com simulações separadas antes do go-live.
- Testar cartão recusado `4000 0000 0000 0002`.
- Antes do ambiente live: criar catálogo, token, API key e notification destination próprios de produção; aprovar o domínio; nunca reutilizar IDs ou segredos sandbox.

## Comandos de validação

Na raiz `web`:

```powershell
npm.cmd test -- --run src/lib/paddle/access.test.ts src/lib/plan-entitlements.test.ts src/lib/__tests__/security-hardening.test.ts
npm.cmd run build
```

Para conferir a branch:

```powershell
git fetch origin
git status
git log -3 --oneline origin/main
```

## Observações

- A integração está deliberadamente em sandbox; nenhum pagamento real deve ser feito agora.
- O trabalho recente do assistente Finn foi preservado no merge da `main`.
- O próximo marco é comprovar o provisionamento no Supabase usando um checkout novo realizado após a ativação do webhook.
