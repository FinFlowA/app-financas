import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";

const NAV_ITEMS = [
  { href: "/", label: "Início" },
  { href: "/transacoes", label: "Histórico" },
  { href: "/objetivos", label: "Objetivos" },
  { href: "/cartoes", label: "Cartões" },
  { href: "/relatorios", label: "Fluxo de caixa" },
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // getClaims() verifica o JWT localmente (sem round-trip ao servidor de auth
  // a cada navegação); o proxy.ts já fez a verificação forte contra o
  // servidor antes de deixar a requisição chegar aqui.
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface p-5">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
            F
          </div>
          <span className="text-lg font-extrabold text-foreground">FinFlow</span>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-ff-sm px-3 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto border-t border-border pt-4">
          <p className="mb-3 truncate text-xs text-foreground-muted">{email}</p>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
