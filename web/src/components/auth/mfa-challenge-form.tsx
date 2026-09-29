"use client";

import { useActionState } from "react";
import { signOutAction } from "@/app/(dashboard)/sign-out-action";
import { verifyMfaChallengeAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FIELD_CLASS,
  FORM_CLASS,
  FormFeedback,
  HELPER_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/auth/form-feedback";

const SUPPORT_MAILTO = "mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Verifica%C3%A7%C3%A3o%20em%20duas%20etapas%5D";

export function MfaChallengeForm() {
  const [state, action, pending] = useActionState(verifyMfaChallengeAction, INITIAL_AUTH_STATE);
  return (
    <div className="space-y-4">
      <form action={action} className={FORM_CLASS} noValidate>
        <FormFeedback state={state} />
        <div className={FIELD_CLASS}>
          <label htmlFor="codigo" className={LABEL_CLASS}>Código de 6 dígitos</label>
          <input
            id="codigo"
            name="codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            className={`${INPUT_CLASS} text-center text-2xl tracking-[.4em]`}
            aria-invalid={Boolean(state.errors?.codigo)}
            aria-describedby="codigo-ajuda"
          />
          <p id="codigo-ajuda" className={HELPER_CLASS}>Abra o app autenticador (Google Authenticator, Microsoft Authenticator, Senhas do iPhone…) e digite o código do FinFlow.</p>
          <FieldError message={state.errors?.codigo} />
        </div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS} aria-busy={pending}>{pending ? "Verificando..." : "Confirmar e entrar"}</button>
      </form>
      <form action={signOutAction}>
        <button type="submit" className={SECONDARY_BUTTON_CLASS}>Entrar com outra conta</button>
      </form>
      <p className={HELPER_CLASS}>
        Perdeu o celular com o autenticador? <a className="font-bold text-primary hover:underline" href={SUPPORT_MAILTO}>Fale com o suporte</a> para confirmar sua identidade e recuperar o acesso.
      </p>
    </div>
  );
}
