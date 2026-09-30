-- FinFlow: exige reautenticação recente no servidor antes de apagar a conta.
--
-- Até aqui, delete_user() só checava auth.uid(): qualquer JWT válido de
-- authenticated bastava para apagar a conta inteira, mesmo que a senha/
-- biometria exibida na interface nunca tivesse sido validada pelo servidor.
-- Um token roubado (ex.: XSS, dispositivo comprometido) era suficiente.
--
-- A correção usa o claim "amr" (Authentication Method Reference) que o
-- GoTrue já inclui em todo JWT, com o timestamp de cada autenticação. Um
-- signInWithPassword() recente gera uma sessão nova com amr atualizado; a
-- função passa a exigir que essa autenticação tenha acontecido há poucos
-- minutos, sem depender de nenhuma confirmação feita só no cliente.

begin;

create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  amr_entries jsonb;
  entry jsonb;
  entry_ts bigint;
  latest_ts bigint := 0;
begin
  if uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  amr_entries := coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb);
  for entry in select * from jsonb_array_elements(amr_entries)
  loop
    entry_ts := nullif(entry ->> 'timestamp', '')::bigint;
    if entry_ts is not null and entry_ts > latest_ts then
      latest_ts := entry_ts;
    end if;
  end loop;

  -- Falha fechado: sem nenhuma entrada de autenticação reconhecível, ou mais
  -- velha que a janela de tolerância, a exclusão é recusada. O cliente deve
  -- chamar signInWithPassword() imediatamente antes desta RPC.
  if latest_ts = 0
     or pg_catalog.to_timestamp(latest_ts) < (pg_catalog.clock_timestamp() - interval '10 minutes') then
    raise exception using errcode = 'P0001', message = 'AUTH_STEP_UP_REQUIRED';
  end if;

  delete from public.chat_historico where user_id = uid;
  delete from public.transacoes     where user_id = uid;
  delete from public.caixinhas      where user_id = uid;
  delete from public.contas         where user_id = uid;
  delete from public.categorias     where user_id = uid;
  delete from public.feedbacks      where user_id = uid;
  delete from public.parcerias
    where solicitante_id = uid or convidado_id = uid;
  delete from auth.users            where id = uid;
end;
$$;

comment on function public.delete_user() is
  'Apaga a conta e todos os dados do usuário autenticado em uma única transação. Exige reautenticação de senha nos últimos 10 minutos (claim amr do JWT) — falha fechado sem ela.';

commit;
