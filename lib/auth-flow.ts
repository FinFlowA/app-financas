export const PENDING_EMAIL_CONFIRMATION_KEY = "@finflow_pending_email_confirmation";

export const PASSWORD_RECOVERY_FLOW_KEY = "@finflow_password_recovery_flow";
export const PASSWORD_RECOVERY_FLOW_TTL_MS = 15 * 60 * 1000;

export type PasswordRecoveryFlow = {
  userId: string;
  expiresAt: number;
};

export function criarFluxoRecuperacaoSenha(userId: string): PasswordRecoveryFlow {
  return {
    userId,
    expiresAt: Date.now() + PASSWORD_RECOVERY_FLOW_TTL_MS,
  };
}

export function lerFluxoRecuperacaoSenha(raw: string | null): PasswordRecoveryFlow | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PasswordRecoveryFlow>;
    if (typeof value.userId !== "string" || typeof value.expiresAt !== "number") return null;
    return { userId: value.userId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}
