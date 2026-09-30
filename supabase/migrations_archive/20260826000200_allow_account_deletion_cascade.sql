begin;

-- Atualiza a função já instalada sem duplicar sua rotina de limpeza. Durante o
-- cascade, os gatilhos de elegibilidade reconhecem o role administrativo; a
-- sessão e as pendências continuam sendo validadas antes desta marcação.
do $migration$
declare
  definition text;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
    into definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'delete_user'
     and p.pronargs = 0;

  if definition is null then
    raise exception 'delete_user function not found';
  end if;

  definition := replace(
    definition,
    '  if uid is null then',
    $replace$  if uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_set(
      coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
      '{role}',
      '"service_role"'::jsonb
    )::text,
    true
  );

  if uid is null then$replace$
  );

  execute definition;
end;
$migration$;

commit;
