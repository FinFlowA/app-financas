import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const loginForm = readFileSync(
  resolve(process.cwd(), "src/components/auth/login-form.tsx"),
  "utf8",
);
const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
const cspPolicy = readFileSync(
  resolve(process.cwd(), "src/lib/security/content-security-policy.ts"),
  "utf8",
);
const oauthRoute = readFileSync(
  resolve(process.cwd(), "src/app/auth/oauth/route.ts"),
  "utf8",
);

describe("navegacao do login OAuth", () => {
  it("inicia o OAuth como navegacao e nao como envio de formulario", () => {
    expect(loginForm).toContain('href="/auth/oauth?provider=google"');
    expect(loginForm).not.toMatch(/<form[^>]+action="\/auth\/oauth"/);
  });

  it("mantem formularios restritos ao proprio site", () => {
    expect(cspPolicy).toContain('"form-action \'self\'"');
    expect(nextConfig).toContain("poweredByHeader: false");
  });

  it("forca uma selecao nova para nao reutilizar sessao Google inconsistente", () => {
    expect(oauthRoute).toMatch(/queryParams:\s*\{\s*prompt: "select_account"/);
  });
});
