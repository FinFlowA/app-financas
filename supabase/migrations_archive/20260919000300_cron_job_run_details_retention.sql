-- cron.job_run_details acumula uma linha por execucao dos jobs agendados
-- (a cada 10 min, a cada hora, diarios) e virou a maior tabela do banco sem
-- guardar nenhum dado de usuario -- so historico de execucao. Mesmo padrao de
-- retencao ja usado em finflow_cleanup_external_edge_retention e
-- cleanup_transaction_completion_receipts: funcao dedicada + job do pg_cron.
begin;

create or replace function public.finflow_cleanup_cron_job_run_details()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_runs bigint := 0;
begin
  delete from cron.job_run_details
  where end_time < clock_timestamp() - interval '14 days';
  get diagnostics deleted_runs = row_count;

  return jsonb_build_object('deleted_job_run_details', deleted_runs);
end;
$$;

revoke all on function public.finflow_cleanup_cron_job_run_details()
  from public, anon, authenticated;

select cron.schedule(
  'finflow-cleanup-cron-job-run-details',
  '30 3 * * *',
  $$select public.finflow_cleanup_cron_job_run_details();$$
);

commit;
