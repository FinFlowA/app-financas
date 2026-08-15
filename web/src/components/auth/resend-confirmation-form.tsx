"use client";

import { useActionState } from "react";
import { resendConfirmationAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import {
  FormFeedback,
  SECONDARY_BUTTON_CLASS,
} from "@/components/auth/form-feedback";
import styles from "./auth.module.css";

export function ResendConfirmationForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    resendConfirmationAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={action} className={styles.compactForm}>
      <input type="hidden" name="email" value={email} />
      <FormFeedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className={SECONDARY_BUTTON_CLASS}
        aria-busy={pending}
      >
        {pending ? "Reenviando..." : "Reenviar e-mail de confirmação"}
      </button>
    </form>
  );
}
