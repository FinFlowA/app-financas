"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUpAction } from "@/lib/auth/actions";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  PRIVACY_URL,
  TERMS_URL,
} from "@/lib/auth/constants";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FieldError,
  FIELD_CLASS,
  FORM_CLASS,
  FormFeedback,
  FORM_PROMPT_CLASS,
  HELPER_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  TEXT_LINK_CLASS,
} from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL_AUTH_STATE);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  if (state.status === "success") {
    return (
      <div className={FORM_CLASS}>
        <FormFeedback state={state} />
        <Link
          href="/login"
          className={PRIMARY_BUTTON_CLASS}
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className={FORM_CLASS} noValidate>
      <FormFeedback state={state} />

      <div className={FIELD_CLASS}>
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
          placeholder="Como você quer ser chamado"
          defaultValue={state.values?.nome}
          className={INPUT_CLASS}
          aria-invalid={Boolean(state.errors?.nome)}
        />
        <FieldError message={state.errors?.nome} />
      </div>

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

      <div className={FIELD_CLASS}>
        <label htmlFor="telefone" className={LABEL_CLASS}>
          Telefone com DDD <span>(opcional)</span>
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
        <p className={HELPER_CLASS}>
          O telefone não será usado para entrar ou recuperar a conta nesta versão.
        </p>
        <FieldError message={state.errors?.telefone} />
      </div>

      <div className={FIELD_CLASS}>
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
        <p className={HELPER_CLASS}>Uso permitido apenas para maiores de 18 anos.</p>
        <FieldError message={state.errors?.dataNascimento} />
      </div>

      <div className={FIELD_CLASS}>
        <label htmlFor="senha" className={LABEL_CLASS}>
          Senha
        </label>
        <span className={styles.passwordField}>
          <input
            id="senha"
            name="senha"
            type={passwordVisible ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            placeholder="Crie uma senha forte"
            className={`${INPUT_CLASS} ${styles.passwordInput}`}
            aria-invalid={Boolean(state.errors?.senha)}
          />
          <button type="button" className={styles.passwordToggle} onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={passwordVisible} title={passwordVisible ? "Ocultar senha" : "Mostrar senha"}>
            {passwordVisible ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.6 10.6 0 0 1 12 4c5.5 0 9 5.2 9 5.2a14.8 14.8 0 0 1-2.3 2.8M6.2 6.2C4.2 7.6 3 9.2 3 9.2S6.5 14.4 12 14.4c.7 0 1.4-.1 2-.3" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12z" /><circle cx="12" cy="12" r="2.2" /></svg>}
          </button>
        </span>
        <p className={HELPER_CLASS}>
          {PASSWORD_REQUIREMENTS_MESSAGE}
        </p>
        <FieldError message={state.errors?.senha} />
      </div>

      <div className={FIELD_CLASS}>
        <label htmlFor="confirmarSenha" className={LABEL_CLASS}>
          Confirmar senha
        </label>
        <span className={styles.passwordField}>
          <input
            id="confirmarSenha"
            name="confirmarSenha"
            type={confirmationVisible ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            placeholder="Repita sua senha"
            className={`${INPUT_CLASS} ${styles.passwordInput}`}
            aria-invalid={Boolean(state.errors?.confirmarSenha)}
          />
          <button type="button" className={styles.passwordToggle} onClick={() => setConfirmationVisible((visible) => !visible)} aria-label={confirmationVisible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={confirmationVisible} title={confirmationVisible ? "Ocultar senha" : "Mostrar senha"}>
            {confirmationVisible ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.6 10.6 0 0 1 12 4c5.5 0 9 5.2 9 5.2a14.8 14.8 0 0 1-2.3 2.8M6.2 6.2C4.2 7.6 3 9.2 3 9.2S6.5 14.4 12 14.4c.7 0 1.4-.1 2-.3" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12z" /><circle cx="12" cy="12" r="2.2" /></svg>}
          </button>
        </span>
        <FieldError message={state.errors?.confirmarSenha} />
      </div>

      <div className={FIELD_CLASS}>
        <label className={styles.checkboxRow}>
          <input
            name="aceiteLegal"
            type="checkbox"
            required
            className={styles.checkbox}
            aria-invalid={Boolean(state.errors?.aceiteLegal)}
          />
          <span>
            Li e concordo com os{" "}
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noreferrer"
              className={TEXT_LINK_CLASS}
            >
              Termos de Uso
            </a>{" "}
            e a{" "}
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className={TEXT_LINK_CLASS}
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
        className={PRIMARY_BUTTON_CLASS}
        aria-busy={pending}
      >
        {pending ? "Criando conta..." : "Criar conta"}
      </button>

      <p className={FORM_PROMPT_CLASS}>
        Já possui uma conta?{" "}
        <Link href="/login" className={TEXT_LINK_CLASS}>
          Entrar
        </Link>
      </p>
    </form>
  );
}
