-- Rendimento dividido entre objetivos que estão no mesmo investimento.
--
-- Quem guarda vários objetivos no mesmo lugar (ex.: uma única caixinha do
-- banco) informa o saldo real desse lugar. A diferença para a soma dos
-- objetivos escolhidos vira rendimento e é dividida proporcionalmente ao
-- saldo de cada um. Os centavos que sobram do arredondamento vão para o
-- objetivo de maior saldo, para a soma bater exatamente.
--
--   * public.registrar_rendimento_objetivos(goal_ids, saldo_real, data):
--     trava os objetivos em ordem de id, valida, divide e grava um registro
--     em public.caixinha_rendimentos por objetivo. Tudo ou nada.
--
-- Mesmas regras da versão de um objetivo: saldo real menor que o total é
-- recusado (é resgate), igual é recusado, data futura é recusada.
--
-- Reverter: drop function public.registrar_rendimento_objetivos(bigint[], numeric, date);

CREATE OR REPLACE FUNCTION "public"."registrar_rendimento_objetivos"("p_goal_ids" bigint[], "p_saldo_real" numeric, "p_data" date)
    RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := (select auth.uid());
  ids bigint[];
  goal_id bigint;
  saldo_real numeric := round(p_saldo_real, 2);
  total_registrado numeric := 0;
  rendimento_total_cents bigint;
  distribuido_cents bigint := 0;
  parte_cents bigint;
  maior_id bigint;
  maior_saldo numeric := -1;
  saldo numeric;
  saldos jsonb := '{}'::jsonb;
  partes jsonb := '{}'::jsonb;
  resultado jsonb := '[]'::jsonb;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'FINFLOW_NOT_AUTHENTICATED';
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_goal_ids) as x where x is not null;
  if ids is null or cardinality(ids) = 0 or cardinality(ids) > 50
     or saldo_real is null or p_data is null or saldo_real > 999999999999.99 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_YIELD';
  end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_FUTURE_DATE';
  end if;

  -- Trava em ordem de id para não haver deadlock entre chamadas concorrentes.
  foreach goal_id in array ids loop
    perform private.ai_lock_goal(caller, goal_id, false, true);
    select coalesce(g.saldo_atual, 0) into saldo from public.caixinhas g where g.id = goal_id for update;
    saldos := saldos || jsonb_build_object(goal_id::text, saldo);
    total_registrado := total_registrado + saldo;
    if saldo > maior_saldo then maior_saldo := saldo; maior_id := goal_id; end if;
  end loop;

  if saldo_real < total_registrado then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_BELOW_BALANCE';
  end if;
  if saldo_real = total_registrado then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_NO_CHANGE';
  end if;
  if total_registrado <= 0 then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_NOTHING_TO_SPLIT';
  end if;

  rendimento_total_cents := round((saldo_real - total_registrado) * 100)::bigint;
  foreach goal_id in array ids loop
    saldo := (saldos ->> goal_id::text)::numeric;
    parte_cents := floor(rendimento_total_cents * saldo / total_registrado)::bigint;
    partes := partes || jsonb_build_object(goal_id::text, parte_cents);
    distribuido_cents := distribuido_cents + parte_cents;
  end loop;
  partes := jsonb_set(partes, array[maior_id::text],
    to_jsonb((partes ->> maior_id::text)::bigint + (rendimento_total_cents - distribuido_cents)));

  foreach goal_id in array ids loop
    parte_cents := (partes ->> goal_id::text)::bigint;
    continue when parte_cents <= 0;
    saldo := (saldos ->> goal_id::text)::numeric;
    perform private.ai_adjust_goal_balance(caller, goal_id, 'save', parte_cents::numeric / 100, 1);
    insert into public.caixinha_rendimentos (caixinha_id, user_id, saldo_anterior, saldo_informado, valor, data)
    values (goal_id, caller, saldo, saldo + parte_cents::numeric / 100, parte_cents::numeric / 100, p_data);
    resultado := resultado || jsonb_build_array(jsonb_build_object('goal_id', goal_id, 'rendimento', parte_cents::numeric / 100));
  end loop;

  return jsonb_build_object('rendimento', rendimento_total_cents::numeric / 100, 'saldo', saldo_real, 'objetivos', resultado);
end;
$$;

ALTER FUNCTION "public"."registrar_rendimento_objetivos"(bigint[], numeric, date) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."registrar_rendimento_objetivos"(bigint[], numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."registrar_rendimento_objetivos"(bigint[], numeric, date) TO authenticated;
