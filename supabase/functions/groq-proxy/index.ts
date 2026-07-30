import { handleOptions, json } from "../_shared/http.ts";
import { adminClient, authenticatedUser, serverSecret } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const user = await authenticatedUser(req);
    const allowed = serverSecret("FINFLOW_AI_ALLOWED_EMAILS")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!user.email || !allowed.includes(user.email.toLowerCase())) return json({ error: "FORBIDDEN" }, 403);

    const admin = adminClient();
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await admin
      .from("ai_request_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if ((count ?? 0) >= 60) return json({ error: "RATE_LIMITED" }, 429);

    const { systemPrompt, messages } = await req.json();
    if (typeof systemPrompt !== "string" || systemPrompt.length > 30_000 || !Array.isArray(messages) || messages.length > 20) {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    const safeMessages = messages.map((message: any) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content ?? "").slice(0, 4_000),
    }));
    await admin.from("ai_request_usage").insert({ user_id: user.id });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverSecret("GROQ_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Groq error", response.status);
      return json({ error: "AI_PROVIDER_FAILED" }, 502);
    }
    return json({ content: body.choices?.[0]?.message?.content ?? "" });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
    console.error("groq-proxy", error);
    return json({ error: "AI_PROXY_FAILED" }, 500);
  }
});
