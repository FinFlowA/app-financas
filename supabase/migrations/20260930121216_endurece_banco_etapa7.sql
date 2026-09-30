-- Etapa 7 da auditoria de segurança: endurece o banco (V08, V09, V12, V13).
--
-- V08  Tetos de segurança por usuário contra abuso da API, aprovados em
--      30/09/2026. Valem em qualquer plano (inclusive Premium) e mesmo com
--      billing_settings.limits_enabled=false; não substituem os limites de
--      plano (public.enforce_finflow_plan_limit). Quem passa do teto recebe
--      FINFLOW_TETO_SEGURANCA:<recurso>:<diario|total>:<teto>, que o app e o
--      site traduzem. Os números ficam em private.tetos_antiabuso. Também
--      limita o tamanho dos campos de texto gravados direto pela API, que
--      hoje aceitam qualquer tamanho, e cria os índices por usuário que a
--      contagem do teto (e o RLS) usam.
-- V09  Visitante sem login (anon) deixa de executar
--      refresh_my_recurring_schedules (a função já recusava sem auth.uid()).
-- V12  pg_net sai do schema public. A extensão não aceita SET SCHEMA, então é
--      recriada em extensions; as funções continuam em net.http_post. O
--      gatilho de push ignora falhas, então nenhum aviso deixa de ser gravado.
-- V13  registrar_dispositivo_push só passa um token de push para outra conta
--      quando o pedido traz o segredo da mesma instalação do app. Antes,
--      quem soubesse o token de outra pessoa podia tomá-lo para si.
--
-- Reverter: numa migration nova, desfaça cada item.
--   V13  drop function public.registrar_dispositivo_push(text, text, text);
--        recriar a versão (p_token text, p_plataforma text) da linha de base,
--        com os mesmos grants; alter table public.dispositivos_push
--        drop column instalacao_hash;
--   V12  drop extension pg_net; create extension pg_net with schema public;
--   V09  grant execute on function public.refresh_my_recurring_schedules() to anon;
--   V08  drop trigger finflow_teto_antiabuso em cada tabela abaixo;
--        drop function private.aplicar_teto_antiabuso();
--        select cron.unschedule('finflow-cleanup-anti-abuse-counters');
--        drop table private.criacoes_diarias, private.tetos_antiabuso;
--        drop constraint de cada <tabela>_<coluna>_tamanho; recriar
--        public.ai_consume_pending_action da linha de base (sem a linha
--        AI_SAFETY_LIMIT_REACHED). Os índices *_user_id_idx podem ficar: só
--        aceleram consultas.

-- ---------------------------------------------------------------------------
-- V08: tamanho máximo dos campos de texto livre.
-- Os limites ficam acima do que o app e o site aceitam (nomes 100,
-- descrições 200, feedback 2.000 caracteres) e dos maiores valores gravados
-- hoje, então nenhum uso legítimo é afetado. cartoes e fatura_itens já usam
-- varchar com tamanho.
-- ---------------------------------------------------------------------------

alter table public.transacoes
  add constraint transacoes_descricao_tamanho check (char_length(descricao) <= 500),
  add constraint transacoes_tipo_tamanho check (char_length(tipo) <= 20),
  add constraint transacoes_status_tamanho check (char_length(status) <= 20);

alter table public.contas
  add constraint contas_nome_tamanho check (char_length(nome) <= 150),
  add constraint contas_cor_tamanho check (char_length(cor) <= 32);

alter table public.caixinhas
  add constraint caixinhas_nome_tamanho check (char_length(nome) <= 150),
  add constraint caixinhas_cor_tamanho check (char_length(cor) <= 32),
  add constraint caixinhas_icone_tamanho check (char_length(icone) <= 64);

alter table public.categorias
  add constraint categorias_nome_tamanho check (char_length(nome) <= 150),
  add constraint categorias_cor_tamanho check (char_length(cor) <= 32),
  add constraint categorias_icone_tamanho check (char_length(icone) <= 64),
  add constraint categorias_tipo_tamanho check (char_length(tipo) <= 20);

alter table public.parceria_caixinha_decisoes
  add constraint parceria_caixinha_decisoes_nome_tamanho check (char_length(nome) <= 150),
  add constraint parceria_caixinha_decisoes_cor_tamanho check (char_length(cor) <= 32),
  add constraint parceria_caixinha_decisoes_icone_tamanho check (char_length(icone) <= 64);

alter table public.feedbacks
  add constraint feedbacks_mensagem_tamanho check (char_length(mensagem) <= 5000),
  add constraint feedbacks_tipo_tamanho check (char_length(tipo) <= 40);

alter table public.chat_historico
  add constraint chat_historico_texto_tamanho check (char_length(texto) <= 4000),
  add constraint chat_historico_role_tamanho check (char_length(role) <= 20);

alter table public.parcerias
  add constraint parcerias_convidado_email_tamanho check (char_length(convidado_email) <= 254);

-- ---------------------------------------------------------------------------
-- V08: índices por dono. A contagem do teto total filtra por usuário, assim
-- como as políticas de RLS; sem índice, cada contagem varreria a tabela
-- inteira. cartoes e fatura_itens já têm idx_*_user_id.
-- ---------------------------------------------------------------------------

create index if not exists transacoes_user_id_idx on public.transacoes using btree (user_id);
create index if not exists contas_user_id_idx on public.contas using btree (user_id);
create index if not exists caixinhas_user_id_idx on public.caixinhas using btree (user_id);
create index if not exists categorias_user_id_idx on public.categorias using btree (user_id);
create index if not exists chat_historico_user_id_idx on public.chat_historico using btree (user_id);

-- ---------------------------------------------------------------------------
-- V08: tetos de segurança por usuário.
-- ---------------------------------------------------------------------------

create table private.tetos_antiabuso (
  recurso text primary key,
  tabela text not null,
  teto_total integer check (teto_total is null or teto_total > 0),
  teto_diario integer check (teto_diario is null or teto_diario > 0),
  constraint tetos_antiabuso_algum_teto check (teto_total is not null or teto_diario is not null)
);

comment on table private.tetos_antiabuso is
  'Tetos de segurança por usuário (auditoria V08), iguais para todos os planos. teto_total conta todas as linhas do usuário na tabela, inclusive arquivadas; teto_diario conta as criadas no dia (America/Sao_Paulo). Mude os números por migration, para ficarem registrados no repositório.';

insert into private.tetos_antiabuso (recurso, tabela, teto_total, teto_diario) values
  ('lancamentos', 'public.transacoes', 50000, 5000),
  ('compras_cartao', 'public.fatura_itens', 20000, 3000),
  ('contas', 'public.contas', 100, null),
  ('objetivos', 'public.caixinhas', 100, null),
  ('cartoes', 'public.cartoes', 50, null),
  ('categorias', 'public.categorias', 300, null),
  ('convites_parceria', 'public.parcerias', null, 10),
  ('feedbacks', 'public.feedbacks', null, 10),
  -- Tabela legada: nenhum código atual grava nela, mas ela continua aberta
  -- para o dono pela API.
  ('historico_finn', 'public.chat_historico', 2000, 300);

create table private.criacoes_diarias (
  user_id uuid not null references auth.users (id) on delete cascade,
  recurso text not null,
  dia date not null,
  total integer not null check (total > 0),
  primary key (user_id, recurso, dia)
);

comment on table private.criacoes_diarias is
  'Quantas linhas cada usuário criou por recurso e dia, para o teto diário da auditoria V08. A tarefa finflow-cleanup-anti-abuse-counters apaga os dias com mais de uma semana.';

revoke all on table private.tetos_antiabuso from public, anon, authenticated, service_role;
revoke all on table private.criacoes_diarias from public, anon, authenticated, service_role;

create or replace function private.aplicar_teto_antiabuso()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  -- Argumentos do gatilho: recurso em private.tetos_antiabuso e a coluna que
  -- identifica o dono da linha (user_id, ou solicitante_id em parcerias).
  v_recurso text := tg_argv[0];
  v_coluna_dono text := coalesce(tg_argv[1], 'user_id');
  v_jwt_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_hoje date := (pg_catalog.clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_teto_total integer;
  v_teto_diario integer;
  v_dono uuid;
  v_novas integer;
  v_usadas bigint;
begin
  -- Mesmo critério de private.enforce_finflow_financial_profile: backends com
  -- service_role (Edge Functions, que têm limites próprios) e manutenção sem
  -- JWT (migrations, SQL editor, restauração de backup) não são criações
  -- feitas pelo usuário. Uma requisição anônima traz role=anon e é contada.
  if v_jwt_role = 'service_role' or ((select auth.uid()) is null and v_jwt_role = '') then
    return null;
  end if;

  select t.teto_total, t.teto_diario
    into v_teto_total, v_teto_diario
  from private.tetos_antiabuso t
  where t.recurso = v_recurso;
  if not found then
    return null;
  end if;

  -- Gatilho por comando: um INSERT em lote (série recorrente, parcelas)
  -- conta todas as linhas de uma vez, agrupadas por dono.
  for v_dono, v_novas in
    select (pg_catalog.to_jsonb(n) ->> v_coluna_dono)::uuid, pg_catalog.count(*)::integer
    from novas_linhas n
    group by 1
  loop
    continue when v_dono is null;

    -- Serializa as criações do mesmo usuário neste recurso até o fim da
    -- transação, para duas requisições simultâneas não passarem juntas do teto.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_dono::text),
      pg_catalog.hashtext('teto_antiabuso:' || v_recurso)
    );

    if v_teto_diario is not null then
      insert into private.criacoes_diarias as c (user_id, recurso, dia, total)
      values (v_dono, v_recurso, v_hoje, v_novas)
      on conflict (user_id, recurso, dia)
        do update set total = c.total + excluded.total
      returning c.total into v_usadas;

      if v_usadas > v_teto_diario then
        raise exception using
          errcode = 'P0001',
          message = pg_catalog.format('FINFLOW_TETO_SEGURANCA:%s:diario:%s', v_recurso, v_teto_diario),
          detail = pg_catalog.format('Teto de segurança de %s criações por dia em %s.', v_teto_diario, v_recurso),
          hint = 'Tetos por usuário da auditoria V08 (private.tetos_antiabuso).';
      end if;
    end if;

    if v_teto_total is not null then
      -- Gatilho AFTER: a contagem já inclui as linhas deste comando.
      execute pg_catalog.format(
        'select pg_catalog.count(*) from %I.%I where %I = $1',
        tg_table_schema, tg_table_name, v_coluna_dono
      ) into v_usadas using v_dono;

      if v_usadas > v_teto_total then
        raise exception using
          errcode = 'P0001',
          message = pg_catalog.format('FINFLOW_TETO_SEGURANCA:%s:total:%s', v_recurso, v_teto_total),
          detail = pg_catalog.format('Teto de segurança de %s linhas por usuário em %s.', v_teto_total, v_recurso),
          hint = 'Tetos por usuário da auditoria V08 (private.tetos_antiabuso).';
      end if;
    end if;
  end loop;

  return null;
end;
$$;

comment on function private.aplicar_teto_antiabuso() is
  'Gatilho AFTER INSERT por comando que aplica os tetos de private.tetos_antiabuso (auditoria V08).';

revoke all on function private.aplicar_teto_antiabuso() from public, anon, authenticated, service_role;

create trigger finflow_teto_antiabuso
  after insert on public.transacoes
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('lancamentos', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.fatura_itens
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('compras_cartao', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.contas
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('contas', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.caixinhas
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('objetivos', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.cartoes
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('cartoes', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.categorias
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('categorias', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.parcerias
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('convites_parceria', 'solicitante_id');

create trigger finflow_teto_antiabuso
  after insert on public.feedbacks
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('feedbacks', 'user_id');

create trigger finflow_teto_antiabuso
  after insert on public.chat_historico
  referencing new table as novas_linhas
  for each statement execute function private.aplicar_teto_antiabuso('historico_finn', 'user_id');

-- O Finn executa as ações pela RPC abaixo, que converte erros desconhecidos
-- em AI_ACTION_EXECUTION_FAILED. Copiada da linha de base com uma única linha
-- nova: o teto de segurança vira AI_SAFETY_LIMIT_REACHED, que a Edge Function
-- finance-ai traduz para o usuário.
CREATE OR REPLACE FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid:=private.ai_assert_authenticated();
  action_row public.ai_pending_actions%rowtype;
  execution_result jsonb;
  quota jsonb;
  error_message text;
  error_state text;
  safe_error text;
  current_state_fingerprint text;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
  where id=p_action_id and user_id=caller for update;
  if not found or action_row.confirmation_token is distinct from p_confirmation_token then
    return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND');
  end if;
  if action_row.status='succeeded' then
    return jsonb_build_object(
      'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','succeeded','result',action_row.result,'replayed',true
    );
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status',action_row.status,
      'error_code',coalesce(
        action_row.last_error_code,
        case action_row.status
          when 'expired' then 'AI_ACTION_EXPIRED'
          when 'cancelled' then 'AI_ACTION_CANCELLED'
          else 'AI_ACTION_NOT_EXECUTABLE'
        end
      ),'replayed',coalesce(action_row.last_error_code='AI_ACTION_STATE_CHANGED',false)
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'status','pending',
      'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota,'replayed',false
    );
  end if;

  if action_row.state_fingerprint is not null then
    begin
      current_state_fingerprint:=private.ai_action_state_fingerprint(
        caller,action_row.action_type,action_row.payload,true
      );
    exception when others then
      current_state_fingerprint:=null;
    end;
    if current_state_fingerprint is distinct from action_row.state_fingerprint then
      update public.ai_pending_actions
      set status='failed',last_error_code='AI_ACTION_STATE_CHANGED'
      where id=action_row.id;
      insert into public.ai_action_audit(
        action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
      ) values(
        action_row.id,caller,action_row.action_type,'failed',action_row.payload,
        'AI_ACTION_STATE_CHANGED',action_row.idempotency_key
      );
      return jsonb_build_object(
        'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
        'status','failed','error_code','AI_ACTION_STATE_CHANGED','replayed',false
      );
    end if;
  end if;

  update public.ai_pending_actions
  set status='executing',last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'executing',
    action_row.payload,action_row.idempotency_key
  );
  begin
    execution_result:=private.ai_execute_financial_action(
      caller,action_row.action_type,action_row.payload,action_row.id
    );
  exception when others then
    get stacked diagnostics
      error_message=message_text,
      error_state=returned_sqlstate;
    safe_error:=case
      when error_state='P0001' and error_message='plan limit reached'
        then 'AI_PLAN_RESOURCE_LIMIT'
      when error_message ~ '^FINFLOW_TETO_SEGURANCA:' then 'AI_SAFETY_LIMIT_REACHED'
      when error_message~'^AI_[A-Z0-9_]+$' then error_message
      else 'AI_ACTION_EXECUTION_FAILED'
    end;
    update public.ai_pending_actions
    set status='failed',last_error_code=safe_error
    where id=action_row.id;
    insert into public.ai_action_audit(
      action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
    ) values(
      action_row.id,caller,action_row.action_type,'failed',action_row.payload,
      safe_error,action_row.idempotency_key
    );
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','failed','error_code',safe_error,'replayed',false
    );
  end;
  update public.ai_pending_actions
  set status='succeeded',result=execution_result,
    executed_at=clock_timestamp(),last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,result,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'succeeded',action_row.payload,
    execution_result,action_row.idempotency_key
  );
  return jsonb_build_object(
    'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','succeeded','result',execution_result,'replayed',false
  );
end;
$_$;

-- O contador só precisa do dia atual; uma semana de folga ajuda a investigar.
select cron.schedule(
  'finflow-cleanup-anti-abuse-counters',
  '23 4 * * *',
  $cron$delete from private.criacoes_diarias where dia < (pg_catalog.now() at time zone 'America/Sao_Paulo')::date - 7;$cron$
);

-- ---------------------------------------------------------------------------
-- V09: sem execução anônima.
-- ---------------------------------------------------------------------------

revoke all on function public.refresh_my_recurring_schedules() from anon;

-- ---------------------------------------------------------------------------
-- V12: pg_net no schema extensions. Nenhum objeto fora da extensão depende
-- dela (conferido em produção em 30/09/2026); pedidos HTTP ainda na fila do
-- pg_net são descartados.
-- ---------------------------------------------------------------------------

drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- V13: o token de push só muda de dono dentro da mesma instalação do app.
-- O app gera um segredo aleatório na primeira execução e o envia a cada
-- registro; o banco guarda só o SHA-256. Um token de outra conta só é
-- transferido quando o segredo confere, como na troca de login no mesmo
-- aparelho. Versões antigas do app, que não enviam o segredo, continuam
-- registrando tokens novos e os próprios.
-- ---------------------------------------------------------------------------

alter table public.dispositivos_push
  add column instalacao_hash text,
  add constraint dispositivos_push_instalacao_hash_check
    check (instalacao_hash is null or instalacao_hash ~ '^[0-9a-f]{64}$');

comment on column public.dispositivos_push.instalacao_hash is
  'SHA-256 (hex) do segredo aleatório da instalação do app que registrou o token (auditoria V13).';

drop function public.registrar_dispositivo_push(text, text);

create function public.registrar_dispositivo_push(
  p_token text,
  p_plataforma text,
  p_instalacao text default null
) returns boolean
language plpgsql
security definer
set search_path to ''
as $_$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_atual public.dispositivos_push%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     or p_plataforma is null or p_plataforma not in ('ios', 'android') then
    raise exception using errcode = '22023', message = 'invalid push token';
  end if;
  if p_instalacao is not null then
    if p_instalacao !~ '^[A-Za-z0-9-]{32,128}$' then
      raise exception using errcode = '22023', message = 'invalid installation id';
    end if;
    v_hash := pg_catalog.encode(extensions.digest(p_instalacao, 'sha256'), 'hex');
  end if;

  select * into v_atual
  from public.dispositivos_push d
  where d.token = p_token
  for update;

  if not found then
    insert into public.dispositivos_push (token, user_id, plataforma, instalacao_hash)
    values (p_token, v_uid, p_plataforma, v_hash)
    on conflict (token) do nothing;
    -- Outro pedido registrou o mesmo token entre a consulta e o INSERT.
    if not found then
      return false;
    end if;
  elsif v_atual.user_id = v_uid then
    update public.dispositivos_push
       set plataforma = p_plataforma,
           instalacao_hash = coalesce(v_hash, v_atual.instalacao_hash),
           atualizado_em = now()
     where token = p_token;
  elsif v_hash is not null and v_atual.instalacao_hash = v_hash then
    -- Mesma instalação do app, outra conta: troca de login no aparelho.
    update public.dispositivos_push
       set user_id = v_uid,
           plataforma = p_plataforma,
           atualizado_em = now()
     where token = p_token;
  else
    -- O token é de outra conta e o pedido não prova ser do mesmo aparelho.
    return false;
  end if;

  delete from public.dispositivos_push d
   where d.user_id = v_uid
     and d.token not in (
       select r.token from public.dispositivos_push r
        where r.user_id = v_uid
        order by r.atualizado_em desc
        limit 10
     );

  return true;
end;
$_$;

comment on function public.registrar_dispositivo_push(text, text, text) is
  'Registra o token de push do aparelho para a conta logada. Retorna false, sem erro, quando o token pertence a outra conta e p_instalacao não prova que é a mesma instalação do app (auditoria V13).';

revoke all on function public.registrar_dispositivo_push(text, text, text) from public, anon;
grant all on function public.registrar_dispositivo_push(text, text, text) to authenticated, service_role;
