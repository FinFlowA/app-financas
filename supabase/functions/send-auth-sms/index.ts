import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

import { adminClient, serverSecret } from "../_shared/supabase.ts";

type SendSmsHookEvent = {
  user?: {
    id?: string;
    phone?: string;
  };
  sms?: {
    otp?: string;
  };
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hookError(status: number, message: string) {
  return response({ error: { http_code: status, message } }, status);
}

function webhookSecret(): string {
  const configured = serverSecret("SEND_SMS_HOOK_SECRET").trim();
  const normalized = configured.replace(/^v1,whsec_/, "");
  if (!normalized) throw new Error("INVALID_HOOK_SECRET");
  return normalized;
}

function validPhone(phone: string): boolean {
  return /^\+55[1-9]{2}9\d{8}$/.test(phone);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return hookError(405, "Método não permitido.");

  let event: SendSmsHookEvent;
  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers.entries());
    event = new Webhook(webhookSecret()).verify(payload, headers) as SendSmsHookEvent;
  } catch {
    console.warn("send-auth-sms: assinatura inválida");
    return hookError(401, "Assinatura do hook inválida.");
  }

  const userId = event.user?.id ?? "";
  const phone = event.user?.phone ?? "";
  const otp = event.sms?.otp ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !validPhone(phone) || !/^\d{6}$/.test(otp)) {
    return hookError(400, "Solicitação de SMS inválida.");
  }

  try {
    const admin = adminClient();
    const { data: reserved, error: reservationError } = await admin.rpc(
      "reserve_phone_verification",
      { p_user_id: userId, p_phone: phone },
    );

    if (reservationError) {
      console.error("send-auth-sms: falha na reserva", reservationError.code ?? "UNKNOWN");
      return hookError(503, "Não foi possível preparar a verificação do telefone.");
    }
    if (reserved !== true) {
      return hookError(409, "Este telefone já está sendo verificado por outra conta.");
    }

    const sender = (Deno.env.get("BREVO_SMS_SENDER") ?? "FinFlow").trim();
    if (!/^[A-Za-z0-9]{3,11}$/.test(sender)) {
      console.error("send-auth-sms: remetente inválido");
      return hookError(503, "O serviço de SMS ainda não está configurado corretamente.");
    }

    const controller = new AbortController();
    // Supabase encerra hooks de Auth em cerca de 5 s. Preserve margem para
    // validar a assinatura, reservar o telefone e devolver a resposta.
    const timeout = setTimeout(() => controller.abort(), 3_200);
    let brevoResponse: Response;
    try {
      brevoResponse = await fetch("https://api.brevo.com/v3/transactionalSMS/send", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": serverSecret("BREVO_API_KEY"),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender,
          recipient: phone,
          content: `FinFlow: seu codigo de verificacao e ${otp}. Nao compartilhe este codigo.`,
          type: "transactional",
          tag: "phone_verification",
          unicodeEnabled: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!brevoResponse.ok) {
      console.error("send-auth-sms: Brevo recusou o envio", brevoResponse.status);
      if (brevoResponse.status === 429) {
        return hookError(429, "Limite temporário de SMS atingido. Aguarde e tente novamente.");
      }
      if (brevoResponse.status === 400) {
        return hookError(400, "A operadora recusou este número de telefone.");
      }
      return hookError(503, "O serviço de SMS está temporariamente indisponível.");
    }

    return response({});
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "UNEXPECTED";
    console.error("send-auth-sms:", reason);
    return hookError(503, "Não foi possível enviar o SMS agora.");
  }
});
