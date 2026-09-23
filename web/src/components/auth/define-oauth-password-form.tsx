"use client";

import { useActionState, useState } from "react";
import { defineOAuthPasswordAction } from "@/lib/auth/actions";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "@/lib/auth/constants";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { FieldError, FIELD_CLASS, FORM_CLASS, FormFeedback, HELPER_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.6 10.6 0 0 1 12 4c5.5 0 9 5.2 9 5.2a14.8 14.8 0 0 1-2.3 2.8M6.2 6.2C4.2 7.6 3 9.2 3 9.2S6.5 14.4 12 14.4c.7 0 1.4-.1 2-.3" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12z" /><circle cx="12" cy="12" r="2.2" /></svg>;
}

export function DefineOAuthPasswordForm() {
  const [state, action, pending] = useActionState(defineOAuthPasswordAction, INITIAL_AUTH_STATE);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  return (
    <form action={action} className={FORM_CLASS} noValidate>
      <FormFeedback state={state} />
      <div className={FIELD_CLASS}>
        <label htmlFor="senha" className={LABEL_CLASS}>Nova senha</label>
        <span className={styles.passwordField}>
          <input id="senha" name="senha" type={passwordVisible ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} required className={`${INPUT_CLASS} ${styles.passwordInput}`} aria-invalid={Boolean(state.errors?.senha)} />
          <button type="button" className={styles.passwordToggle} onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={passwordVisible} title={passwordVisible ? "Ocultar senha" : "Mostrar senha"}>
            <PasswordVisibilityIcon visible={passwordVisible} />
          </button>
        </span>
        <p className={HELPER_CLASS}>{PASSWORD_REQUIREMENTS_MESSAGE}</p>
        <FieldError message={state.errors?.senha} />
      </div>
      <div className={FIELD_CLASS}>
        <label htmlFor="confirmarSenha" className={LABEL_CLASS}>Confirmar senha</label>
        <span className={styles.passwordField}>
          <input id="confirmarSenha" name="confirmarSenha" type={confirmationVisible ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} required className={`${INPUT_CLASS} ${styles.passwordInput}`} aria-invalid={Boolean(state.errors?.confirmarSenha)} />
          <button type="button" className={styles.passwordToggle} onClick={() => setConfirmationVisible((visible) => !visible)} aria-label={confirmationVisible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={confirmationVisible} title={confirmationVisible ? "Ocultar senha" : "Mostrar senha"}>
            <PasswordVisibilityIcon visible={confirmationVisible} />
          </button>
        </span>
        <FieldError message={state.errors?.confirmarSenha} />
      </div>
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS} aria-busy={pending}>{pending ? "Salvando..." : "Criar senha e continuar"}</button>
    </form>
  );
}
