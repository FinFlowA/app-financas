# Continuidade do projeto

Atualizado em 05/10/2026.

## Estado confirmado

- Aplicativo Expo e site Next.js usam o mesmo Supabase.
- Site publicado pela Vercel com login, painel financeiro, Paddle e webhook.
- Paddle sandbox foi testado; a migração para live depende de aprovação/verificação e domínio.
- Planos comerciais: Gratuito, Pro e Plus.
- Google Play Billing ainda não foi implementado.
- CI valida histórico de segredos, app e site; EAS Update depende desses jobs.
- Banco consolidado numa linha de base (`supabase/migrations/20260929203600_linha_de_base_producao.sql`); histórico de produção alinhado aos arquivos e comparado toda semana (ver `BANCO_DE_DADOS.md`).

## Pendências prioritárias

1. ~~Confirmar que todas as migrations da `main` foram aplicadas.~~ Feito em 29/09/2026: a `20260922000100` não estava aplicada e foi aplicada; as demais já estavam.
2. Repetir o teste real de transferência parcelada agendada no aplicativo.
3. Concluir aprovação do domínio e verificação da conta Paddle live.
4. Validar catálogo, webhook, portal e um pagamento live somente depois da aprovação.
5. ~~Corrigir o workflow de backup e testar restauração.~~ Feito em 29/09/2026: backup diário criptografado com restauração testada a cada execução no repositório privado `FinFlowA/finflow-backups` (ver `DEPLOY_E_OPERACAO.md`).
6. Antes da Play Store, implementar Google Play Billing com validação server-side.
7. ~~Criar uma baseline reproduzível do schema para novos ambientes.~~ Feito em 30/09/2026 (linha de base + comparação semanal).
8. ~~Medir a capacidade com o teste de carga e melhorar o carregamento.~~ Feito em 02/10/2026 no projeto Supabase de teste `ejqurfswcmhwfjpgpzdz` (relatório em `TESTE_DE_CARGA_2026-10-02.md`). O limite era o banco: `refresh_my_recurring_schedules` tinha custo quadrático, e as regras de acesso liam a tabela de transações de todos os usuários. As duas coisas foram corrigidas na migration `20261002160000_desempenho_regras_de_acesso.sql` e no filtro explícito de transações do app e do site (ver `BANCO_DE_DADOS.md`). O próximo limite é a CPU do plano gratuito do Supabase: para crescer, o caminho é subir o plano de computação.
9. ~~Corrigir a política de privacidade sobre push.~~ Feito em 02/10/2026: `docs/privacy-policy.md`, a página `/privacidade` do site e a página externa `FinFlowA/finflow-legal` (aberta pelo app) descrevem o token de push dos avisos de parceria, o envio pela Expo e quando o token é apagado. A versão dos documentos (`LEGAL_DOCUMENT_VERSION`) não mudou, porque o banco exige essa versão e trocá-la pediria novo aceite de todos.
10. Ensinar ao Finn a periodicidade das parcelas. O banco já aceita (`installment_frequency`, migration `20261005120000_periodicidade_das_parcelas.sql`) e o app e o site já usam, mas o Finn (Edge Function `finance-ai`) ainda cria parcelas só mensais. Exige publicar a Edge Function (ver `DEPLOY_E_OPERACAO.md`); antes, compare o código publicado (`supabase functions download finance-ai --use-api`) com a `main`, porque há funções cujo código da `main` nunca foi publicado.

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

