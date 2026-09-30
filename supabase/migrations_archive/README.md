# Migrations anteriores à linha de base (arquivo histórico)

Estas migrations **não são mais aplicadas**. Ficam aqui como histórico e
como fonte dos testes de contrato (`scripts/run-*-tests.cjs`,
`scripts/security-check.cjs`).

Em 29/09/2026 o banco foi consolidado numa linha de base
(`supabase/migrations/20260929203600_linha_de_base_producao.sql`) porque:

- as tabelas principais (`contas`, `transacoes`, `categorias`, `caixinhas`,
  `cartoes`, `fatura_itens`, `parcerias`…) foram criadas pelo painel antes das
  migrations existirem, então esta sequência não recriava o banco do zero;
- o histórico de produção e os arquivos tinham divergido.

## Estado do histórico de produção antes da consolidação

- 62 migrations com a mesma versão e nome dos arquivos (até `20260918000300`).
- `20260918000400_paddle_environment_isolation`: aplicada em produção sem
  arquivo no repositório; recuperada do histórico e salva aqui.
- Aplicadas pelo painel/MCP com versão diferente da do arquivo (mesmo nome):

  | Arquivo | Versão registrada em produção |
  |---|---|
  | 20260919000100_fix_invoice_reversal_variable_conflict | 20260919132122 |
  | 20260919000200_fix_web_invoice_interest_wrapper | 20260919132144 |
  | 20260919000300_cron_job_run_details_retention | 20260919133852 |
  | 20260919000400_ai_message_market_indicators | 20260919150839 |
  | 20260929000100_remote_push_for_system_notifications | 20260929145718 |
  | 20260929000200_require_mfa_on_api_requests | 20260929194542 |

- Presentes nos arquivos mas sem registro em produção:
  - `20260920000100_ai_message_market_indicators_igpm`,
    `20260920000200_ai_message_account_balances` e
    `20260928000100_reconcile_bank_statement_entry_as_multiple_new_transactions`:
    o conteúdo já estava em produção (conferido por constraint e md5 das
    funções);
  - `20260922000100_complete_scheduled_transfer_with_archived_account`: **não**
    estava aplicada; foi aplicada em 29/09/2026 antes da consolidação.
- Fora de qualquer migration: tabela `public.finance_ai_debug_log`
  (contadores de depuração do Finn, sem uso); removida em 29/09/2026.

A linha de base foi gerada do schema de produção depois desses ajustes, e o
histórico de produção passou a conter só a versão da linha de base.
