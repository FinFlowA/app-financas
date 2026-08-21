"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { signInAction, signInWithOAuthAction } from "@/lib/auth/actions";
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
  const [oauthPending, startOAuthTransition] = useTransition();

  function entrarComGoogle() {
    startOAuthTransition(() => { void signInWithOAuthAction("google"); });
  }

  return (
    <div className={styles.stack}>
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

      <div className={styles.divider} aria-hidden="true">ou continue com</div>

      <button
        type="button"
        onClick={entrarComGoogle}
        disabled={oauthPending}
        aria-busy={oauthPending}
        className={styles.socialButton}
      >
        <svg className={styles.socialIcon} viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20.4H24v7.2h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.1-5.1C33.5 6.1 29 4.4 24 4.4 13.2 4.4 4.4 13.2 4.4 24S13.2 43.6 24 43.6 43.6 34.8 43.6 24c0-1.2-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l5.9 4.3C13.9 15.5 18.6 12.4 24 12.4c3 0 5.8 1.1 7.9 3l5.1-5.1C33.5 6.1 29 4.4 24 4.4c-7.5 0-14 4.2-17.7 10.3z" />
          <path fill="#4CAF50" d="M24 43.6c4.9 0 9.4-1.9 12.7-4.9l-5.9-5c-1.9 1.5-4.4 2.4-6.8 2.4-5.2 0-9.6-3.3-11.3-7.9l-5.9 4.5c3.6 6.1 10.1 10.9 17.2 10.9z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20.4H24v7.2h11.3c-.8 2.3-2.2 4.2-4.1 5.6l5.9 5c-.4.4 6.3-4.6 6.3-14.2 0-1.2-.1-2.4-.4-3.5z" />
        </svg>
        {oauthPending ? "Redirecionando..." : "Continuar com Google"}
      </button>

      {state.canResendConfirmation && state.values?.email ? (
        <ResendConfirmationForm email={state.values.email} />
      ) : null}
    </div>
  );
}
