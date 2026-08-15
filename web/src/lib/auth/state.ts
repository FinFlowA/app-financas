import type { AuthFieldErrors, SignupValues } from "@/lib/auth/validation";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  errors?: AuthFieldErrors;
  values?: Partial<SignupValues> & { email?: string };
  canResendConfirmation?: boolean;
};

export const INITIAL_AUTH_STATE: AuthActionState = { status: "idle" };
