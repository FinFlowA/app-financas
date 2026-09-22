# Banco de dados

## Fonte de verdade

O PostgreSQL do Supabase é a fonte de verdade. As migrations versionadas ficam em `supabase/migrations/` e devem ser aplicadas em ordem lexical.

O repositório ainda não contém uma baseline única que recrie todas as tabelas centrais antigas do zero. Antes de montar um ambiente vazio, gere e revise um schema do banco autorizado; não presuma que somente as migrations atuais bastam para reconstrução integral.

## Entidades centrais

| Tabela | Responsabilidade |
|---|---|
| `contas` | Contas financeiras, saldo inicial, cor, arquivamento e compartilhamento |
| `transacoes` | Receitas, despesas, transferências e registros técnicos de pagamento |
| `categorias` | Classificação de receitas/despesas e catálogo do usuário |
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
- limites de requisição das Edge Functions.

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
2. Faça backup e consulte `supabase migration list --linked`.
3. Revise SQL, impacto, locks, RLS, grants e rollback lógico.
4. Execute `supabase db push --linked --dry-run`.
5. Aplique primeiro em ambiente controlado.
6. Rode testes de contrato e casos manuais.
7. Só depois publique clientes que dependam da nova RPC.

Nunca edite uma migration já aplicada para tentar corrigi-la. Crie uma migration posterior com `create or replace`, `alter` ou correção de dados auditável.

