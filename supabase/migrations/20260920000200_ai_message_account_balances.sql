-- Cartao visual com o saldo por conta (limitado as de maior saldo, no
-- maximo 6, com um contador de quantas ficaram de fora) para perguntas que
-- pedem o saldo discriminado entre todas as contas. Mesmo padrao ja usado
-- para os indicadores de mercado: persistido junto da mensagem para o
-- cartao continuar aparecendo ao recarregar o historico, nao so na
-- resposta ao vivo (ver 20260919000400_ai_message_market_indicators.sql).
alter table public.ai_messages
  add column if not exists account_balances jsonb;

alter table public.ai_messages
  add constraint ai_messages_account_balances_check check (
    account_balances is null
    or (
      jsonb_typeof(account_balances) = 'object'
      and (account_balances - 'accounts' - 'hiddenCount' - 'totalBalance') = '{}'::jsonb
      and jsonb_typeof(account_balances -> 'accounts') = 'array'
      and jsonb_array_length(account_balances -> 'accounts') between 1 and 6
      and jsonb_typeof(account_balances -> 'hiddenCount') = 'number'
      and jsonb_typeof(account_balances -> 'totalBalance') = 'number'
    )
  );
