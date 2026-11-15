-- Rendimento dos objetivos ("Atualizar saldo real").
--
-- O FinFlow não calcula rendimento sozinho. Quem usa informa o saldo real do
-- objetivo (o que o banco/corretora mostra) e a diferença para o saldo
-- registrado entra como rendimento. O saldo informado nunca pode ser menor
-- que o registrado: diminuir saldo é resgate e continua no botão Resgatar.
--
--   * public.caixinha_rendimentos: um registro por atualização, com o saldo
--     anterior, o saldo informado e o rendimento (diferença). Só leitura pela
--     API; a escrita é feita pela RPC abaixo.
--   * public.registrar_rendimento_objetivo(goal_id, saldo_real, data): trava o
--     objetivo (mesmas regras de acesso dos aportes, inclusive parceiro em
--     objetivo compartilhado), valida e soma a diferença ao saldo.
--
-- Rendimento não gera lançamento em conta: o dinheiro já estava aplicado.
--
-- Reverter: drop function public.registrar_rendimento_objetivo(bigint, numeric, date);
--   drop table public.caixinha_rendimentos.

CREATE TABLE IF NOT EXISTS "public"."caixinha_rendimentos" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "caixinha_id" bigint NOT NULL REFERENCES "public"."caixinhas"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL DEFAULT auth.uid(),
    "saldo_anterior" numeric NOT NULL,
    "saldo_informado" numeric NOT NULL,
    "valor" numeric NOT NULL,
    "data" date NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "caixinha_rendimentos_valor_positivo" CHECK ("valor" > 0 AND "valor" = round("valor", 2)),
    CONSTRAINT "caixinha_rendimentos_coerente" CHECK ("saldo_informado" = "saldo_anterior" + "valor")
);

CREATE INDEX IF NOT EXISTS "caixinha_rendimentos_caixinha_idx"
    ON "public"."caixinha_rendimentos" ("caixinha_id", "data");

ALTER TABLE "public"."caixinha_rendimentos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caixinha_rendimentos_select" ON "public"."caixinha_rendimentos"
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.caixinhas g
        WHERE g.id = caixinha_id
          AND (g.user_id = (select auth.uid())
               OR (coalesce(g.compartilhado, false) AND public.is_parceiro(g.user_id, (select auth.uid()))))
    ));

REVOKE ALL ON TABLE "public"."caixinha_rendimentos" FROM anon, authenticated;
GRANT SELECT ON TABLE "public"."caixinha_rendimentos" TO authenticated;

CREATE OR REPLACE FUNCTION "public"."registrar_rendimento_objetivo"("p_goal_id" bigint, "p_saldo_real" numeric, "p_data" date)
    RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := (select auth.uid());
  saldo_atual_registrado numeric;
  saldo_real numeric := round(p_saldo_real, 2);
  rendimento numeric;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'FINFLOW_NOT_AUTHENTICATED';
  end if;
  if p_goal_id is null or saldo_real is null or p_data is null
     or saldo_real > 999999999999.99 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_YIELD';
  end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_FUTURE_DATE';
  end if;

  perform private.ai_lock_goal(caller, p_goal_id, false, true);
  select coalesce(g.saldo_atual, 0) into saldo_atual_registrado
  from public.caixinhas g where g.id = p_goal_id for update;

  rendimento := saldo_real - saldo_atual_registrado;
  if rendimento < 0 then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_BELOW_BALANCE';
  end if;
  if rendimento = 0 then
    raise exception using errcode = '22023', message = 'FINFLOW_YIELD_NO_CHANGE';
  end if;

  perform private.ai_adjust_goal_balance(caller, p_goal_id, 'save', rendimento, 1);

  insert into public.caixinha_rendimentos (caixinha_id, user_id, saldo_anterior, saldo_informado, valor, data)
  values (p_goal_id, caller, saldo_atual_registrado, saldo_real, rendimento, p_data);

  return jsonb_build_object('goal_id', p_goal_id, 'rendimento', rendimento, 'saldo', saldo_real);
end;
$$;

ALTER FUNCTION "public"."registrar_rendimento_objetivo"(bigint, numeric, date) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."registrar_rendimento_objetivo"(bigint, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."registrar_rendimento_objetivo"(bigint, numeric, date) TO authenticated;
