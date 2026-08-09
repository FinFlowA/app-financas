-- FinFlow: remove expressoes que tentavam materializar o byte NUL em text.
-- PostgreSQL rejeita NUL antes mesmo de uma validacao poder inspeciona-lo.

begin;

alter table public.ai_messages
  drop constraint if exists ai_messages_content_check;

alter table public.ai_messages
  add constraint ai_messages_content_check check (
    length(btrim(content)) between 1 and 2000
    and content !~* '(sb_secret_|service_role[^[:space:]]{0,8}[=:]|gsk_[A-Za-z0-9_-]{20,}|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,})'
  );

create or replace function private.ai_text(
  payload jsonb,
  key_name text,
  max_length integer,
  allow_empty boolean default false
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare value text;
begin
  if jsonb_typeof(payload -> key_name) <> 'string' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  value := btrim(payload ->> key_name);
  if (not allow_empty and value = '') or length(value) > max_length then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value;
end;
$$;

-- O corpo desta funcao e grande e ja foi aplicado em producao. Para manter
-- exatamente a mesma logica de locks/estado, substituimos somente a expressao
-- de framing do hash. jsonb_build_array produz uma representacao canonica e
-- sem ambiguidades entre action_name e state_snapshot.
do $repair_state_fingerprint$
declare
  function_definition text;
  patched_definition text;
  legacy_expression text :=
    'convert_to(''finflow-ai-state-v1''||chr(' ||
    '0)||action_name||chr(' ||
    '0)||state_snapshot::text,''UTF8'')';
  safe_expression text :=
    'convert_to(jsonb_build_array(''finflow-ai-state-v1'',action_name,state_snapshot)::text,''UTF8'')';
begin
  if to_regprocedure('private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)') is null then
    raise exception 'AI_STATE_FINGERPRINT_FUNCTION_MISSING';
  end if;

  select pg_get_functiondef(
    'private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)'::regprocedure
  ) into function_definition;

  if position(legacy_expression in function_definition) > 0 then
    patched_definition := replace(function_definition, legacy_expression, safe_expression);
    if patched_definition = function_definition then
      raise exception 'AI_STATE_FINGERPRINT_NUL_REPAIR_FAILED';
    end if;
    execute patched_definition;
  elsif position(safe_expression in function_definition) = 0 then
    raise exception 'AI_STATE_FINGERPRINT_UNEXPECTED_DEFINITION';
  end if;
end;
$repair_state_fingerprint$;

revoke all on function private.ai_text(jsonb,text,integer,boolean)
  from public, anon, authenticated;
revoke all on function private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)
  from public, anon, authenticated;

commit;
