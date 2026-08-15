import type { AuthActionState } from "@/lib/auth/state";

export const INPUT_CLASS =
  "w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export const LABEL_CLASS =
  "mb-1.5 block text-xs font-bold uppercase tracking-wide text-foreground-muted";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-sm font-medium text-red" role="alert">
      {message}
    </p>
  );
}

export function FormFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null;
  const success = state.status === "success";
  return (
    <div
      className={`rounded-ff-sm border px-4 py-3 text-sm font-medium leading-5 ${
        success
          ? "border-primary/30 bg-primary-soft text-primary-dark"
          : "border-red/30 bg-red/10 text-red"
      }`}
      role={success ? "status" : "alert"}
      aria-live="polite"
    >
      {state.message}
    </div>
  );
}
