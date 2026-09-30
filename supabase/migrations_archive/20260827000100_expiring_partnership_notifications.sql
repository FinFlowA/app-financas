-- FinFlow: avisa o encerramento de parcerias e limita avisos transitórios a 5 dias.

BEGIN;

ALTER TABLE public.notificacoes_sistema
  DROP CONSTRAINT IF EXISTS notificacoes_sistema_tipo_check;
ALTER TABLE public.notificacoes_sistema
  ADD CONSTRAINT notificacoes_sistema_tipo_check CHECK (
    tipo IN ('convite_parceria', 'parceria_aceita', 'parceria_recusada', 'parceria_encerrada')
  );

ALTER TABLE public.notificacoes_sistema
  ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ;
UPDATE public.notificacoes_sistema
   SET expira_em = criada_em + interval '5 days'
 WHERE expira_em IS NULL;
ALTER TABLE public.notificacoes_sistema
  ALTER COLUMN expira_em SET DEFAULT (now() + interval '5 days'),
  ALTER COLUMN expira_em SET NOT NULL;

DROP POLICY IF EXISTS notificacoes_sistema_owner_select ON public.notificacoes_sistema;
CREATE POLICY notificacoes_sistema_owner_select
  ON public.notificacoes_sistema
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = destinatario_id AND expira_em > now());

CREATE OR REPLACE FUNCTION public.notificar_encerramento_parceria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_ator UUID := auth.uid();
  v_ator_nome TEXT;
  v_destinatario UUID;
BEGIN
  IF OLD.status <> 'aceito' OR OLD.convidado_id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(
           NULLIF(btrim(u.raw_user_meta_data ->> 'nome_usuario'), ''),
           NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           split_part(COALESCE(u.email, ''), '@', 1),
           'Seu parceiro'
         )
    INTO v_ator_nome
    FROM auth.users u
   WHERE u.id = v_ator;

  FOREACH v_destinatario IN ARRAY ARRAY[OLD.solicitante_id, OLD.convidado_id]
  LOOP
    INSERT INTO public.notificacoes_sistema (
      destinatario_id, tipo, referencia_id, titulo, mensagem, dados, expira_em
    ) VALUES (
      v_destinatario,
      'parceria_encerrada',
      OLD.id,
      'Parceria encerrada',
      format('%s encerrou a parceria. Os recursos compartilhados foram separados com segurança.', COALESCE(v_ator_nome, 'Seu parceiro')),
      jsonb_build_object('parceria_id', OLD.id, 'encerrada_por', v_ator),
      now() + interval '5 days'
    )
    ON CONFLICT (destinatario_id, tipo, referencia_id) DO NOTHING;
  END LOOP;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.notificar_encerramento_parceria() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notificar_encerramento_parceria ON public.parcerias;
CREATE TRIGGER notificar_encerramento_parceria
  AFTER DELETE ON public.parcerias
  FOR EACH ROW EXECUTE FUNCTION public.notificar_encerramento_parceria();

CREATE OR REPLACE FUNCTION public.limpar_minhas_notificacoes_sistema_expiradas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_removidas INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  DELETE FROM public.notificacoes_sistema
   WHERE destinatario_id = v_uid
     AND expira_em <= now();
  GET DIAGNOSTICS v_removidas = ROW_COUNT;
  RETURN v_removidas;
END;
$function$;

REVOKE ALL ON FUNCTION public.limpar_minhas_notificacoes_sistema_expiradas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limpar_minhas_notificacoes_sistema_expiradas() TO authenticated, service_role;

COMMIT;
