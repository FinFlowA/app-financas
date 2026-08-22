"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseMoney } from "@/lib/money";

export type SettingsActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function ok(message: string): SettingsActionState {
  return { status: "success", message };
}

function fail(message: string): SettingsActionState {
  return { status: "error", message };
}

function accountDeletionFailure(error: unknown): SettingsActionState {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; details?: unknown }
    : {};
  const marker = [candidate.code, candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (marker.includes("AUTH_STEP_UP_REQUIRED")) {
    return fail("Sua confirmação de identidade expirou. Informe a senha novamente e repita a exclusão.");
  }
  if (marker.includes("ACCOUNT_PARTNERSHIP_PENDING")) {
    return fail("Encerre a parceria ou os convites pendentes antes de excluir sua conta.");
  }
  if (marker.includes("ACCOUNT_DISSOLUTION_PENDING")) {
    return fail("Conclua as decisões da separação antes de excluir sua conta.");
  }
  if (marker.includes("ACCOUNT_SUBSCRIPTION_ACTIVE")) {
    return fail("Cancele a assinatura e confirme que não há pagamento pendente antes de excluir sua conta.");
  }
  if (candidate.code === "23503" || marker.includes("foreign key")) {
    return fail("Ainda existem vínculos financeiros ligados à conta. Encerre a parceria ou as pendências indicadas nesta página e tente novamente.");
  }
  return fail("A exclusão segura não está disponível agora. Nenhum dado foi removido.");
}

function text(formData: FormData, key: string, maximum = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function rawText(formData: FormData, key: string, maximum = 500): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function positiveInteger(formData: FormData, key: string): number | null {
  const value = Number(text(formData, key, 30));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

function refreshSettings() {
  revalidatePath("/configuracoes");
  revalidatePath("/");
}

async function openPartnershipsForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  userEmail: string,
) {
  // O RLS devolve somente linhas em que o chamador é participante ou possui o
  // e-mail convidado. Filtrar novamente aqui evita interpolar o e-mail em `.or`.
  const result = await supabase
    .from("parcerias")
    .select("id,solicitante_id,convidado_id,convidado_email,status")
    .in("status", ["pendente", "aceito"]);
  if (result.error) return { data: null, error: true } as const;

  const normalizedEmail = userEmail.toLocaleLowerCase("pt-BR");
  const data = (result.data ?? []).filter((row) => row.solicitante_id === userId
    || row.convidado_id === userId
    || row.convidado_email.toLocaleLowerCase("pt-BR") === normalizedEmail);
  return { data, error: false } as const;
}

export async function updateProfileAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  if (!auth) return fail("Sua sessão expirou. Entre novamente para continuar.");

  const name = text(formData, "name", 80).replace(/\s+/g, " ");
  if (name.length < 2) return fail("Informe um nome com pelo menos 2 caracteres.");

  const { error } = await auth.supabase.auth.updateUser({
    data: {
      ...auth.user.user_metadata,
      nome_usuario: name,
      full_name: name,
    },
  });
  if (error) return fail("Não foi possível atualizar o perfil agora.");

  refreshSettings();
  return ok("Perfil atualizado com sucesso.");
}

export async function sendFeedbackAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  if (!auth) return fail("Sua sessão expirou. Entre novamente para continuar.");

  const type = text(formData, "type", 30);
  const message = text(formData, "message", 2_000);
  if (!["problema", "sugestao", "reclamação"].includes(type)) {
    return fail("Escolha um tipo de feedback válido.");
  }
  if (message.length < 10) return fail("Descreva seu feedback com pelo menos 10 caracteres.");

  const { error } = await auth.supabase.from("feedbacks").insert({
    user_id: auth.user.id,
    tipo: type,
    mensagem: message,
  });
  if (error) return fail("Não foi possível enviar o feedback. Tente novamente.");
  return ok("Obrigado! Seu feedback foi enviado para a equipe FinFlow.");
}

export async function invitePartnerAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  if (!auth) return fail("Sua sessão expirou. Entre novamente para continuar.");

  const email = text(formData, "email", 254).toLocaleLowerCase("pt-BR");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Informe um e-mail válido.");
  if (email === (auth.user.email ?? "").toLocaleLowerCase("pt-BR")) {
    return fail("Você não pode enviar um convite para a própria conta.");
  }

  const existing = await openPartnershipsForUser(
    auth.supabase,
    auth.user.id,
    (auth.user.email ?? "").toLocaleLowerCase("pt-BR"),
  );
  if (existing.error) return fail("Não foi possível verificar suas parcerias agora.");
  if (existing.data && existing.data.length > 0) {
    return fail(existing.data.some((item) => item.status === "aceito")
      ? "Encerre a parceria atual antes de iniciar outra."
      : "Você já possui um convite de parceria pendente.");
  }

  const { error } = await auth.supabase.from("parcerias").insert({
    solicitante_id: auth.user.id,
    convidado_email: email,
    convidado_id: null,
    status: "pendente",
  });
  if (error) {
    if (error.code === "P0002" || error.message.includes("finflow_invitee_not_found")) {
      return fail("Esse e-mail ainda não possui uma conta FinFlow.");
    }
    if (error.code === "23505") return fail("Já existe um convite para esse e-mail.");
    return fail("Não foi possível enviar o convite. Tente novamente.");
  }

  refreshSettings();
  return ok(`Convite enviado para ${email}.`);
}

async function partnershipForUser(partnershipId: number) {
  const auth = await authenticatedClient();
  if (!auth) return null;
  const { data, error } = await auth.supabase
    .from("parcerias")
    .select("id,solicitante_id,convidado_id,convidado_email,status")
    .eq("id", partnershipId)
    .maybeSingle();
  if (error || !data) return null;
  const email = (auth.user.email ?? "").toLocaleLowerCase("pt-BR");
  const participant = data.solicitante_id === auth.user.id
    || data.convidado_id === auth.user.id
    || data.convidado_email.toLocaleLowerCase("pt-BR") === email;
  return participant ? { ...auth, partnership: data } : null;
}

export async function acceptPartnerAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const partnershipId = positiveInteger(formData, "partnership_id");
  if (!partnershipId) return fail("Convite inválido.");
  const context = await partnershipForUser(partnershipId);
  if (!context) return fail("Convite não encontrado ou sem permissão.");

  const email = (context.user.email ?? "").toLocaleLowerCase("pt-BR");
  if (context.partnership.status !== "pendente"
    || context.partnership.convidado_email.toLocaleLowerCase("pt-BR") !== email) {
    return fail("Somente a pessoa convidada pode aceitar este convite pendente.");
  }

  const { data, error } = await context.supabase.from("parcerias").update({
    convidado_id: context.user.id,
    status: "aceito",
  })
    .eq("id", partnershipId)
    .eq("status", "pendente")
    .is("convidado_id", null)
    .select("id")
    .maybeSingle();
  if (error) return fail("Não foi possível aceitar o convite.");
  if (!data) return fail("Este convite já foi respondido ou cancelado.");
  refreshSettings();
  return ok("Parceria formada com sucesso.");
}

export async function closePendingPartnerAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const partnershipId = positiveInteger(formData, "partnership_id");
  if (!partnershipId) return fail("Convite inválido.");
  const context = await partnershipForUser(partnershipId);
  if (!context || context.partnership.status !== "pendente") {
    return fail("Convite não encontrado ou sem permissão.");
  }
  const requester = context.partnership.solicitante_id === context.user.id;
  const { data, error } = await context.supabase.from("parcerias")
    .delete()
    .eq("id", partnershipId)
    .eq("status", "pendente")
    .select("id")
    .maybeSingle();
  if (error) return fail("Não foi possível encerrar o convite.");
  if (!data) return fail("Este convite já foi respondido ou cancelado.");
  refreshSettings();
  return ok(requester ? "Convite cancelado." : "Convite recusado.");
}

export async function dissolvePartnerAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const partnershipId = positiveInteger(formData, "partnership_id");
  if (!partnershipId) return fail("Parceria inválida.");
  const context = await partnershipForUser(partnershipId);
  if (!context || context.partnership.status !== "aceito") {
    return fail("Parceria ativa não encontrada ou sem permissão.");
  }

  const { error } = await context.supabase.rpc("iniciar_dissolucao_parceria", {
    p_parceria_id: partnershipId,
  });
  if (error) return fail("Nenhuma alteração foi concluída. Tente desfazer a parceria novamente.");
  refreshSettings();
  return ok("Parceria encerrada. Revise abaixo o que ficou com você.");
}

export async function markSystemNotificationAction(formData: FormData): Promise<void> {
  const id = positiveInteger(formData, "notification_id");
  const auth = await authenticatedClient();
  if (!id || !auth) return;

  const { error } = await auth.supabase.rpc("marcar_notificacao_sistema_lida", { p_id: id });
  if (!error) revalidatePath("/configuracoes");
}

export async function resolveAccountDecisionAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  const itemId = positiveInteger(formData, "item_id");
  const decision = text(formData, "decision", 20);
  if (!auth) return fail("Sua sessão expirou.");
  if (!itemId) return fail("Decisão de conta inválida.");
  if (!["keep", "archive"].includes(decision)) return fail("Escolha uma decisão válida.");
  const keep = decision === "keep";

  const { error } = await auth.supabase.rpc("resolver_decisao_conta_dissolucao", {
    p_item_id: itemId,
    p_manter_ativa: keep,
  });
  if (error) return fail("Não foi possível aplicar a decisão sobre a conta.");
  refreshSettings();
  return ok(keep ? "Conta mantida ativa." : "Conta arquivada.");
}

export async function resolveGoalDecisionAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  const decisionId = positiveInteger(formData, "decision_id");
  const decision = text(formData, "decision", 20);
  const balance = parseMoney(formData.get("balance"));
  if (!auth) return fail("Sua sessão expirou.");
  if (!decisionId) return fail("Decisão de objetivo inválida.");
  if (!["keep", "discard"].includes(decision)) return fail("Escolha uma decisão válida.");
  const keep = decision === "keep";
  if (keep && (!Number.isFinite(balance) || balance < 0)) return fail("Informe um saldo válido.");

  const { error } = await auth.supabase.rpc("resolver_decisao_caixinha", {
    p_decisao_id: decisionId,
    p_manter: keep,
    p_saldo: keep ? balance : null,
  });
  if (error) {
    if (error.code === "22003") return fail("O saldo informado supera o valor ainda disponível.");
    return fail("Não foi possível aplicar a decisão sobre o objetivo.");
  }
  refreshSettings();
  return ok(keep ? "Objetivo mantido com o saldo definido." : "Objetivo descartado.");
}

export async function confirmDissolutionSummaryAction(formData: FormData): Promise<void> {
  const summaryId = positiveInteger(formData, "summary_id");
  const auth = await authenticatedClient();
  if (!summaryId || !auth) return;
  const { error } = await auth.supabase.rpc("confirmar_resumo_dissolucao", { p_resumo_id: summaryId });
  if (!error) revalidatePath("/configuracoes");
}

export async function deleteAccountAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const auth = await authenticatedClient();
  if (!auth) return fail("Sua sessão expirou. Entre novamente para continuar.");
  if (text(formData, "confirmation", 20).toLocaleUpperCase("pt-BR") !== "EXCLUIR") {
    return fail('Digite "EXCLUIR" para confirmar a exclusão permanente.');
  }

  const email = (auth.user.email ?? "").toLocaleLowerCase("pt-BR");
  const currentPassword = rawText(formData, "current_password", 128);
  if (!email || !currentPassword) return fail("Informe sua senha atual para confirmar sua identidade.");
  const { error: reauthenticationError } = await auth.supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (reauthenticationError) return fail("Senha atual incorreta. Nenhum dado foi removido.");

  const [partnerships, subscriptions, accountDecisions, goalDecisions] = await Promise.all([
    openPartnershipsForUser(auth.supabase, auth.user.id, email),
    auth.supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", auth.user.id)
      .in("status", ["pending", "active", "past_due", "grace_period", "paused"])
      .limit(1),
    auth.supabase.rpc("get_minhas_decisoes_conta_dissolucao"),
    auth.supabase.rpc("get_minhas_decisoes_caixinha"),
  ]);

  if (partnerships.error || subscriptions.error || accountDecisions.error || goalDecisions.error) {
    return fail("Não foi possível validar com segurança todas as pendências da conta.");
  }
  if ((partnerships.data?.length ?? 0) > 0) {
    return fail("Encerre a parceria ou os convites pendentes antes de excluir sua conta.");
  }
  if ((accountDecisions.data?.length ?? 0) > 0 || (goalDecisions.data?.length ?? 0) > 0) {
    return fail("Conclua as decisões da separação antes de excluir sua conta.");
  }
  if ((subscriptions.data?.length ?? 0) > 0) {
    return fail("Cancele a assinatura e confirme que não há pagamento pendente antes de excluir sua conta.");
  }

  // A remoção inteira fica a cargo da RPC SECURITY DEFINER do banco. O site
  // nunca tenta apagar tabelas individualmente nem escreve em auth.users.
  const { error } = await auth.supabase.rpc("delete_user");
  if (error) {
    return accountDeletionFailure(error);
  }

  await auth.supabase.auth.signOut({ scope: "local" });
  redirect("/login?conta=excluida");
}
