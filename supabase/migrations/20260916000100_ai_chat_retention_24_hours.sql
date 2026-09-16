-- FinFlow AI: mensagens de chat são efêmeras e expiram em 24 horas.
-- Auditoria de ações e telemetria mantêm suas janelas técnicas próprias.

begin;

create or replace function public.finflow_cleanup_ai_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_cutoff timestamptz:=clock_timestamp()-interval '24 hours';
  action_cutoff timestamptz:=clock_timestamp()-interval '30 days';
  usage_cutoff timestamptz:=clock_timestamp()-interval '90 days';
  deleted_messages bigint:=0;
  deleted_conversations bigint:=0;
  deleted_actions bigint:=0;
  deleted_audit bigint:=0;
  deleted_usage bigint:=0;
begin
  delete from public.ai_action_audit
  where created_at<action_cutoff;
  get diagnostics deleted_audit=row_count;

  delete from public.ai_pending_actions
  where updated_at<action_cutoff;
  get diagnostics deleted_actions=row_count;

  delete from public.ai_messages
  where created_at<chat_cutoff;
  get diagnostics deleted_messages=row_count;

  delete from public.ai_conversations c
  where c.updated_at<chat_cutoff
    and not exists(
      select 1 from public.ai_messages m
      where m.conversation_id=c.id and m.created_at>=chat_cutoff
    );
  get diagnostics deleted_conversations=row_count;

  delete from public.ai_request_usage
  where created_at<usage_cutoff;
  get diagnostics deleted_usage=row_count;

  return jsonb_build_object(
    'deleted_messages',deleted_messages,
    'deleted_conversations',deleted_conversations,
    'deleted_actions',deleted_actions,
    'deleted_audit',deleted_audit,
    'deleted_usage',deleted_usage
  );
end;
$$;

revoke all on function public.finflow_cleanup_ai_retention()
  from public,anon,authenticated,service_role;

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname='finflow-cleanup-ai-retention';

select cron.schedule(
  'finflow-cleanup-ai-retention',
  '17 * * * *',
  'select public.finflow_cleanup_ai_retention();'
);

select public.finflow_cleanup_ai_retention();

commit;
