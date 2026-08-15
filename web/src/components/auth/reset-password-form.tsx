"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePasswordAction } from "@/lib/auth/actions";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "@/lib/auth/constants";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FormFeedback,
  INPUT_CLASS,
  LABEL_CLASS,
} from "@/components/auth/form-feedback";

export function ResetPasswordForm({ recoveryIsValid }: { recoveryIsValid: boolean }) {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    INITIAL_AUTH_STATE,
  );

  if (!recoveryIsValid) {
    return (
      <div className="space-y-5">
        <div
          className="rounded-ff-sm border border-red/30 bg-red/10 px-4 py-3 text-sm font-medium leading-5 text-red"
          role="alert"
        >
          Este link de recuperação é inválido, expirou ou já foi utilizado.
        </div>
        <Link
          href="/esqueci-senha"
          className="block w-full rounded-ff-md bg-primary py-3 text-center text-sm font-bold text-white transition hover:bg-primary-dark"
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormFeedback state={state} />

      <div>
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
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.senha)}
        />
        <p className="mt-1.5 text-xs leading-5 text-foreground-muted">
          {PASSWORD_REQUIREMENTS_MESSAGE}
        </p>
        <FieldError message={state.errors?.senha} />
      </div>

      <div>
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
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.confirmarSenha)}
        />
        <FieldError message={state.errors?.confirmarSenha} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-ff-md bg-primary py-3 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
