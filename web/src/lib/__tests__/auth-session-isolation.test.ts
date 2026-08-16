import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webSignOutAction = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/sign-out-action.ts"),
  "utf8",
);
const mobileLogin = readFileSync(
  resolve(process.cwd(), "../app/login.tsx"),
  "utf8",
);
const mobileSettings = readFileSync(
  resolve(process.cwd(), "../app/(tabs)/configuracoes.tsx"),
  "utf8",
);
const mobileSupabase = readFileSync(
  resolve(process.cwd(), "../lib/supabase.ts"),
  "utf8",
);
const webServerSupabase = readFileSync(
  resolve(process.cwd(), "src/lib/supabase/server.ts"),
  "utf8",
);
const webAuthActions = readFileSync(
  resolve(process.cwd(), "src/lib/auth/actions.ts"),
  "utf8",
);
const supabaseConfig = readFileSync(
  resolve(process.cwd(), "../supabase/config.toml"),
  "utf8",
);

describe("isolamento de sessao entre site e app", () => {
  it("encerra somente a sessao local nos logouts normais", () => {
    expect(webSignOutAction).toContain('auth.signOut({ scope: "local" })');
    expect(mobileLogin).toContain('auth.signOut({ scope: "local" })');
    expect(mobileSettings).toContain('auth.signOut({ scope: "local" })');

    expect(webSignOutAction).not.toMatch(/auth\.signOut\(\s*\)/);
  });

  it("mantem a politica versionada com varias sessoes por usuario", () => {
    expect(supabaseConfig).toMatch(
      /\[auth\.sessions\][\s\S]*?single_per_user\s*=\s*false/,
    );
  });

  it("nao compartilha o armazenamento da sessao entre site e aplicativo", () => {
    expect(mobileSupabase).toContain("storage: authStorage");
    expect(mobileSupabase).toContain("nativeSecureStore");
    expect(webServerSupabase).toContain('from "next/headers"');
    expect(webServerSupabase).toContain("cookieStore.getAll()");
    expect(webAuthActions).not.toMatch(
      /signInAction[\s\S]*?auth\.signOut\(\s*\)/,
    );
  });
});
