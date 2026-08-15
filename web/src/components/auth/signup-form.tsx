"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "@/lib/auth/actions";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  PRIVACY_URL,
  TERMS_URL,
} from "@/lib/auth/constants";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FormFeedback,
  INPUT_CLASS,
  LABEL_CLASS,
} from "@/components/auth/form-feedback";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL_AUTH_STATE);

  if (state.status === "success") {
    return (
      <div className="space-y-5">
        <FormFeedback state={state} />
        <Link
          href="/login"
          className="block w-full rounded-ff-md bg-primary py-3 text-center text-sm font-bold text-white transition hover:bg-primary-dark"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormFeedback state={state} />

      <div>
        <label htmlFor="nome" className={LABEL_CLASS}>
          Nome
        </label>
        <input
          id="nome"
          name="nome"
          type="text"
          autoComplete="name"
          maxLength={80}
          required
          defaultValue={state.values?.nome}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.nome)}
        />
        <FieldError message={state.errors?.nome} />
      </div>

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
          maxLength={254}
          required
          defaultValue={state.values?.email}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.email)}
        />
        <FieldError message={state.errors?.email} />
      </div>

      <div>
        <label htmlFor="telefone" className={LABEL_CLASS}>
          Telefone com DDD <span className="font-normal normal-case">(opcional)</span>
        </label>
        <input
          id="telefone"
          name="telefone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={30}
          placeholder="(11) 99999-9999"
          defaultValue={state.values?.telefone}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.telefone)}
        />
        <p className="mt-1.5 text-xs leading-5 text-foreground-muted">
          O telefone não será usado para entrar ou recuperar a conta nesta versão.
        </p>
        <FieldError message={state.errors?.telefone} />
      </div>

      <div>
        <label htmlFor="dataNascimento" className={LABEL_CLASS}>
          Data de nascimento
        </label>
        <input
          id="dataNascimento"
          name="dataNascimento"
          type="date"
          autoComplete="bday"
          required
          defaultValue={state.values?.dataNascimento}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.dataNascimento)}
        />
        <p className="mt-1.5 text-xs text-foreground-muted">Uso permitido apenas para maiores de 18 anos.</p>
        <FieldError message={state.errors?.dataNascimento} />
      </div>

      <div>
        <label htmlFor="senha" className={LABEL_CLASS}>
          Senha
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
          Confirmar senha
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

      <div>
        <label className="flex cursor-pointer items-start gap-3 rounded-ff-sm border border-border bg-surface-muted p-3 text-sm leading-5 text-foreground">
          <input
            name="aceiteLegal"
            type="checkbox"
            required
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            aria-invalid={Boolean(state.errors?.aceiteLegal)}
          />
          <span>
            Li e concordo com os{" "}
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-primary hover:underline"
            >
              Termos de Uso
            </a>{" "}
            e a{" "}
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-primary hover:underline"
            >
              Política de Privacidade
            </a>
            .
          </span>
        </label>
        <FieldError message={state.errors?.aceiteLegal} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-ff-md bg-primary py-3 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Criando conta..." : "Criar conta"}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Já possui uma conta?{" "}
        <Link href="/login" className="font-bold text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
