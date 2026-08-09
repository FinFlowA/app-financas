export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  "Use pelo menos 8 caracteres, incluindo letra maiúscula, letra minúscula, número e caractere especial.";

export type PasswordValidation = {
  valid: boolean;
  hasMinimumLength: boolean;
  hasUppercaseLetter: boolean;
  hasLowercaseLetter: boolean;
  hasNumber: boolean;
  hasSpecialCharacter: boolean;
};

/**
 * Política única de senha usada pelo cadastro e por todos os fluxos de troca.
 * Espaços não contam como caractere especial.
 */
export function validatePassword(password: string): PasswordValidation {
  const hasMinimumLength = password.length >= PASSWORD_MIN_LENGTH;
  const hasUppercaseLetter = /[A-ZÀ-ÖØ-Þ]/.test(password);
  const hasLowercaseLetter = /[a-zà-öø-ÿ]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialCharacter = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9\s]/.test(password);

  return {
    valid: hasMinimumLength && hasUppercaseLetter && hasLowercaseLetter && hasNumber && hasSpecialCharacter,
    hasMinimumLength,
    hasUppercaseLetter,
    hasLowercaseLetter,
    hasNumber,
    hasSpecialCharacter,
  };
}
