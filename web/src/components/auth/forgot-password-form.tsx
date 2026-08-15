"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FormFeedback,
  INPUT_CLASS,
  LABEL_CLASS,
} from "@/components/auth/form-feedback";

export function ForgotPasswordForm({ invalidLink = false }: { invalidLink?: boolean }) {
  const [state, action, pending] = useActionState(
    requestPasswordResetAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={action} className="space-y-5" noValidate>
      {invalidLink ? (
        <div
          className="rounded-ff-sm border border-red/30 bg-red/10 px-4 py-3 text-sm font-medium leading-5 text-red"
          role="alert"
        >
          O link é inválido ou expirou. Solicite uma nova recuperação.
        </div>
      ) : null}
      <FormFeedback state={state} />

      <div>
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
          defaultValue={state.values?.email}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.email)}
        />
        <FieldError message={state.errors?.email} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-ff-md bg-primary py-3 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Enviar link de recuperação"}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Lembrou a senha?{" "}
        <Link href="/login" className="font-bold text-primary hover:underline">
          Voltar para o login
        </Link>
      </p>
    </form>
  );
}
