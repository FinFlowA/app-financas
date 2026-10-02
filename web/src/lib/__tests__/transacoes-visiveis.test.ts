import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filtroTransacoesVisiveis } from "../transacoes-visiveis";

const USUARIO = "10000000-0000-4000-8000-000000000001";

describe("filtro das transações visíveis", () => {
  it("pede as próprias e as das contas visíveis, sem repetir contas", () => {
    expect(filtroTransacoesVisiveis(USUARIO, [3, 1, 3, "2"])).toBe(`user_id.eq.${USUARIO},conta_id.in.(3,1,2)`);
  });

  it("sem contas visíveis, pede só as próprias", () => {
    expect(filtroTransacoesVisiveis(USUARIO, [])).toBe(`user_id.eq.${USUARIO}`);
  });

  it("ignora ids inválidos e recusa usuário fora do formato", () => {
    expect(filtroTransacoesVisiveis(USUARIO, [0, -1, 1.5, "x", 7])).toBe(`user_id.eq.${USUARIO},conta_id.in.(7)`);
    expect(() => filtroTransacoesVisiveis("1,user_id.neq.0", [1])).toThrow();
  });

  it("toda lista paginada de transações do site e do app usa o filtro", () => {
    const raiz = join(__dirname, "..", "..", "..", "..");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- só caminhos fixos das listas abaixo
    const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");
    const site = [
      "web/src/app/(dashboard)/page.tsx",
      "web/src/app/(dashboard)/relatorios/page.tsx",
      "web/src/app/(dashboard)/objetivos/page.tsx",
      "web/src/app/(dashboard)/contas/page.tsx",
      "web/src/app/(dashboard)/conciliacao/page.tsx",
      "web/src/app/(dashboard)/cartoes/[id]/page.tsx",
      "web/src/app/(dashboard)/calendario/page.tsx",
      "web/src/app/(dashboard)/transacoes/page.tsx",
    ];
    for (const arquivo of site) {
      const codigo = ler(arquivo);
      expect(codigo, arquivo).toMatch(/filtroTransacoesDoUsuario\(supabase\)/);
      expect(codigo, arquivo).toMatch(/\.from\("transacoes"\)\s*\.select\([^)]*\)\s*\.or\(filtro\)/);
    }
    expect(ler("web/src/components/notifications/financial-notification-scheduler.tsx")).toMatch(/\.or\(filtroTransacoesVisiveis\(userId,/);
    for (const arquivo of ["app/(tabs)/index.tsx", "app/(tabs)/transacoes.tsx", "app/(tabs)/relatorios.tsx"]) {
      expect(ler(arquivo), arquivo).toMatch(/\.or\(filtroTransacoesVisiveis\(session\.user\.id,/);
    }
  });
});
