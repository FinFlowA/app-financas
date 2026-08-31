import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import { ThemeInitializer } from "@/components/layout/display-controls";
import BrandLogo from "@/components/layout/brand-logo";
import DashboardNav, { MobileDashboardNav } from "@/components/layout/dashboard-nav";
import RouteFrame from "@/components/layout/route-frame";
import ProfileAndTutorial from "@/components/onboarding/profile-and-tutorial";
import CategoryBootstrap from "@/components/onboarding/category-bootstrap";
import FinancialNotificationLoader from "@/components/notifications/financial-notification-loader";
import ContextualHelp from "@/components/layout/contextual-help";
import { LEGAL_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { ageFromIsoDate } from "@/lib/auth/validation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // getClaims() verifica o JWT localmente (sem round-trip ao servidor de auth
  // a cada navegação); o proxy.ts já fez a verificação forte contra o
  // servidor antes de deixar a requisição chegar aqui.
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims.sub === "string") {
    // Recompõe de forma idempotente a janela móvel das séries fixas. Uma
    // indisponibilidade momentânea não deve impedir o acesso ao painel.
    await supabase.rpc("refresh_my_recurring_schedules");
  }
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;
  const metadata = data?.claims.user_metadata as Record<string, unknown> | undefined;
  const nome = typeof metadata?.nome_usuario === "string" ? metadata.nome_usuario : "Usuário";
  const birthDate = typeof metadata?.data_nascimento === "string" ? metadata.data_nascimento : "";
  const age = ageFromIsoDate(birthDate);
  // Uma string preenchida, mas inválida, não pode contornar a pendência.
  // Sessões antigas de menores também voltam ao fluxo que encerra o acesso.
  const missingBirth = age === null || age < 18;
  const missingTerms = typeof metadata?.termos_aceitos_em !== "string" || metadata?.termos_versao !== LEGAL_DOCUMENT_VERSION;
  const tutorialPending = metadata?.tutorial_pendente === true;
  const categoriesInitialized = metadata?.categorias_padrao_versao === 1;

  return (
    <div className="ff-app-shell">
      <a href="#conteudo-principal" className="ff-skip-link">Pular para o conteúdo</a>
      <ThemeInitializer />
      <aside className="ff-sidebar">
        <BrandLogo priority className="ff-sidebar__brand" />

        <DashboardNav />

        <div className="ff-sidebar__footer">
          <div className="ff-sidebar-profile">
            <span className="ff-sidebar-profile__avatar" aria-hidden="true">{nome.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
            <span className="min-w-0"><strong>{nome}</strong><small>{email}</small></span>
          </div>
          <SignOutButton />
          <p className="ff-sidebar-version">FinFlow 2.0 · Web</p>
        </div>
      </aside>

      <div className="ff-app-content">
        <header className="ff-mobile-header">
          <BrandLogo priority />
        </header>
        <main id="conteudo-principal" className="ff-main-shell"><RouteFrame>{children}</RouteFrame></main>
      </div>
      <MobileDashboardNav />
      <ContextualHelp />
      <ProfileAndTutorial missingBirth={missingBirth} missingTerms={missingTerms} tutorialPending={tutorialPending} />
      {typeof data?.claims.sub === "string" && <CategoryBootstrap userId={data.claims.sub} initialized={categoriesInitialized} />}
      {typeof data?.claims.sub === "string" && <FinancialNotificationLoader userId={data.claims.sub} />}
    </div>
  );
}
