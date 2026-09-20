-- Finn passou a ter o IGP-M (calculado pela FGV, composto a partir da
-- serie mensal do SGS) como um indicador real, alem de Selic/CDI/IPCA.
-- O cartao visual persistido junto da mensagem (ver
-- 20260919000400_ai_message_market_indicators.sql) ganha 2 novas chaves;
-- o check anterior so aceitava exatamente as 7 chaves antigas.
alter table public.ai_messages
  drop constraint if exists ai_messages_market_indicators_check;

alter table public.ai_messages
  add constraint ai_messages_market_indicators_check check (
    market_indicators is null
    or (
      jsonb_typeof(market_indicators) = 'object'
      and (market_indicators ->> 'source') = 'bcb_sgs'
      and (
        market_indicators
        - 'selic_rate_annual' - 'selic_reference_date'
        - 'cdi_rate_annual' - 'cdi_reference_date'
        - 'ipca_12m_percent' - 'ipca_reference_date'
        - 'igpm_12m_percent' - 'igpm_reference_date'
        - 'source'
      ) = '{}'::jsonb
    )
  );
