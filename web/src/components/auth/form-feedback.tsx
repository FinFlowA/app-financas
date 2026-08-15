import type { AuthActionState } from "@/lib/auth/state";
import styles from "./auth.module.css";

export const INPUT_CLASS = styles.input;

export const LABEL_CLASS = styles.label;
export const PRIMARY_BUTTON_CLASS = styles.buttonPrimary;
export const SECONDARY_BUTTON_CLASS = styles.buttonSecondary;
export const TEXT_LINK_CLASS = styles.textLink;
export const FORM_CLASS = styles.form;
export const FIELD_CLASS = styles.field;
export const FIELD_HEADER_CLASS = styles.fieldHeader;
export const HELPER_CLASS = styles.helper;
export const FORM_PROMPT_CLASS = styles.formPrompt;

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className={styles.fieldError} role="alert">
      {message}
    </p>
  );
}

export function FormFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null;
  const success = state.status === "success";
  return (
    <div
      className={`${styles.feedback} ${
        success
          ? styles.feedbackSuccess
          : styles.feedbackError
      }`}
      role={success ? "status" : "alert"}
      aria-live="polite"
    >
      {state.message}
    </div>
  );
}
