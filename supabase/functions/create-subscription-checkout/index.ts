import { handleOptions, json } from "../_shared/http.ts";
import { mercadoPago } from "../_shared/mercado-pago.ts";
import { adminClient, authenticatedUser, serverSecret } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const user = await authenticatedUser(req);
    if (!user.email) return json({ error: "EMAIL_REQUIRED" }, 400);
    const { productCode } = await req.json();
    if (typeof productCode !== "string") return json({ error: "INVALID_PRODUCT" }, 400);

    const admin = adminClient();
    const { data: settings } = await admin.from("billing_settings").select("billing_enabled").eq("id", true).single();
    if (!settings?.billing_enabled) return json({ error: "BILLING_NOT_AVAILABLE" }, 409);

    const { data: product, error: productError } = await admin
      .from("billing_products")
      .select("code, plan, billing_cycle, amount_brl, active")
      .eq("code", productCode)
      .eq("active", true)
      .single();
    if (productError || !product) return json({ error: "INVALID_PRODUCT" }, 400);

    const { data: recent } = await admin
      .from("subscriptions")
      .select("id, provider_subscription_id, provider_payload, created_at")
      .eq("user_id", user.id)
      .eq("product_code", product.code)
      .eq("provider", "mercado_pago")
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.provider_payload?.init_point) {
      return json({ checkoutUrl: recent.provider_payload.init_point, subscriptionId: recent.id });
    }

    const { data: local, error: insertError } = await admin.from("subscriptions").insert({
      user_id: user.id,
      product_code: product.code,
      plan: product.plan,
      billing_cycle: product.billing_cycle,
      provider: "mercado_pago",
      status: "pending",
    }).select("id").single();
    if (insertError || !local) throw insertError ?? new Error("LOCAL_SUBSCRIPTION_FAILED");

    const frequencyType = product.billing_cycle === "annual" ? "months" : "months";
    const frequency = product.billing_cycle === "annual" ? 12 : 1;
    const backUrl = serverSecret("FINFLOW_BILLING_RETURN_URL");
    const externalReference = `${user.id}:${local.id}`;
    const mp = await mercadoPago("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: `FinFlow ${product.plan === "premium" ? "Premium" : "Smart"} - ${product.billing_cycle === "annual" ? "Anual" : "Mensal"}`,
        external_reference: externalReference,
        payer_email: user.email,
        auto_recurring: {
          frequency,
          frequency_type: frequencyType,
          transaction_amount: Number(product.amount_brl),
          currency_id: "BRL",
        },
        back_url: backUrl,
        status: "pending",
      }),
    });

    const { error: updateError } = await admin.from("subscriptions").update({
      provider_subscription_id: mp.id,
      provider_customer_id: mp.payer_id ? String(mp.payer_id) : null,
      status: "pending",
      provider_payload: { init_point: mp.init_point, date_created: mp.date_created },
      last_provider_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", local.id);
    if (updateError) throw updateError;

    return json({ checkoutUrl: mp.init_point, subscriptionId: local.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") return json({ error: message }, 401);
    console.error("create-subscription-checkout", message);
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
});
