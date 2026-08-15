"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form";
import {
  FieldError,
  FormFeedback,
  INPUT_CLASS,
  LABEL_CLASS,
} from "@/components/auth/form-feedback";

type LoginFormProps = {
  initialFeedback?: { kind: "success" | "error"; message: string };
};

export function LoginForm({ initialFeedback }: LoginFormProps) {
  const [state, action, pending] = useActionState(signInAction, INITIAL_AUTH_STATE);

  return (
    <div>
      <form action={action} className="space-y-5" noValidate>
      {initialFeedback ? (
        <div
          className={`rounded-ff-sm border px-4 py-3 text-sm font-medium leading-5 ${
            initialFeedback.kind === "success"
              ? "border-primary/30 bg-primary-soft text-primary-dark"
              : "border-red/30 bg-red/10 text-red"
          }`}
          role={initialFeedback.kind === "success" ? "status" : "alert"}
        >
          {initialFeedback.message}
        </div>
      ) : null}
      <FormFeedback state={state} />

      <div>
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
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.errors?.email)}
          aria-describedby={state.errors?.email ? "email-error" : undefined}
          className={INPUT_CLASS}
        />
        <div id="email-error">
          <FieldError message={state.errors?.email} />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-4">
          <label htmlFor="senha" className={LABEL_CLASS.replace("mb-1.5 ", "")}>
            Senha
          </label>
          <Link href="/esqueci-senha" className="text-xs font-bold text-primary hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
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
        className="w-full rounded-ff-md bg-primary py-3 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Entrando..." : "Entrar"}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Ainda não tem uma conta?{" "}
        <Link href="/cadastro" className="font-bold text-primary hover:underline">
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
