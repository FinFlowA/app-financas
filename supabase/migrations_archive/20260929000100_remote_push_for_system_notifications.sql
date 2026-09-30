-- FinFlow: push remoto para os avisos obrigatórios de parceria.
--
-- Até aqui os avisos de notificacoes_sistema só apareciam quando o app estava
-- aberto. Esta migration registra os dispositivos com token do Expo Push e,
-- a cada aviso novo, aciona a Edge Function send-system-push via pg_net.
--
-- A URL da função fica no Vault (secret "finflow_push_function_url") para que
-- ambientes locais ou de preview não disparem push para produção. Sem o secret
-- o gatilho simplesmente não faz nada.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.dispositivos_push (
  token TEXT PRIMARY KEY CHECK (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plataforma TEXT NOT NULL CHECK (plataforma IN ('ios', 'android')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispositivos_push_user_idx
  ON public.dispositivos_push (user_id, atualizado_em DESC);

-- Sem policies: o cliente só registra/remove o próprio token pelas RPCs abaixo.
ALTER TABLE public.dispositivos_push ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dispositivos_push FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dispositivos_push TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_dispositivo_push(p_token TEXT, p_plataforma TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     OR p_plataforma IS NULL OR p_plataforma NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid push token';
  END IF;

  -- Um aparelho pertence a quem está logado nele agora: trocar de conta no
  -- mesmo celular transfere o token e o usuário anterior deixa de receber.
  INSERT INTO public.dispositivos_push (token, user_id, plataforma)
  VALUES (p_token, v_uid, p_plataforma)
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        plataforma = EXCLUDED.plataforma,
        atualizado_em = now();

  -- Mantém apenas os 10 aparelhos mais recentes por usuário.
  DELETE FROM public.dispositivos_push d
   WHERE d.user_id = v_uid
     AND d.token NOT IN (
       SELECT r.token FROM public.dispositivos_push r
        WHERE r.user_id = v_uid
        ORDER BY r.atualizado_em DESC
        LIMIT 10
     );

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remover_dispositivo_push(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_removidos INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  DELETE FROM public.dispositivos_push
   WHERE token = p_token
     AND user_id = v_uid;
  GET DIAGNOSTICS v_removidos = ROW_COUNT;
  RETURN v_removidos > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_dispositivo_push(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remover_dispositivo_push(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_dispositivo_push(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remover_dispositivo_push(TEXT) TO authenticated, service_role;

-- Marca de envio: a Edge Function "reserva" o aviso ao preencher este campo,
-- garantindo no máximo um push por aviso mesmo com chamadas repetidas.
ALTER TABLE public.notificacoes_sistema
  ADD COLUMN IF NOT EXISTS push_enviado_em TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION private.enviar_push_notificacao_sistema()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_url TEXT;
BEGIN
  IF NEW.lida_em IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dispositivos_push d WHERE d.user_id = NEW.destinatario_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT s.decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets s
   WHERE s.name = 'finflow_push_function_url'
   LIMIT 1;
  IF v_url IS NULL OR v_url = '' THEN
    RETURN NEW;
  END IF;

  -- pg_net enfileira a requisição e só a envia se esta transação confirmar.
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('notificacao_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- O push é best-effort: nunca pode desfazer o aviso nem a ação de parceria.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enviar_push_notificacao_sistema() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enviar_push_notificacao_sistema ON public.notificacoes_sistema;
CREATE TRIGGER enviar_push_notificacao_sistema
  AFTER INSERT ON public.notificacoes_sistema
  FOR EACH ROW EXECUTE FUNCTION private.enviar_push_notificacao_sistema();

-- Quem desfaz o vínculo já vê a confirmação na própria tela; o aviso de
-- "Parceria encerrada" passa a ir somente para a outra pessoa.
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
    CONTINUE WHEN v_ator IS NOT NULL AND v_destinatario = v_ator;

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

COMMIT;
