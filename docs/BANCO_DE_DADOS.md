# Banco de dados

## Fonte de verdade

O PostgreSQL do Supabase é a fonte de verdade. As migrations versionadas ficam em `supabase/migrations/` e devem ser aplicadas em ordem lexical.

Desde 30/09/2026 a primeira migration é a linha de base `20260929203600_linha_de_base_producao.sql`, gerada do schema de produção: ela recria o banco inteiro (tabelas, funções, RLS, permissões, tarefas `pg_cron` e o pre-request do MFA) num projeto Supabase vazio. As 73 migrations anteriores ficam em `supabase/migrations_archive/` só como histórico e fonte dos testes de contrato; não são mais aplicadas. O histórico de produção (`supabase_migrations.schema_migrations`) contém exatamente os arquivos de `supabase/migrations/`.

Toda segunda-feira o workflow **schema** do repositório privado `FinFlowA/finflow-backups` aplica as migrations num banco vazio e compara com produção; qualquer diferença (mudança feita direto no banco ou migration não aplicada) faz o workflow falhar e o GitHub avisa por e-mail. Ele também pode ser rodado manualmente, inclusive contra uma branch (`ref`) antes do merge.

Ficam fora das migrations e são refeitos à parte num ambiente novo: segredos do Vault (`finflow_push_function_url`), configuração do Auth, secrets das Edge Functions e dados.

## Entidades centrais

| Tabela | Responsabilidade |
|---|---|
| `contas` | Contas financeiras, saldo inicial, cor, arquivamento e compartilhamento |
| `transacoes` | Receitas, despesas, transferências e registros técnicos de pagamento |
| `categorias` | Classificação de receitas/despesas e catálogo do usuário, com meta mensal (`meta_mensal`, receitas) e limite mensal (`limite_mensal`, despesas) opcionais |
| `caixinhas` | Objetivos, meta, saldo, prazo e compartilhamento |
| `cartoes` | Cartões, limite, fechamento, vencimento e estado ativo |
| `fatura_itens` | Compras e cobranças mensais/parceladas de cartão |
| `parcerias` | Convites e vínculos entre usuários |
| `notificacoes_sistema` | Avisos obrigatórios e eventos de parceria |
| `contas_ocultas_usuario` | Visibilidade após dissolução de parceria |
| `parceria_dissolucao_resumos` / `itens` | Auditoria e decisão da separação financeira |

## Assinaturas

| Tabela | Responsabilidade |
|---|---|
| `billing_settings` | Chaves globais `billing_enabled` e `limits_enabled` |
| `billing_products` | Catálogo interno e mapeamento por provedor |
| `subscriptions` | Direito de acesso independente do provedor |
| `subscription_events` | Idempotência e auditoria de eventos de cobrança |
| `paddle_customers` | Vínculo entre customer Paddle, e-mail e usuário Supabase |

O aplicativo e o navegador podem ler somente os direitos do próprio usuário. Escrita de assinatura é reservada a rotas/Edge Functions autorizadas com `service_role` após validação do provedor.

## IA e auditoria

- `ai_pending_actions`: ação preparada aguardando confirmação.
- `ai_action_audit`: trilha de execução.
- `ai_conversations` e `ai_messages`: contexto temporário sujeito à retenção.
- `ai_request_usage`: medição de solicitações.
- `ai_transaction_origins`: associação entre ação da IA e transação criada.

## Tabelas privadas

O schema `private` contém recibos e controles internos, entre eles:

- recibos de conclusão/reabertura de transações;
- recibos da fila offline;
- ledger de pagamento de fatura;
- recibos e vínculos de conciliação bancária;
- reservas de verificação telefônica;
- limites de requisição das Edge Functions;
- tetos de segurança por usuário (`tetos_antiabuso`) e o contador diário de criações (`criacoes_diarias`), descritos em [SEGURANCA.md](./SEGURANCA.md).

Essas tabelas não são API pública do cliente.

## Relações essenciais

```text
auth.users
 ├─ contas ───────────────┐
 │    └─ transacoes       ├─ parcerias autorizam acesso compartilhado
 ├─ categorias ───────────┤
 ├─ caixinhas ────────────┘
 ├─ cartoes ── fatura_itens
 ├─ subscriptions ── billing_products
 └─ paddle_customers
```

`transacoes.transacao_pai_id` liga baixas parciais ao lançamento raiz. Marcadores internos na descrição preservam compatibilidade com séries e movimentos técnicos; eles devem ser manipulados pelas funções de `lib/transacoes.ts` e `web/src/lib/transacoes.ts`, nunca concatenados livremente pela interface.

## RLS e compartilhamento

- Tabelas financeiras devem permanecer com RLS ativa.
- O proprietário acessa seus recursos.
- Um parceiro acessa somente recursos explicitamente compartilhados e enquanto a parceria estiver aceita.
- Compartilhamento não transfere propriedade.
- Recursos arquivados preservam o histórico.
- `service_role` existe apenas no servidor e não substitui a verificação do evento externo.

### Desempenho das regras de acesso

O teste de carga de 02/10/2026 (`scripts/carga/teste-carga.cjs`, ver `TESTES.md`) mostrou que regras escritas como "dono = eu OU função(linha)" impedem o uso de índice: o banco lia a tabela de **todos** os usuários a cada consulta, e o custo crescia com o número de pessoas. Desde a migration `20261002160000_desempenho_regras_de_acesso.sql`:

- **Parceiros:** use `user_id = any ((select public.ids_parceiros_do_usuario())::uuid[])`, que calcula a lista uma vez por consulta. Não use `public.is_parceiro(user_id, auth.uid())` dentro de um `OR` em regras de leitura. O `::uuid[]` é obrigatório: sem ele, `any((select ...))` é lido como subconsulta.
- **Transações:** a regra de leitura compara `conta_id = any (array(<contas visíveis>))` em vez de um `EXISTS` por linha.
- **Consultas paginadas de `transacoes`** (`order by id` com `range`) no app e no site enviam também o filtro explícito de `web/src/lib/transacoes-visiveis.ts` (próprias **ou** das contas visíveis). Com valores escritos na consulta, o banco usa os índices de `user_id` e `conta_id`. A regra de acesso continua valendo por cima. Telas novas devem fazer o mesmo; `transacoes-visiveis.test.ts` confere as atuais.
- **`refresh_my_recurring_schedules`** roda a cada abertura do Início no app e a cada página do site. Ela precisa continuar barata quando não há nada a criar: nada de comparar cada lançamento com todos os outros.
- `supabase/tests/desempenho_rls.test.sql` e `desempenho_recorrencias.test.sql` garantem que essas reescritas mostram e criam exatamente o mesmo que as versões anteriores.

## RPCs públicas importantes

| RPC | Uso |
|---|---|
| `execute_manual_financial_action` | Escritas financeiras manuais compostas |
| `execute_offline_financial_action` / `execute_offline_optimistic_update` | Fila offline idempotente |
| `complete_transaction_with_partial` | Baixa total/parcial com recibo |
| `reopen_transaction_completion` | Reabertura segura |
| `set_transfer_transaction_status` | Conclusão/reabertura de transferência |
| `finance_pay_invoice` / `finance_reverse_invoice_payment` | Pagamento e estorno de fatura |
| `reconcile_bank_*` | Conciliação de extrato, transferências, objetivos e faturas |
| `set_financial_resource_sharing` | Compartilhamento autorizado |
| `get_my_entitlement` / `get_my_plan_usage` | Plano, acesso e consumo |
| `bind_paddle_customer` / `upsert_paddle_subscription` | Provisionamento Paddle server-only |
| `delete_user` | Exclusão atômica após autenticação reforçada |

## Processo de migration

1. Atualize a `main` e confirme o projeto Supabase vinculado.
2. Crie o arquivo com `supabase migration new <nome>` (versão = data e hora). Todo arquivo novo precisa de um comentário `-- Reverter:` explicando como desfazer; o `security:check` do CI recusa a migration sem ele.
3. Revise SQL, impacto, locks, RLS, grants e o plano de reversão.
4. Rode o workflow **schema** contra a sua branch (`ref`) antes do merge: ele aplica a linha de base mais a migration nova num banco vazio. A diferença esperada em relação a produção é só a sua mudança.
5. Aplique em produção com `supabase db push --linked` (confira antes com `--dry-run`), que grava a versão do arquivo no histórico. Se aplicar pelo painel ou pelo MCP, a versão registrada é a hora da aplicação e o histórico diverge: alinhe depois com o workflow **Histórico de migrations** do `finflow-backups`.
6. Rode o workflow **schema** de novo: sem divergências significa que produção e repositório estão iguais.
7. Rode testes de contrato e casos manuais; só depois publique clientes que dependam da nova RPC.

Nunca edite uma migration já aplicada (nem a linha de base) para tentar corrigi-la. Crie uma migration posterior com `create or replace`, `alter` ou correção de dados auditável.

