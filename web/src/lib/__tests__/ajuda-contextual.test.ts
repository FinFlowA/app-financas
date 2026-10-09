// Toda aba do menu do site tem a ajuda do Finn (o botão que explica a tela).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("ajuda do Finn em cada aba", () => {
  it("cada endereço do menu tem uma ajuda cadastrada", () => {
    const menu = readFileSync(join(raiz, "web/src/components/layout/dashboard-nav.tsx"), "utf8");
    const ajuda = readFileSync(join(raiz, "web/src/components/layout/contextual-help.tsx"), "utf8");
    const enderecos = [...menu.matchAll(/href: "(\/[^"]*)"/g)].map((m) => m[1]);
    const comAjuda = new Set([...ajuda.matchAll(/route: "(\/[^"]*)"/g)].map((m) => m[1]));
    expect(enderecos.length).toBeGreaterThan(5);
    expect(enderecos.filter((endereco) => !comAjuda.has(endereco))).toEqual([]);
  });
});
