-- O cartao visual de indicadores (Selic/CDI/IPCA) so existia no payload da
-- resposta ao vivo: ao recarregar o historico da conversa (mode=history), a
-- mensagem salva nao carregava esses dados e o cartao desaparecia mesmo a
-- mensagem sendo identica. Guarda o mesmo objeto de 7 chaves ja exposto ao
-- cliente (nunca o objeto interno maior com valores anteriores, usado so
-- para o modelo responder "mudou recentemente?") junto da mensagem.
alter table public.ai_messages
  add column if not exists market_indicators jsonb;

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
        - 'source'
      ) = '{}'::jsonb
    )
  );
