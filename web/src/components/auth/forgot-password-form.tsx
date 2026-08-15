"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FIELD_CLASS,
  FORM_CLASS,
  FormFeedback,
  FORM_PROMPT_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  TEXT_LINK_CLASS,
} from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

export function ForgotPasswordForm({ invalidLink = false }: { invalidLink?: boolean }) {
  const [state, action, pending] = useActionState(
    requestPasswordResetAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={action} className={FORM_CLASS} noValidate>
      {invalidLink ? (
        <div
          className={`${styles.feedback} ${styles.feedbackError}`}
          role="alert"
        >
          O link é inválido ou expirou. Solicite uma nova recuperação.
        </div>
      ) : null}
      <FormFeedback state={state} />

      <div className={FIELD_CLASS}>
        <label htmlFor="email" className={LABEL_CLASS}>
          E-mail da conta
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          placeholder="voce@exemplo.com"
          spellCheck={false}
          defaultValue={state.values?.email}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.email)}
        />
        <FieldError message={state.errors?.email} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className={PRIMARY_BUTTON_CLASS}
        aria-busy={pending}
      >
        {pending ? "Enviando..." : "Enviar link de recuperação"}
      </button>

      <p className={FORM_PROMPT_CLASS}>
        Lembrou a senha?{" "}
        <Link href="/login" className={TEXT_LINK_CLASS}>
          Voltar para o login
        </Link>
      </p>
    </form>
  );
}
