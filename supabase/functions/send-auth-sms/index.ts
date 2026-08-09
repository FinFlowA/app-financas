import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

import { HttpRequestError, readJsonRequest } from "../_shared/http.ts";
import { adminClient, serverSecret } from "../_shared/supabase.ts";

type SendSmsHookEvent = {
  user?: {
    id?: string;
    phone?: string;
    new_phone?: string;
  };
  sms?: {
    otp?: string;
  };
};

function response(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
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

function normalizeBrazilianMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (/^55[1-9]{2}9\d{8}$/.test(digits)) return `+${digits}`;
  if (/^[1-9]{2}9\d{8}$/.test(digits)) return `+55${digits}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return hookError(405, "Método não permitido.");

  let event: SendSmsHookEvent;
  try {
    const { raw: payload } = await readJsonRequest(req, { maxBytes: 16_000 });
    const headers = Object.fromEntries(req.headers.entries());
    event = new Webhook(webhookSecret()).verify(payload, headers) as SendSmsHookEvent;
  } catch (error) {
    if (error instanceof HttpRequestError) {
      return hookError(error.status, error.message);
    }
    console.warn("send-auth-sms: assinatura inválida");
    return hookError(401, "Assinatura do hook inválida.");
  }

  const userId = typeof event.user?.id === "string" ? event.user.id.trim() : "";
  // Em alterações de telefone, o Auth serializa o campo interno
  // `phone_change` como `new_phone`. Em login/cadastro por telefone, usa
  // `phone`. O número novo precisa ter prioridade para o OTP não ser enviado
  // ao telefone anterior.
  const phoneSource = event.user?.new_phone || event.user?.phone || "";
  const phone = normalizeBrazilianMobile(phoneSource);
  const otp = typeof event.sms?.otp === "string" ? event.sms.otp.trim() : "";
  const validUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
  const validOtp = /^\d{6}$/.test(otp);
  if (!validUserId || !phone || !validOtp) {
    console.warn("send-auth-sms: payload inválido", {
      validUserId,
      hasNewPhone: Boolean(event.user?.new_phone),
      hasPhone: Boolean(event.user?.phone),
      phoneType: typeof phoneSource,
      phoneDigits: typeof phoneSource === "string" ? phoneSource.replace(/\D/g, "").length : 0,
      validOtp,
    });
    return hookError(400, "Solicitação de SMS inválida.");
  }

  try {
    const admin = adminClient();
    // Limite duplo: impede tanto uma conta de rotacionar telefones quanto várias
    // contas de bombardearem o mesmo número. O banco persiste apenas os hashes.
    for (const subject of [`user:${userId}`, `phone:${phone}`]) {
      const { data: limitData, error: limitError } = await admin.rpc(
        "reserve_edge_rate_limit",
        {
          p_scope: "sms_verification",
          p_subject: subject,
          p_cooldown_seconds: 60,
          p_window_seconds: 86_400,
          p_max_attempts: 8,
        },
      );
      if (limitError) {
        console.error("send-auth-sms: rate limit indisponível", limitError.code ?? "UNKNOWN");
        return hookError(503, "Não foi possível validar o limite de SMS agora.");
      }
      const limit = Array.isArray(limitData) ? limitData[0] : limitData;
      if (!limit || typeof limit !== "object" || (limit as Record<string, unknown>).allowed !== true) {
        const retryAfter = Math.max(
          1,
          Math.min(86_400, Number((limit as Record<string, unknown> | null)?.retry_after) || 60),
        );
        return response(
          { error: { http_code: 429, message: "Limite de SMS atingido. Aguarde antes de tentar novamente." } },
          429,
          { "Retry-After": String(retryAfter) },
        );
      }
    }

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
