# Paddle live — prontidão e continuação

Data: 18 de setembro de 2026  
Branch: `feature/paddle-live-readiness`  
Não publicar em produção antes de concluir a verificação e aprovação do domínio live.

## Estado confirmado

- O fluxo Paddle sandbox foi concluído de ponta a ponta.
- Catálogo sandbox permanente preservado; não excluir produtos, preços, clientes, assinaturas, transações ou destino de webhook.
- Área `/planos` e item de navegação reativados apenas nesta branch.
- Página pública `/precos` criada sem checkout, com preços-base:
  - Pro: R$ 19,90/mês ou R$ 199,00/ano;
  - Plus: R$ 39,90/mês ou R$ 399,00/ano.
- Página pública `/reembolso` criada e ligada ao login, preços, Planos e Configurações.
- Política de Privacidade atualizada para indicar a Paddle como processadora de cobrança.
- Contato público: `Finflowfinancas@gmail.com`.
- `pwCustomer` usa somente o ID Paddle `ctm_...` do usuário autenticado.
- Clientes Paddle foram isolados por ambiente (`sandbox` ou `production`) sem apagar registros existentes.
- Webhook live consulta `https://api.paddle.com/ips`, aceita apenas os `/32` retornados e falha fechado.
- Segredos continuam exclusivamente no servidor; a API key não vai para código cliente.
- Validação local: lint aprovado, 80/80 testes aprovados e build Next.js aprovado.

## Ainda obrigatório antes de live

1. Conectar/autorizar o MCP `paddle-live` nesta sessão ou criar uma API key live com permissões mínimas.
2. No live, recriar somente os produtos, preços e descontos válidos do sandbox e registrar o mapa de IDs antigo → novo.
3. Criar um client-side token live (`live_...`).
4. Criar o destino de notificação live para `/api/paddle/webhook` e guardar seu signing secret próprio.
5. Aplicar a migration `20260918000400_paddle_environment_isolation.sql` no Supabase.
6. Configurar somente em Preview/Staging, inicialmente:
   - `NEXT_PUBLIC_PADDLE_ENV=production`
   - `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`
   - os quatro IDs de preço live
   - `PADDLE_API_KEY`
   - `PADDLE_NOTIFICATION_WEBHOOK_SECRET`
7. Solicitar aprovação de `finflow-mauve-chi.vercel.app` ou, preferencialmente, do domínio comercial definitivo em Paddle live > Checkout > Website approval.
8. Depois de aprovado, definir o Default payment link live como `https://DOMINIO-APROVADO/planos`.
9. Validar em staging que PricePreview mostra os valores live e que o checkout abre. Não concluir pagamento real antes da verificação da conta.
10. Confirmar que Termos, Privacidade, Cancelamento/Reembolso, preços, descrição e contato respondem publicamente no domínio aprovado.
11. Só depois promover as variáveis live para Production, integrar esta branch com a `main` e publicar Planos.

## Proteção ao trabalho paralelo

- A árvore principal contém trabalho local do Luis relacionado à IA. Não sobrescrever nem limpar essas mudanças.
- Antes do merge, esperar o trabalho do Luis ser commitado/pushado, atualizar esta branch a partir da `origin/main` e resolver apenas conflitos relacionados a Planos/Paddle.

## Referências oficiais

- Go-live checklist: https://developer.paddle.com/build/go-live-checklist/
- Default payment link: https://developer.paddle.com/build/transactions/default-payment-link/
- Sandbox versus live: https://developer.paddle.com/sdks/sandbox/
- Paddle Retain: https://developer.paddle.com/build/retain/
