-- Limites monetarios defensivos para impedir overflow no cliente, valores
-- absurdos e precisao fracionaria invisivel na interface. NOT VALID preserva
-- registros legados, mas a regra passa a valer imediatamente para novas escritas.

begin;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('contas', 'saldo_inicial', 'contas_saldo_inicial_finflow_money'),
      ('caixinhas', 'meta_valor', 'caixinhas_meta_valor_finflow_money'),
      ('caixinhas', 'saldo_atual', 'caixinhas_saldo_atual_finflow_money'),
      ('cartoes', 'limite', 'cartoes_limite_finflow_money'),
      ('transacoes', 'valor', 'transacoes_valor_finflow_money'),
      ('fatura_itens', 'valor', 'fatura_itens_valor_finflow_money')
    ) as limits(table_name, column_name, constraint_name)
  loop
    if to_regclass('public.' || item.table_name) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = item.table_name
           and c.column_name = item.column_name
       )
       or exists (
         select 1
         from pg_constraint constraint_row
         where constraint_row.conname = item.constraint_name
           and constraint_row.conrelid = to_regclass('public.' || item.table_name)
       ) then
      continue;
    end if;

    execute format(
      'alter table public.%I add constraint %I check ('
      || '%I = round(%I, 2) and abs(%I) <= 999999999999.99'
      || ') not valid',
      item.table_name,
      item.constraint_name,
      item.column_name,
      item.column_name,
      item.column_name
    );
  end loop;
end;
$$;

commit;
