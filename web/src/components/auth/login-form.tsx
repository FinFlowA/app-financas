"use client";

import Link from "next/link";
import { useActionState } from "react";
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
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Digite sua senha"
          aria-invalid={Boolean(state.errors?.senha)}
          aria-describedby={state.errors?.senha ? "senha-error" : undefined}
          className={INPUT_CLASS}
        />
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
