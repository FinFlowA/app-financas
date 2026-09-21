# Paddle live — prontidão e continuação

Data: 18 de setembro de 2026  
Branch: `feature/paddle-live-readiness`  
Não publicar em produção antes de concluir a verificação e aprovação do domínio live.

## Retomada em outra máquina

1. Clone ou atualize o repositório `FinFlowA/app-financas`.
2. Abra a branch remota `feature/paddle-live-readiness` no commit mínimo `6b62996`.
3. Dentro de `web`, execute `npm ci`, `npm test`, `npm run lint` e `npm run build`.
4. Instale/ative o plugin Paddle e conecte os dois servidores: `paddle-sandbox` e `paddle-live`.
5. Não copie secrets pelo Git, chat ou arquivos versionados. Reconfigure-os no gerenciador local e na Vercel.
6. Use Preview/Staging para a primeira configuração live; mantenha Production sem checkout live até a aprovação.

Comandos de referência:

```bash
git clone https://github.com/FinFlowA/app-financas.git
cd app-financas
git fetch origin
git switch --track origin/feature/paddle-live-readiness
cd web
npm ci
npm test
npm run lint
npm run build
```

Se a branch já existir localmente, use `git switch feature/paddle-live-readiness` e `git pull --ff-only`.

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

## IDs permanentes do sandbox — não excluir

- Destino de notificação: `ntfset_01m2tr4p5fn4vs3b3xnb4g4cxg`
- Pro mensal: `pri_01m2t95sany6c2th000xwbjd6p`
- Pro anual: `pri_01m2t95sffza6sycm34snnw88b`
- Plus mensal: `pri_01m2t95sxye0jx1awcckf3apra`
- Plus anual: `pri_01m2t95t3jr4qhtn24xsraz1tw`
- Transação validada: `txn_01m2tq8468f1beg5cqj1gk679f`
- Assinatura validada: `sub_01m2tq97bwf5ysqdtepssd406j`
- Cliente validado: `ctm_01m2tq843xr23h5z83gnsrmfr3`

Esses registros comprovam e sustentam o fluxo de fulfillment testado. Não tratá-los como lixo de teste.

## Infraestrutura permanente do Paddle live

Criada em 21 de setembro de 2026. Não excluir nem recriar:

- Produto Smart/Pro: `pro_01m31z93ww1qx4g75jb3rq6j7f`
- Produto Premium/Plus: `pro_01m31z940teay8e08grztxx5hz`
- Pro mensal: `pri_01m31z944w33tbygze6th02t9c`
- Pro anual: `pri_01m31z9492qvwa1sf7m2kxfy59`
- Plus mensal: `pri_01m31z94d1ag7nmm99r5bpk6xp`
- Plus anual: `pri_01m31z94g75jpbs7wtnwxkbax3`
- Client-side token: `ctkn_01m31zdgb48gvxf74mddjjb4ef`
- Destino de notificação: `ntfset_01m31zdgfyrv31vfescqf0tbad`
- Endpoint: `https://finflow-mauve-chi.vercel.app/api/paddle/webhook`
- Eventos: `subscription.created`, `subscription.updated`, `subscription.canceled`, `customer.created`, `customer.updated` e `transaction.completed`

O valor do client-side token e o signing secret não são versionados. Não havia descontos ativos no live; a leitura de descontos do sandbox ficou indisponível por falta de `discount.read`, portanto nenhum desconto foi inventado ou migrado.

### Mapa sandbox → live

| Plano | Sandbox | Live |
| --- | --- | --- |
| Pro mensal | `pri_01m2t95sany6c2th000xwbjd6p` | `pri_01m31z944w33tbygze6th02t9c` |
| Pro anual | `pri_01m2t95sffza6sycm34snnw88b` | `pri_01m31z9492qvwa1sf7m2kxfy59` |
| Plus mensal | `pri_01m2t95sxye0jx1awcckf3apra` | `pri_01m31z94d1ag7nmm99r5bpk6xp` |
| Plus anual | `pri_01m2t95t3jr4qhtn24xsraz1tw` | `pri_01m31z94g75jpbs7wtnwxkbax3` |

### Bloqueio atual

- Criar manualmente uma API key no Paddle Live; o MCP não oferece essa operação.
- Depois configurar todas as variáveis Paddle Live juntas no ambiente Vercel Preview, mantendo Production inalterado até aprovação.

## Critérios para considerar concluído

- Existe mapa documentado dos quatro IDs sandbox para os quatro IDs live.
- Catálogo e preços live coincidem com a página pública.
- Token cliente live começa com `live_`; API key e signing secret nunca aparecem no frontend.
- Webhook live recebe eventos assinados no domínio de staging e rejeita assinatura/IP inválidos.
- Migration de isolamento por ambiente foi aplicada e clientes sandbox continuam intactos.
- Portal do cliente abre usando o customer ID live do usuário autenticado.
- Domínio real está aprovado e é o Default payment link live.
- `/termos`, `/privacidade`, `/reembolso`, `/precos` e contato são públicos e retornam conteúdo correto.
- Checkout live abre em staging com os preços corretos; nenhuma compra real é feita antes da verificação.
- Só após todos os itens acima a branch é atualizada com a main, revisada, mesclada e publicada.

## Proteção ao trabalho paralelo

- A árvore principal contém trabalho local do Luis relacionado à IA. Não sobrescrever nem limpar essas mudanças.
- Antes do merge, esperar o trabalho do Luis ser commitado/pushado, atualizar esta branch a partir da `origin/main` e resolver apenas conflitos relacionados a Planos/Paddle.

## Referências oficiais

- Go-live checklist: https://developer.paddle.com/build/go-live-checklist/
- Default payment link: https://developer.paddle.com/build/transactions/default-payment-link/
- Sandbox versus live: https://developer.paddle.com/sdks/sandbox/
- Paddle Retain: https://developer.paddle.com/build/retain/
