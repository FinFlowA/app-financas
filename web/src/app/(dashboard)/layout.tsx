import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import DisplayControls from "@/components/layout/display-controls";
import DashboardNav, { MobileDashboardNav } from "@/components/layout/dashboard-nav";
import ProfileAndTutorial from "@/components/onboarding/profile-and-tutorial";
import CategoryBootstrap from "@/components/onboarding/category-bootstrap";
import FinancialNotificationScheduler from "@/components/notifications/financial-notification-scheduler";
import { LEGAL_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { ageFromIsoDate } from "@/lib/auth/validation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // getClaims() verifica o JWT localmente (sem round-trip ao servidor de auth
  // a cada navegação); o proxy.ts já fez a verificação forte contra o
  // servidor antes de deixar a requisição chegar aqui.
  const [{ data }, { data: entitlementData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("get_my_entitlement"),
  ]);
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;
  const metadata = data?.claims.user_metadata as Record<string, unknown> | undefined;
  const nome = typeof metadata?.nome_usuario === "string" ? metadata.nome_usuario : "Usuário";
  const entitlement = Array.isArray(entitlementData) ? entitlementData[0] : entitlementData;
  const plan = entitlement && typeof entitlement === "object" && "plan" in entitlement
    ? String(entitlement.plan)
    : "free";
  const birthDate = typeof metadata?.data_nascimento === "string" ? metadata.data_nascimento : "";
  const age = ageFromIsoDate(birthDate);
  // Uma string preenchida, mas inválida, não pode contornar a pendência.
  // Sessões antigas de menores também voltam ao fluxo que encerra o acesso.
  const missingBirth = age === null || age < 18;
  const missingTerms = typeof metadata?.termos_aceitos_em !== "string" || metadata?.termos_versao !== LEGAL_DOCUMENT_VERSION;
  const tutorialPending = metadata?.tutorial_pendente === true;
  const categoriesInitialized = metadata?.categorias_iniciais_criadas === true;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface p-5 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
            F
          </div>
          <span className="text-lg font-extrabold text-foreground">FinFlow</span>
        </div>

        <DashboardNav />

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link href="/contas" className="ff-focus rounded-ff-sm border border-border px-2 py-2 text-center text-xs font-bold text-foreground-muted hover:bg-surface-muted">Contas</Link>
          <Link href="/categorias" className="ff-focus rounded-ff-sm border border-border px-2 py-2 text-center text-xs font-bold text-foreground-muted hover:bg-surface-muted">Categorias</Link>
          <Link href="/planos" className="ff-focus col-span-2 rounded-ff-sm border border-primary/30 bg-primary-soft px-2 py-2 text-center text-xs font-bold capitalize text-primary-dark">Plano {plan}</Link>
        </div>

        <div className="mt-auto border-t border-border pt-4">
          <DisplayControls />
          <p className="mt-4 truncate text-sm font-bold text-foreground">{nome}</p>
          <p className="mb-3 truncate text-xs text-foreground-muted">{email}</p>
          <SignOutButton />
          <p className="mt-3 text-[10px] text-foreground-muted">FinFlow 2.0 · Web</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2 font-extrabold text-foreground"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white">F</span>FinFlow</Link>
          <DisplayControls />
        </header>
        <main className="mx-auto min-h-screen w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <MobileDashboardNav />
      <ProfileAndTutorial missingBirth={missingBirth} missingTerms={missingTerms} tutorialPending={tutorialPending} />
      {typeof data?.claims.sub === "string" && <CategoryBootstrap userId={data.claims.sub} initialized={categoriesInitialized} />}
      {typeof data?.claims.sub === "string" && <FinancialNotificationScheduler userId={data.claims.sub} />}
    </div>
  );
}
