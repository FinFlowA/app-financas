-- FinFlow: verificação em duas etapas (MFA opcional, TOTP).
--
-- Quem ativou MFA só acessa dados depois de digitar o código (sessão AAL2).
-- A exigência fica no servidor, não só na tela: esta função roda antes de
-- TODA requisição do PostgREST (tabelas, RPCs e GraphQL) como pre-request.
-- Isso cobre de uma vez as funções SECURITY DEFINER, que ignoram RLS.
--
-- Quem nunca ativou MFA não é afetado. Visitantes (anon) e a service_role
-- também passam direto; a service_role é usada por Edge Functions e pelo
-- site, que checam o MFA por conta própria antes de agir pelo usuário.
--
-- O Supabase Auth já exige AAL2 para trocar senha/e-mail e para remover um
-- fator verificado. O Realtime não é usado (nenhuma tabela publicada).
--
-- Reverter em emergência (derruba só a exigência, sem afetar o resto):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';

BEGIN;

-- Schema próprio e fora dos schemas expostos pela API: a função não vira
-- endpoint /rpc. Os papéis do PostgREST precisam de USAGE para chamá-la.
CREATE SCHEMA IF NOT EXISTS finflow_guard;
REVOKE ALL ON SCHEMA finflow_guard FROM PUBLIC;
GRANT USAGE ON SCHEMA finflow_guard TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION finflow_guard.enforce_mfa()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  claims jsonb;
  subject text;
BEGIN
  BEGIN
    claims := coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- Claims ilegíveis não vêm de um token válido de usuário; RLS decide.
    RETURN;
  END;

  IF claims ->> 'role' IS DISTINCT FROM 'authenticated' THEN
    RETURN;
  END IF;
  IF claims ->> 'aal' = 'aal2' THEN
    RETURN;
  END IF;

  subject := claims ->> 'sub';
  IF subject IS NULL
     OR subject !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM auth.mfa_factors factor
     WHERE factor.user_id = subject::uuid
       AND factor.status = 'verified'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'FINFLOW_MFA_REQUIRED',
      HINT = 'Digite o código da verificação em duas etapas para continuar.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION finflow_guard.enforce_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finflow_guard.enforce_mfa() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'finflow_guard.enforce_mfa';

COMMIT;

NOTIFY pgrst, 'reload config';
