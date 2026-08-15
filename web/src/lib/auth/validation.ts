import { PASSWORD_REQUIREMENTS_MESSAGE } from "./constants";

export type AuthFieldName =
  | "nome"
  | "email"
  | "telefone"
  | "dataNascimento"
  | "senha"
  | "confirmarSenha"
  | "aceiteLegal";

export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;

export type SignupValues = {
  nome: string;
  email: string;
  telefone: string;
  dataNascimento: string;
};

export type SignupData = SignupValues & {
  telefoneE164?: string;
  senha: string;
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: AuthFieldErrors };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAZIL_MOBILE_PATTERN = /^[1-9]{2}9\d{8}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function text(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, maxLength).trim() : "";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function normalizeBrazilPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13) digits = digits.slice(2);
  if (!BRAZIL_MOBILE_PATTERN.test(digits)) return null;
  return `+55${digits}`;
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-ZÀ-ÖØ-Þ]/.test(password) &&
    /[a-zà-öø-ÿ]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-zÀ-ÖØ-öø-ÿ0-9\s]/.test(password)
  );
}

type CalendarDate = { year: number; month: number; day: number };

function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function todayInSaoPaulo(): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}

function compareDates(left: CalendarDate, right: CalendarDate): number {
  return (
    left.year - right.year || left.month - right.month || left.day - right.day
  );
}

export function ageFromIsoDate(value: string): number | null {
  const birthDate = parseIsoDate(value);
  if (!birthDate) return null;

  const today = todayInSaoPaulo();
  if (compareDates(birthDate, today) > 0) return null;

  let age = today.year - birthDate.year;
  if (
    today.month < birthDate.month ||
    (today.month === birthDate.month && today.day < birthDate.day)
  ) {
    age -= 1;
  }
  return age;
}

export function validateLogin(formData: FormData): ValidationResult<{
  email: string;
  senha: string;
}> {
  const email = normalizeEmail(text(formData, "email", 254));
  const senhaValue = formData.get("senha");
  const senha = typeof senhaValue === "string" ? senhaValue.slice(0, 128) : "";
  const errors: AuthFieldErrors = {};

  if (!isValidEmail(email)) errors.email = "Informe um e-mail válido.";
  if (!senha) errors.senha = "Informe sua senha.";

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { email, senha } };
}

export function validateSignup(formData: FormData): ValidationResult<SignupData> {
  const nome = text(formData, "nome", 80).replace(/\s+/g, " ");
  const email = normalizeEmail(text(formData, "email", 254));
  const telefone = text(formData, "telefone", 30);
  const dataNascimento = text(formData, "dataNascimento", 10);
  const senhaValue = formData.get("senha");
  const confirmarValue = formData.get("confirmarSenha");
  const senha = typeof senhaValue === "string" ? senhaValue.slice(0, 129) : "";
  const confirmarSenha =
    typeof confirmarValue === "string" ? confirmarValue.slice(0, 129) : "";
  const aceiteLegal = formData.get("aceiteLegal") === "on";
  const errors: AuthFieldErrors = {};

  if (nome.length < 2 || CONTROL_CHARACTER_PATTERN.test(nome)) {
    errors.nome = "Informe seu nome (pelo menos 2 caracteres).";
  }
  if (!isValidEmail(email)) errors.email = "Informe um e-mail válido.";

  const telefoneE164 = telefone ? normalizeBrazilPhone(telefone) : null;
  if (telefone && !telefoneE164) {
    errors.telefone = "Informe um celular brasileiro válido com DDD.";
  }

  const age = ageFromIsoDate(dataNascimento);
  if (age === null) {
    errors.dataNascimento = "Informe uma data de nascimento válida.";
  } else if (age < 18) {
    errors.dataNascimento = "O FinFlow está disponível somente para maiores de 18 anos.";
  }

  if (!isStrongPassword(senha)) errors.senha = PASSWORD_REQUIREMENTS_MESSAGE;
  if (!confirmarSenha) {
    errors.confirmarSenha = "Confirme sua senha.";
  } else if (senha !== confirmarSenha) {
    errors.confirmarSenha = "As senhas não coincidem.";
  }
  if (!aceiteLegal) {
    errors.aceiteLegal = "Você precisa aceitar os Termos de Uso e a Política de Privacidade.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      nome,
      email,
      telefone,
      ...(telefoneE164 ? { telefoneE164 } : {}),
      dataNascimento,
      senha,
    },
  };
}

export function validateRecoveryEmail(
  formData: FormData,
): ValidationResult<{ email: string }> {
  const email = normalizeEmail(text(formData, "email", 254));
  if (!isValidEmail(email)) {
    return { ok: false, errors: { email: "Informe um e-mail válido." } };
  }
  return { ok: true, data: { email } };
}

export function validateNewPassword(formData: FormData): ValidationResult<{
  senha: string;
}> {
  const senhaValue = formData.get("senha");
  const confirmarValue = formData.get("confirmarSenha");
  const senha = typeof senhaValue === "string" ? senhaValue.slice(0, 129) : "";
  const confirmarSenha =
    typeof confirmarValue === "string" ? confirmarValue.slice(0, 129) : "";
  const errors: AuthFieldErrors = {};

  if (!isStrongPassword(senha)) errors.senha = PASSWORD_REQUIREMENTS_MESSAGE;
  if (!confirmarSenha) {
    errors.confirmarSenha = "Confirme a nova senha.";
  } else if (senha !== confirmarSenha) {
    errors.confirmarSenha = "As senhas não coincidem.";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { senha } };
}
