import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import { ThemeInitializer } from "@/components/layout/display-controls";
import BrandLogo from "@/components/layout/brand-logo";
import DashboardNav, { MobileDashboardNav } from "@/components/layout/dashboard-nav";
import RouteFrame from "@/components/layout/route-frame";
import ProfileAndTutorial from "@/components/onboarding/profile-and-tutorial";
import CategoryBootstrap from "@/components/onboarding/category-bootstrap";
import FinancialNotificationLoader from "@/components/notifications/financial-notification-loader";
import PartnershipNotificationPopup, { type PartnershipNotification } from "@/components/notifications/partnership-notification-popup";
import ContextualHelp from "@/components/layout/contextual-help";
import { LEGAL_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { ageFromIsoDate } from "@/lib/auth/validation";
import { profileImageUrl } from "@/lib/auth/profile";
import ProfileAvatar from "@/components/layout/profile-avatar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // getClaims() verifica o JWT localmente (sem round-trip ao servidor de auth
  // a cada navegação); o proxy.ts já fez a verificação forte contra o
  // servidor antes de deixar a requisição chegar aqui.
  const [{ data }, { data: userData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getUser(),
  ]);
  if (typeof data?.claims.sub === "string") {
    // Recompõe de forma idempotente a janela móvel das séries fixas. Uma
    // indisponibilidade momentânea não deve impedir o acesso ao painel.
    await supabase.rpc("refresh_my_recurring_schedules");
  }
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;
  // getClaims() pode continuar com o JWT anterior logo depois de uma edição de
  // perfil. getUser() mantém a edição e o nome inicial do Google sincronizados.
  const metadata = (userData.user?.user_metadata ?? data?.claims.user_metadata) as Record<string, unknown> | undefined;
  const nameCandidates = [metadata?.nome_usuario, metadata?.full_name, metadata?.name];
  const nome = nameCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim()
    ?? email?.split("@")[0]
    ?? "Usuário";
  const avatarUrl = profileImageUrl(metadata, userData.user?.identities);
  const birthDate = typeof metadata?.data_nascimento === "string" ? metadata.data_nascimento : "";
  const age = ageFromIsoDate(birthDate);
  // Uma string preenchida, mas inválida, não pode contornar a pendência.
  const missingBirth = age === null;
  const missingTerms = typeof metadata?.termos_aceitos_em !== "string" || metadata?.termos_versao !== LEGAL_DOCUMENT_VERSION;
  const tutorialPending = metadata?.tutorial_pendente === true;
  const categoriesInitialized = metadata?.categorias_padrao_versao === 1;
  const partnershipNotifications = typeof data?.claims.sub === "string"
    ? await supabase.from("notificacoes_sistema")
      .select("id,tipo,titulo,mensagem,criada_em")
      .eq("destinatario_id", data.claims.sub)
      .is("lida_em", null)
      .in("tipo", ["convite_parceria", "parceria_aceita", "parceria_recusada", "parceria_encerrada"])
      .order("criada_em")
      .limit(10)
    : { data: [] };

  return (
    <div className="ff-app-shell">
      <a href="#conteudo-principal" className="ff-skip-link">Pular para o conteúdo</a>
      <ThemeInitializer />
      <aside className="ff-sidebar">
        <BrandLogo priority className="ff-sidebar__brand" />

        <DashboardNav />

        <div className="ff-sidebar__footer">
          <div className="ff-sidebar-profile">
            <ProfileAvatar imageUrl={avatarUrl} name={nome} />
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
      <PartnershipNotificationPopup notifications={(partnershipNotifications.data ?? []) as PartnershipNotification[]} />
    </div>
  );
}
