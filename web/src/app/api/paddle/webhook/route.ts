import { getPaddleInstance } from "@/lib/paddle/server";
import { processPaddleEvent } from "@/lib/paddle/process-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("paddle-signature") ?? "";
  const rawBody = await request.text();
  const secret = process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET?.trim() ?? "";
  if (!signature || !rawBody || !secret) {
    return Response.json({ error: "WEBHOOK_INPUT_MISSING" }, { status: 400 });
  }

  try {
    const event = await getPaddleInstance().webhooks.unmarshal(rawBody, secret, signature);
    await processPaddleEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("paddle-webhook", error instanceof Error ? error.message : "UNKNOWN");
    return Response.json({ error: "WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
  }
}
