-- FinFlow: impede o PARCEIRO de escrever direto em caixinhas.saldo_atual.
--
-- caixinhas_partner_update permite ao parceiro de um objetivo compartilhado
-- fazer UPDATE de qualquer coluna, incluindo saldo_atual, sem nenhum
-- lançamento correspondente. Isso é uma falha de autorização: o parceiro
-- pode inflar/zerar o saldo de um objetivo pela API REST diretamente.
--
-- O app ainda grava saldo_atual em duas chamadas separadas quando o próprio
-- DONO movimenta o objetivo (insere a transação, depois soma o saldo). Isso
-- é uma fragilidade de atomicidade real — uma perda de rede entre as duas
-- pode deixar transação e saldo divergentes — mas migrar esses fluxos (em
-- app/(tabs)/index.tsx, app/(tabs)/transacoes.tsx e app/(tabs)/caixinhas.tsx)
-- para a RPC atômica é um trabalho maior, que mexe em séries recorrentes e
-- conclusão de lançamentos, e não deve ser feito sem um dispositivo real para
-- testar de ponta a ponta. Por isso esta migração fecha apenas a fronteira de
-- autorização agora — o dono continua podendo escrever o próprio saldo como
-- hoje — e a atomicidade completa fica registrada como pendência (ver
-- docs/security/SECURITY_AUDIT_2026-08-17.md).

begin;

create or replace function private.finflow_enforce_goal_balance_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare caller uuid := (select auth.uid());
begin
  -- O dono sempre pôde escrever o próprio saldo; isso não muda aqui. Só o
  -- parceiro (caller distinto do dono da linha) passa a exigir a RPC.
  if caller is not null and caller = old.user_id then
    return new;
  end if;
  if pg_catalog.current_setting('finflow.goal_balance_write_allowed', true)
     is distinct from '1' then
    raise exception using
      errcode = '42501',
      message = 'FINFLOW_DIRECT_GOAL_BALANCE_UPDATE_BLOCKED';
  end if;
  return new;
end;
$$;

revoke all on function private.finflow_enforce_goal_balance_write()
  from public, anon, authenticated;

drop trigger if exists finflow_enforce_goal_balance_write on public.caixinhas;
create trigger finflow_enforce_goal_balance_write
before update of saldo_atual on public.caixinhas
for each row execute function private.finflow_enforce_goal_balance_write();

-- private.ai_adjust_goal_balance é o único caminho usado quando o PARCEIRO
-- movimenta um objetivo compartilhado (move_goal, via app/site/fila offline
-- ou IA). Liga o sinalizador só para esta transação, imediatamente antes do
-- UPDATE, autorizando esse caso mesmo quando caller é o parceiro.
create or replace function private.ai_adjust_goal_balance(
  caller uuid,
  goal_id bigint,
  operation_name text,
  amount numeric,
  direction integer
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare current_balance numeric; new_balance numeric;
begin
  if operation_name not in ('save','withdraw') or amount<=0 or direction not in (-1,1) then
    perform private.ai_fail('AI_INVALID_GOAL_ADJUSTMENT');
  end if;
  perform private.ai_lock_goal(caller,goal_id,false,true);
  select g.saldo_atual into current_balance
  from public.caixinhas g
  where g.id=goal_id
    and not coalesce(g.arquivado,false)
    and (
      g.user_id=caller
      or (coalesce(g.compartilhado,false) and public.is_parceiro(g.user_id,caller))
    )
  for update;
  if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  new_balance := coalesce(current_balance,0)
    + case operation_name when 'save' then amount else -amount end * direction;
  if new_balance < 0 then perform private.ai_fail('AI_INSUFFICIENT_GOAL_BALANCE'); end if;
  perform pg_catalog.set_config('finflow.goal_balance_write_allowed', '1', true);
  update public.caixinhas set saldo_atual=round(new_balance,2) where id=goal_id;
  return round(new_balance,2);
end;
$$;

commit;
