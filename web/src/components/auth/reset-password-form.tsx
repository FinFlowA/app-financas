"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePasswordAction } from "@/lib/auth/actions";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "@/lib/auth/constants";
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
} from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

export function ResetPasswordForm({ recoveryIsValid }: { recoveryIsValid: boolean }) {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    INITIAL_AUTH_STATE,
  );

  if (!recoveryIsValid) {
    return (
      <div className={FORM_CLASS}>
        <div
          className={`${styles.feedback} ${styles.feedbackError}`}
          role="alert"
        >
          Este link de recuperação é inválido, expirou ou já foi utilizado.
        </div>
        <Link
          href="/esqueci-senha"
          className={PRIMARY_BUTTON_CLASS}
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className={FORM_CLASS} noValidate>
      <FormFeedback state={state} />

      <div className={FIELD_CLASS}>
        <label htmlFor="senha" className={LABEL_CLASS}>
          Nova senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          placeholder="Crie uma senha forte"
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.senha)}
        />
        <p className={HELPER_CLASS}>
          {PASSWORD_REQUIREMENTS_MESSAGE}
        </p>
        <FieldError message={state.errors?.senha} />
      </div>

      <div className={FIELD_CLASS}>
        <label htmlFor="confirmarSenha" className={LABEL_CLASS}>
          Confirmar nova senha
        </label>
        <input
          id="confirmarSenha"
          name="confirmarSenha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          placeholder="Repita sua nova senha"
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.confirmarSenha)}
        />
        <FieldError message={state.errors?.confirmarSenha} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className={PRIMARY_BUTTON_CLASS}
        aria-busy={pending}
      >
        {pending ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
