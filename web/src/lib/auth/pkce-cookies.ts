export const PKCE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const PKCE_COOKIE_PATH = "/auth";

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  [key: string]: unknown;
};

export function isPkceVerifierCookie(name: string) {
  return name.endsWith("-code-verifier");
}

/** O verificador PKCE só é consumido pelas rotas server-side de OAuth. */
export function hardenAuthCookie(
  name: string,
  options: CookieOptions = {},
  isProduction = process.env.NODE_ENV === "production",
): CookieOptions {
  if (!isPkceVerifierCookie(name)) return options;

  return {
    ...options,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: PKCE_COOKIE_PATH,
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
  };
}
