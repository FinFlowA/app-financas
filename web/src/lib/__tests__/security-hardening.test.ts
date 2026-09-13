import { describe, expect, it } from "vitest";
import {
  hardenAuthCookie,
  isPkceVerifierCookie,
  PKCE_COOKIE_MAX_AGE_SECONDS,
  PKCE_COOKIE_PATH,
} from "../auth/pkce-cookies";
import { buildContentSecurityPolicy } from "../security/content-security-policy";

describe("hardening dos cookies PKCE", () => {
  it("protege e limita o verificador temporario", () => {
    const options = hardenAuthCookie("sb-projeto-auth-token-code-verifier", {}, true);
    expect(isPkceVerifierCookie("sb-projeto-auth-token-code-verifier")).toBe(true);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: PKCE_COOKIE_PATH,
      maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
    });
    expect(PKCE_COOKIE_MAX_AGE_SECONDS).toBeLessThanOrEqual(600);
  });

  it("nao altera cookies persistentes de sessao", () => {
    const options = { path: "/", maxAge: 3600 };
    expect(hardenAuthCookie("sb-projeto-auth-token", options, true)).toBe(options);
  });
});

describe("Content Security Policy", () => {
  it("autoriza apenas scripts com nonce em producao", () => {
    const policy = buildContentSecurityPolicy("nonce-seguro", false);
    expect(policy).toContain("script-src 'self' 'nonce-nonce-seguro' 'strict-dynamic'");
    expect(policy.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("mantem apenas o suporte de depuracao exigido em desenvolvimento", () => {
    const policy = buildContentSecurityPolicy("nonce-local", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
