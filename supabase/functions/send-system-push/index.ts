import { adminClient } from "../_shared/supabase.ts";

// Acionada pelo gatilho private.enviar_push_notificacao_sistema (pg_net) a cada
// aviso novo em notificacoes_sistema. O corpo traz apenas o id: título, texto e
// destinatário são sempre lidos do banco com a service role, então uma chamada
// externa não consegue forjar conteúdo nem reenviar um aviso já enviado.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "finflow-private-v2";
const EXPO_BATCH_SIZE = 100;

type ExpoTicket = { status: "ok" | "error"; details?: { error?: string } };

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);

  let notificacaoId: number;
  try {
    const body = await req.json();
    notificacaoId = Number(body?.notificacao_id);
  } catch {
    return reply({ error: "INVALID_BODY" }, 400);
  }
  if (!Number.isSafeInteger(notificacaoId) || notificacaoId <= 0) {
    return reply({ error: "INVALID_BODY" }, 400);
  }

  const admin = adminClient();
  const agora = new Date().toISOString();

  // Reserva atômica: só um chamador consegue marcar o aviso como enviado.
  const { data: aviso, error: avisoError } = await admin
    .from("notificacoes_sistema")
    .update({ push_enviado_em: agora })
    .eq("id", notificacaoId)
    .is("push_enviado_em", null)
    .is("lida_em", null)
    .gt("expira_em", agora)
    .select("id, destinatario_id, titulo, mensagem")
    .maybeSingle();
  if (avisoError) return reply({ error: "NOTIFICATION_LOOKUP_FAILED" }, 500);
  if (!aviso) return reply({ sent: 0 });

  const { data: dispositivos, error: dispositivosError } = await admin
    .from("dispositivos_push")
    .select("token")
    .eq("user_id", aviso.destinatario_id);
  if (dispositivosError) return reply({ error: "DEVICE_LOOKUP_FAILED" }, 500);

  const tokens = (dispositivos ?? []).map((d) => d.token as string);
  const tokensInvalidos: string[] = [];
  let enviados = 0;

  for (let inicio = 0; inicio < tokens.length; inicio += EXPO_BATCH_SIZE) {
    const lote = tokens.slice(inicio, inicio + EXPO_BATCH_SIZE);
    const resposta = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(lote.map((to) => ({
        to,
        title: aviso.titulo,
        body: aviso.mensagem,
        sound: "default",
        priority: "high",
        channelId: ANDROID_CHANNEL_ID,
        data: { origem: "finflow_sistema", eventoId: aviso.id, rota: "inicio" },
      }))),
    });
    if (!resposta.ok) continue;

    const { data: tickets } = await resposta.json() as { data?: ExpoTicket[] };
    (tickets ?? []).forEach((ticket, indice) => {
      if (ticket.status === "ok") enviados += 1;
      else if (ticket.details?.error === "DeviceNotRegistered") tokensInvalidos.push(lote[indice]);
    });
  }

  // Aparelhos desinstalados ou com permissão revogada deixam de ser usados.
  if (tokensInvalidos.length > 0) {
    await admin.from("dispositivos_push").delete().in("token", tokensInvalidos);
  }

  return reply({ sent: enviados });
});
