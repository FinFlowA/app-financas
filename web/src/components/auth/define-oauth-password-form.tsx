"use client";

import { useActionState } from "react";
import { defineOAuthPasswordAction } from "@/lib/auth/actions";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "@/lib/auth/constants";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { FieldError, FIELD_CLASS, FORM_CLASS, FormFeedback, HELPER_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/auth/form-feedback";

export function DefineOAuthPasswordForm() {
  const [state, action, pending] = useActionState(defineOAuthPasswordAction, INITIAL_AUTH_STATE);
  return (
    <form action={action} className={FORM_CLASS} noValidate>
      <FormFeedback state={state} />
      <div className={FIELD_CLASS}>
        <label htmlFor="senha" className={LABEL_CLASS}>Nova senha</label>
        <input id="senha" name="senha" type="password" autoComplete="new-password" minLength={8} maxLength={128} required className={INPUT_CLASS} aria-invalid={Boolean(state.errors?.senha)} />
        <p className={HELPER_CLASS}>{PASSWORD_REQUIREMENTS_MESSAGE}</p>
        <FieldError message={state.errors?.senha} />
      </div>
      <div className={FIELD_CLASS}>
        <label htmlFor="confirmarSenha" className={LABEL_CLASS}>Confirmar senha</label>
        <input id="confirmarSenha" name="confirmarSenha" type="password" autoComplete="new-password" minLength={8} maxLength={128} required className={INPUT_CLASS} aria-invalid={Boolean(state.errors?.confirmarSenha)} />
        <FieldError message={state.errors?.confirmarSenha} />
      </div>
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS} aria-busy={pending}>{pending ? "Salvando..." : "Criar senha e continuar"}</button>
    </form>
  );
}
