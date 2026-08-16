"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form";
import {
  FieldError,
  FIELD_CLASS,
  FIELD_HEADER_CLASS,
  FORM_CLASS,
  FormFeedback,
  FORM_PROMPT_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  TEXT_LINK_CLASS,
} from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

type LoginFormProps = {
  initialFeedback?: { kind: "success" | "error"; message: string };
};

export function LoginForm({ initialFeedback }: LoginFormProps) {
  const [state, action, pending] = useActionState(signInAction, INITIAL_AUTH_STATE);
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <div>
      <form action={action} className={FORM_CLASS} noValidate>
      {initialFeedback ? (
        <div
          className={`${styles.feedback} ${
            initialFeedback.kind === "success"
              ? styles.feedbackSuccess
              : styles.feedbackError
          }`}
          role={initialFeedback.kind === "success" ? "status" : "alert"}
          aria-live="polite"
        >
          {initialFeedback.message}
        </div>
      ) : null}
      <FormFeedback state={state} />

      <div className={FIELD_CLASS}>
        <label htmlFor="email" className={LABEL_CLASS}>
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="voce@exemplo.com"
          spellCheck={false}
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.errors?.email)}
          aria-describedby={state.errors?.email ? "email-error" : undefined}
          className={INPUT_CLASS}
        />
        <div id="email-error">
          <FieldError message={state.errors?.email} />
        </div>
      </div>

      <div className={FIELD_CLASS}>
        <div className={FIELD_HEADER_CLASS}>
          <label htmlFor="senha" className={LABEL_CLASS}>
            Senha
          </label>
          <Link href="/esqueci-senha" className={TEXT_LINK_CLASS}>
            Esqueci minha senha
          </Link>
        </div>
        <div className={styles.passwordField}>
          <input
            id="senha"
            name="senha"
            type={passwordVisible ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Digite sua senha"
            aria-invalid={Boolean(state.errors?.senha)}
            aria-describedby={state.errors?.senha ? "senha-error" : undefined}
            className={`${INPUT_CLASS} ${styles.passwordInput}`}
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={passwordVisible}
            title={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
          >
            {passwordVisible ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.3A10.6 10.6 0 0112 4c5.5 0 9 5.2 9 5.2a14.8 14.8 0 01-2.3 2.8M6.2 6.2C4.2 7.6 3 9.2 3 9.2S6.5 14.4 12 14.4c.7 0 1.4-.1 2-.3" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>
        </div>
        <div id="senha-error">
          <FieldError message={state.errors?.senha} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className={PRIMARY_BUTTON_CLASS}
        aria-busy={pending}
      >
        {pending ? "Entrando..." : "Entrar"}
      </button>

      <p className={FORM_PROMPT_CLASS}>
        Ainda não tem uma conta?{" "}
        <Link href="/cadastro" className={TEXT_LINK_CLASS}>
          Criar conta
        </Link>
      </p>
      </form>
      {state.canResendConfirmation && state.values?.email ? (
        <ResendConfirmationForm email={state.values.email} />
      ) : null}
    </div>
  );
}
