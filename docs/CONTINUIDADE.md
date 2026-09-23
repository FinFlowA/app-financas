# Continuidade do projeto

Atualizado em 22/09/2026.

## Estado confirmado

- Aplicativo Expo e site Next.js usam o mesmo Supabase.
- Site publicado pela Vercel com login, painel financeiro, Paddle e webhook.
- Paddle sandbox foi testado; a migração para live depende de aprovação/verificação e domínio.
- Planos comerciais: Gratuito, Pro e Plus.
- Google Play Billing ainda não foi implementado.
- CI valida histórico de segredos, app e site; EAS Update depende desses jobs.
- Migration mais recente do repositório: `20260922000100_complete_scheduled_transfer_with_archived_account.sql`.

## Pendências prioritárias

1. Confirmar que todas as migrations da `main`, inclusive `20260922000100`, foram aplicadas ao Supabase usado pelos clientes.
2. Repetir o teste real de transferência parcelada agendada no aplicativo.
3. Concluir aprovação do domínio e verificação da conta Paddle live.
4. Validar catálogo, webhook, portal e um pagamento live somente depois da aprovação.
5. Corrigir o workflow de backup caso continue falhando e testar restauração.
6. Antes da Play Store, implementar Google Play Billing com validação server-side.
7. Criar uma baseline reproduzível do schema para novos ambientes.

## Áreas que exigem coordenação

- IA/Finn: contratos, Edge Function e RPCs devem mudar juntos; alinhar com o responsável antes de editar.
- Cobrança: não reutilizar credenciais ou IDs entre sandbox/live.
- Banco: não editar migrations aplicadas e não fazer DML manual para “corrigir” ledgers.
- Dados permanentes: não excluir produtos, preços, destinations, customers, subscriptions, transactions ou espelhos de produção/sandbox como limpeza.

## Procedimento para retomar em outra máquina

```bash
git clone https://github.com/FinFlowA/app-financas.git
cd app-financas
git switch main
git pull --ff-only origin main
npm ci
cd web
npm ci
```

Depois:

1. crie `.env.local` na raiz e em `web/` usando os exemplos;
2. obtenha valores pelos cofres/painéis autorizados, nunca por documentos;
3. rode tipos e testes básicos;
4. confira `git status` antes de alterar;
5. crie branch específica e evite misturar mudanças da IA, pagamentos e finanças sem necessidade.

## Verificação rápida

```bash
git status
git log -5 --oneline
npx tsc --noEmit
npm run test:transaction-completion
cd web
npm test
npm run build
```

## Referências históricas

- `HANDOFF_*.md`: estado observado em datas anteriores.
- `PADDLE_HANDOFF_2026-09-18.md`: sandbox e infraestrutura criada naquela etapa.
- `security/`: auditorias e provas de conceito datadas.

Handoffs não substituem este documento nem o código atual.
# Google Play Billing

A preparação da cobrança nativa Android está na branch `feature/paddle-live-readiness`. Antes do lançamento, siga o checklist completo em [GOOGLE_PLAY_BILLING.md](./GOOGLE_PLAY_BILLING.md). A integração ainda não foi publicada no Supabase nem pode ser testada sem o cadastro do app e dos produtos no Play Console.

