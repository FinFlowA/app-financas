-- Mantém o catálogo interno alinhado aos preços ativos no Paddle Sandbox.
-- Os IDs externos continuam nas variáveis de ambiente do site.

update public.billing_products
set amount_brl = case code
  when 'smart_monthly' then 19.90
  when 'smart_annual' then 199.00
  when 'premium_monthly' then 39.90
  when 'premium_annual' then 399.00
  else amount_brl
end,
updated_at = now()
where code in (
  'smart_monthly',
  'smart_annual',
  'premium_monthly',
  'premium_annual'
);
