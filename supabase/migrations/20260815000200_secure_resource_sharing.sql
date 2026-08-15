-- FinFlow web: compartilhamento explicito, idempotente e com concorrencia
-- otimista para contas e objetivos.
--
-- O cliente nunca atualiza `compartilhado` diretamente. Esta RPC garante que:
--   * somente o titular pode mudar a visibilidade;
--   * compartilhar exige uma parceria aceita e ainda existente;
--   * itens arquivados nao podem ser expostos ao parceiro;
--   * uma tela antiga nao sobrescreve uma alteracao feita em outro dispositivo;
--   * repeticoes de rede nao alternam o estado duas vezes.

begin;

do $$
begin
  if pg_catalog.to_regclass('private.offline_action_receipts') is null
     or pg_catalog.to_regclass('public.contas') is null
     or pg_catalog.to_regclass('public.caixinhas') is null
     or pg_catalog.to_regclass('public.parcerias') is null then
    raise exception 'FINFLOW_SHARING_CORE_MISSING';
  end if;
end;
$$;

-- Fecha a janela entre a auditoria abaixo e a instalacao do trigger.
lock table public.parcerias in share row exclusive mode;

-- O produto admite uma unica parceria ativa por pessoa. Sem essa invariavel,
-- o booleano `compartilhado` tornaria o mesmo recurso visivel para todos os
-- parceiros aceitos do titular. Falhar cedo evita instalar uma protecao sobre
-- dados que ja estejam ambiguos.
do $$
declare
  duplicated_participant uuid;
begin
  select participant_id into duplicated_participant
  from (
    select p.solicitante_id as participant_id
    from public.parcerias p
    where p.status = 'aceito'
    union all
    select p.convidado_id as participant_id
    from public.parcerias p
    where p.status = 'aceito' and p.convidado_id is not null
  ) accepted_participants
  where participant_id is not null
  group by participant_id
  having pg_catalog.count(*) > 1
  limit 1;

  if duplicated_participant is not null then
    raise exception using
      errcode = 'P0001',
      message = 'FINFLOW_DUPLICATE_ACCEPTED_PARTNERSHIP';
  end if;
end;
$$;

-- Serializa qualquer aceite que envolva as mesmas pessoas. A ordenacao dos
-- UUIDs fecha inclusive a corrida de dois convites cruzados (A -> B e B -> A).
create or replace function private.finflow_lock_participants(
  p_first uuid,
  p_second uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_participant uuid;
  second_participant uuid;
begin
  if p_first is null or p_second is null then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_PARTNERSHIP';
  end if;

  if p_first::text <= p_second::text then
    first_participant := p_first;
    second_participant := p_second;
  else
    first_participant := p_second;
    second_participant := p_first;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || first_participant::text, 73119)
  );
  if second_participant is distinct from first_participant then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('finflow:participant:' || second_participant::text, 73119)
    );
  end if;
end;
$$;

revoke all on function private.finflow_lock_participants(uuid,uuid)
  from public, anon, authenticated;

create or replace function private.finflow_enforce_single_accepted_partnership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'aceito' then
    return new;
  end if;
  if new.solicitante_id is null
     or new.convidado_id is null
     or new.solicitante_id = new.convidado_id then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_PARTNERSHIP';
  end if;

  perform private.finflow_lock_participants(new.solicitante_id, new.convidado_id);

  if exists (
    select 1
    from public.parcerias p
    where p.status = 'aceito'
      and p.id is distinct from new.id
      and (
        p.solicitante_id in (new.solicitante_id, new.convidado_id)
        or p.convidado_id in (new.solicitante_id, new.convidado_id)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FINFLOW_PARTNERSHIP_ALREADY_ACTIVE';
  end if;
  return new;
end;
$$;

revoke all on function private.finflow_enforce_single_accepted_partnership()
  from public, anon, authenticated;

drop trigger if exists finflow_enforce_single_accepted_partnership
  on public.parcerias;
create trigger finflow_enforce_single_accepted_partnership
before insert or update of status, solicitante_id, convidado_id
on public.parcerias
for each row execute function private.finflow_enforce_single_accepted_partnership();

-- O trigger por statement roda antes de qualquer linha do UPDATE direto ser
-- travada. Isso preserva a ordem canonica parceria -> recurso tambem para o
-- mobile legado e impede que uma conta seja compartilhada quando a dissolucao
-- ja estiver percorrendo os recursos do casal.
create or replace function private.finflow_lock_callers_partnership_for_sharing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  accepted_partnership_id bigint;
  requester_id uuid;
  invitee_id uuid;
  first_participant uuid;
  second_participant uuid;
begin
  -- RPCs SECURITY DEFINER (inclusive a dissolucao) ja usam o lock canonico e
  -- nao podem inverter a ordem tentando adquirir a trava de participante aqui.
  -- O trigger por statement existe apenas para DML legado feito pela API.
  if current_user not in ('authenticated', 'anon') or caller is null then
    return null;
  end if;

  select p.id, p.solicitante_id, p.convidado_id
    into accepted_partnership_id, requester_id, invitee_id
  from public.parcerias p
  where p.status = 'aceito'
    and p.convidado_id is not null
    and (
      (p.solicitante_id = caller and p.convidado_id <> caller)
      or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
  order by p.id
  limit 1;
  if not found then
    return null;
  end if;

  if requester_id::text <= invitee_id::text then
    first_participant := requester_id;
    second_participant := invitee_id;
  else
    first_participant := invitee_id;
    second_participant := requester_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || first_participant::text, 73119)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || second_participant::text, 73119)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finflow:partnership:' || accepted_partnership_id::text,
      73119
    )
  );
  perform 1
  from public.parcerias p
  where p.id = accepted_partnership_id
    and p.status = 'aceito'
    and (
      (p.solicitante_id = caller and p.convidado_id <> caller)
      or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
  for share;
  return null;
end;
$$;

revoke all on function private.finflow_lock_callers_partnership_for_sharing()
  from public, anon, authenticated;

drop trigger if exists finflow_lock_account_partnership_for_sharing on public.contas;
create trigger finflow_lock_account_partnership_for_sharing
before update of compartilhado on public.contas
for each statement execute function private.finflow_lock_callers_partnership_for_sharing();

drop trigger if exists finflow_lock_goal_partnership_for_sharing on public.caixinhas;
create trigger finflow_lock_goal_partnership_for_sharing
before update of compartilhado on public.caixinhas
for each statement execute function private.finflow_lock_callers_partnership_for_sharing();

-- Compatibilidade com o aplicativo legado: ele ainda pode atualizar o campo
-- diretamente, mas o banco aplica as mesmas invariantes. Arquivar sempre torna
-- o recurso privado dentro do proprio UPDATE, sem janela de exposicao.
create or replace function private.finflow_enforce_resource_sharing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_count integer;
  accepted_partnership_id bigint;
begin
  if new.user_id is null then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_RESOURCE_OWNER';
  end if;

  if coalesce(new.arquivado, false) then
    if coalesce(new.compartilhado, false) then
      if tg_op = 'INSERT' then
        raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
      elsif not coalesce(old.compartilhado, false) then
        raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
      end if;
    end if;
    new.compartilhado := false;
    return new;
  end if;

  if coalesce(new.compartilhado, false) then
    -- O aceite usa a mesma trava; assim dois aceites concorrentes nao podem
    -- passar entre esta validacao e o commit do compartilhamento direto.
    perform private.finflow_lock_participants(new.user_id, new.user_id);
    select pg_catalog.min(p.id), pg_catalog.count(*)
      into accepted_partnership_id, accepted_count
    from public.parcerias p
    where p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = new.user_id and p.convidado_id <> new.user_id)
        or (p.convidado_id = new.user_id and p.solicitante_id <> new.user_id)
      );
    if accepted_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'FINFLOW_EXACTLY_ONE_ACCEPTED_PARTNERSHIP_REQUIRED';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'finflow:partnership:' || accepted_partnership_id::text,
        73119
      )
    );
    perform 1
    from public.parcerias p
    where p.id = accepted_partnership_id
      and p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = new.user_id and p.convidado_id <> new.user_id)
        or (p.convidado_id = new.user_id and p.solicitante_id <> new.user_id)
      )
    for share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'FINFLOW_EXACTLY_ONE_ACCEPTED_PARTNERSHIP_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.finflow_enforce_resource_sharing()
  from public, anon, authenticated;

drop trigger if exists finflow_enforce_account_sharing on public.contas;
create trigger finflow_enforce_account_sharing
before insert or update of compartilhado, arquivado
on public.contas
for each row execute function private.finflow_enforce_resource_sharing();

drop trigger if exists finflow_enforce_goal_sharing on public.caixinhas;
create trigger finflow_enforce_goal_sharing
before insert or update of compartilhado, arquivado
on public.caixinhas
for each row execute function private.finflow_enforce_resource_sharing();

-- Corrige qualquer estado legado antes de endurecer a leitura do parceiro.
-- Um recurso que ficou marcado como compartilhado depois de uma dissolucao nao
-- pode reaparecer automaticamente quando o titular formar uma nova parceria.
update public.contas c
set compartilhado = false
where coalesce(c.compartilhado, false)
  and (
    coalesce(c.arquivado, false)
    or 1 <> (
      select pg_catalog.count(*)
      from public.parcerias p
      where p.status = 'aceito'
        and p.convidado_id is not null
        and (
          (p.solicitante_id = c.user_id and p.convidado_id <> c.user_id)
          or (p.convidado_id = c.user_id and p.solicitante_id <> c.user_id)
        )
    )
  );
update public.caixinhas g
set compartilhado = false
where coalesce(g.compartilhado, false)
  and (
    coalesce(g.arquivado, false)
    or 1 <> (
      select pg_catalog.count(*)
      from public.parcerias p
      where p.status = 'aceito'
        and p.convidado_id is not null
        and (
          (p.solicitante_id = g.user_id and p.convidado_id <> g.user_id)
          or (p.convidado_id = g.user_id and p.solicitante_id <> g.user_id)
        )
    )
  );

drop policy if exists "contas_partner_select" on public.contas;
create policy "contas_partner_select"
  on public.contas for select to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

drop policy if exists "caixinhas_partner_select" on public.caixinhas;
create policy "caixinhas_partner_select"
  on public.caixinhas for select to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

drop policy if exists "caixinhas_partner_update" on public.caixinhas;
create policy "caixinhas_partner_update"
  on public.caixinhas for update to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  )
  with check (
    not coalesce(arquivado, false)
    and compartilhado is true
    and public.is_parceiro(user_id, (select auth.uid()))
  );

create or replace function public.set_financial_resource_sharing(
  p_resource_type text,
  p_resource_id bigint,
  p_shared boolean,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_expected_user_id uuid,
  p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  action_name text;
  request_payload jsonb;
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  partnership_id bigint;
  current_version bigint;
  final_version bigint;
  current_shared boolean;
  is_archived boolean;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_MISMATCH';
  end if;
  if p_resource_type is null or p_resource_type not in ('account', 'goal')
     or p_resource_id is null or p_resource_id <= 0
     or p_shared is null
     or p_expected_version is null or p_expected_version <= 0 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at < pg_catalog.clock_timestamp() - interval '30 days'
     or p_client_created_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'OFFLINE_OPERATION_EXPIRED';
  end if;

  action_name := 'set_' || p_resource_type || '_sharing';
  request_payload := pg_catalog.jsonb_build_object(
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'shared', p_shared,
    'expected_version', p_expected_version
  );
  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(action_name, request_payload)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Mantem a mesma serializacao por usuario dos executores financeiro e
  -- offline. Isso tambem protege o namespace compartilhado de request_id.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text, 81277)
  );

  select * into existing
  from private.offline_action_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    if existing.action_type <> action_name or existing.payload_hash <> request_hash then
      raise exception using errcode = 'P0001', message = 'OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'receipt_id', existing.id,
      'result', existing.result
    );
  end if;

  select pg_catalog.count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 180 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Para expor um recurso, usa exatamente a trava canonica da dissolucao e das
  -- operacoes financeiras: advisory da parceria, linha da parceria e recurso.
  if p_shared then
    perform private.finflow_lock_participants(caller, caller);
    select p.id into partnership_id
    from public.parcerias p
    where p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = caller and p.convidado_id <> caller)
        or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
    order by p.id
    limit 1;

    if not found then
      raise exception using errcode = 'P0001', message = 'AI_PARTNERSHIP_NOT_FOUND';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('finflow:partnership:' || partnership_id::text, 73119)
    );
    perform 1
    from public.parcerias p
    where p.id = partnership_id
      and p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = caller and p.convidado_id <> caller)
        or (p.convidado_id = caller and p.solicitante_id <> caller)
      )
    for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_PARTNERSHIP_NOT_FOUND';
    end if;
  end if;

  if p_resource_type = 'account' then
    select c.version, coalesce(c.compartilhado, false), coalesce(c.arquivado, false)
      into current_version, current_shared, is_archived
    from public.contas c
    where c.id = p_resource_id and c.user_id = caller
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_ACCOUNT_NOT_FOUND';
    end if;
  else
    select g.version, coalesce(g.compartilhado, false), coalesce(g.arquivado, false)
      into current_version, current_shared, is_archived
    from public.caixinhas g
    where g.id = p_resource_id and g.user_id = caller
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_GOAL_NOT_FOUND';
    end if;
  end if;

  if p_shared and is_archived then
    raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
  end if;

  -- Uma repeticao com outra chave continua sendo segura: se o estado desejado
  -- ja foi atingido, retorna sucesso sem incrementar a versao novamente.
  if current_shared is distinct from p_shared then
    if current_version is distinct from p_expected_version then
      raise exception using errcode = 'P0001', message = 'OFFLINE_VERSION_CONFLICT';
    end if;
    if p_resource_type = 'account' then
      update public.contas
      set compartilhado = p_shared
      where id = p_resource_id and user_id = caller;
      select version into final_version from public.contas where id = p_resource_id;
    else
      update public.caixinhas
      set compartilhado = p_shared
      where id = p_resource_id and user_id = caller;
      select version into final_version from public.caixinhas where id = p_resource_id;
    end if;
  else
    final_version := current_version;
  end if;

  execution_result := pg_catalog.jsonb_build_object(
    'resource', p_resource_type,
    'id', p_resource_id,
    'shared', p_shared,
    'changed', current_shared is distinct from p_shared,
    'version', final_version,
    'partnership_id', partnership_id
  );

  insert into private.offline_action_receipts (
    user_id,
    idempotency_key,
    action_type,
    payload_hash,
    result,
    client_created_at
  ) values (
    caller,
    p_idempotency_key,
    action_name,
    request_hash,
    execution_result,
    p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'receipt_id', existing.id,
    'result', execution_result
  );
end;
$$;

revoke all on function public.set_financial_resource_sharing(text,bigint,boolean,bigint,uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_financial_resource_sharing(text,bigint,boolean,bigint,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.set_financial_resource_sharing(text,bigint,boolean,bigint,uuid,uuid,timestamptz) is
  'Compartilha ou torna privada uma conta/objetivo do titular com parceria aceita, versao otimista, lock e recibo idempotente.';

commit;
