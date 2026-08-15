"use client";

import { useActionState } from "react";
import { resendConfirmationAction } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { FormFeedback } from "@/components/auth/form-feedback";

export function ResendConfirmationForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    resendConfirmationAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="email" value={email} />
      <FormFeedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-ff-md border border-primary px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Reenviando..." : "Reenviar e-mail de confirmação"}
      </button>
    </form>
  );
}
