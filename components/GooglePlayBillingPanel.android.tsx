import { MaterialIcons } from "@expo/vector-icons";
import { type ProductSubscription, type Purchase, deepLinkToSubscriptions, useIAP } from "expo-iap";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  GOOGLE_PLAY_BASE_PLANS,
  GOOGLE_PLAY_PRODUCTS,
  obfuscatedGooglePlayAccountId,
  verifyGooglePlayPurchase,
} from "../lib/google-play-billing";

type Cycle = "monthly" | "annual";
type Props = {
  isDark: boolean;
  userId?: string;
  billingEnabled: boolean;
  currentPlan: "free" | "smart" | "premium";
  refreshEntitlement: () => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export default function GooglePlayBillingPanel(props: Props) {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const processedTokens = useRef(new Set<string>());
  const finishRef = useRef<(purchase: Purchase) => Promise<void>>(async () => {});

  const processPurchase = useCallback(async (purchase: Purchase) => {
    const token = purchase.purchaseToken;
    if (!token || processedTokens.current.has(token)) return;
    processedTokens.current.add(token);
    setBusyProduct(purchase.productId);
    try {
      if (purchase.purchaseState === "pending") {
        props.showToast("Pagamento pendente. O plano será liberado após a confirmação da Play Store.", "info");
        return;
      }
      const result = await verifyGooglePlayPurchase(token, purchase.productId);
      if (result.status !== "active" && result.status !== "grace_period") {
        props.showToast("A Play Store ainda não confirmou uma assinatura ativa.", "info");
        return;
      }
      await finishRef.current(purchase);
      await props.refreshEntitlement();
      props.showToast("Assinatura confirmada pela Play Store.", "success");
    } catch {
      processedTokens.current.delete(token);
      props.showToast("Não foi possível validar a compra. Tente restaurar a assinatura.", "error");
    } finally {
      setBusyProduct(null);
    }
  }, [props]);

  const {
    connected,
    subscriptions,
    availablePurchases,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    getAvailablePurchases,
  } = useIAP({
    onPurchaseSuccess: (purchase) => { void processPurchase(purchase); },
    onPurchaseError: (error) => {
      setBusyProduct(null);
      if (error.code !== "user-cancelled") props.showToast("A compra não foi concluída pela Play Store.", "error");
    },
  });

  finishRef.current = (purchase) => finishTransaction({ purchase, isConsumable: false });

  useEffect(() => {
    if (!connected) return;
    void fetchProducts({ skus: Object.values(GOOGLE_PLAY_PRODUCTS), type: "subs" });
  }, [connected, fetchProducts]);

  useEffect(() => {
    for (const purchase of availablePurchases) void processPurchase(purchase);
  }, [availablePurchases, processPurchase]);

  const byId = useMemo(() => new Map(subscriptions.map((product) => [product.id, product])), [subscriptions]);
  const colors = props.isDark
    ? { card: "#132625", border: "#29413E", text: "#F5FAF8", muted: "#9DB0AD", selected: "#1C3A36" }
    : { card: "#FFFFFF", border: "#D9E5E1", text: "#17302D", muted: "#60716E", selected: "#E8F5F0" };

  const targetBasePlan = cycle === "monthly" ? GOOGLE_PLAY_BASE_PLANS.monthly : GOOGLE_PLAY_BASE_PLANS.annual;
  const offerFor = (product?: ProductSubscription) => product?.platform === "android"
    ? product.subscriptionOffers.find((offer) => offer.basePlanIdAndroid === targetBasePlan)
    : undefined;

  const annualSavingFor = (product?: ProductSubscription) => {
    if (cycle !== "annual" || product?.platform !== "android") return null;
    const monthly = product.subscriptionOffers.find((offer) => offer.basePlanIdAndroid === GOOGLE_PLAY_BASE_PLANS.monthly);
    const annual = product.subscriptionOffers.find((offer) => offer.basePlanIdAndroid === GOOGLE_PLAY_BASE_PLANS.annual);
    if (!monthly || !annual || !annual.currency) return null;
    const saving = monthly.price * 12 - annual.price;
    if (saving <= 0) return null;
    try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: annual.currency }).format(saving); }
    catch { return `${annual.currency} ${saving.toFixed(2)}`; }
  };

  const buy = async (productId: string) => {
    if (!props.userId || !props.billingEnabled) return;
    const offer = offerFor(byId.get(productId));
    if (!offer?.offerTokenAndroid) {
      props.showToast("Este plano ainda não está disponível na Play Store.", "info");
      return;
    }
    setBusyProduct(productId);
    try {
      await requestPurchase({
        type: "subs",
        request: { google: {
          skus: [productId],
          subscriptionOffers: [{ sku: productId, offerToken: offer.offerTokenAndroid }],
          obfuscatedAccountId: await obfuscatedGooglePlayAccountId(props.userId),
        } },
      });
    } catch {
      setBusyProduct(null);
      props.showToast("Não foi possível abrir a Play Store.", "error");
    }
  };

  const plans = [
    { id: GOOGLE_PLAY_PRODUCTS.smart, name: "Pro", accent: "#2A9D8F" },
    { id: GOOGLE_PLAY_PRODUCTS.premium, name: "Plus", accent: "#E9A15B" },
  ];
  const enabled = props.billingEnabled && Boolean(props.userId) && connected;

  return <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.headingRow}>
      <View style={styles.headingCopy}>
        <Text style={[styles.eyebrow, { color: "#54B689" }]}>GOOGLE PLAY</Text>
        <Text style={[styles.title, { color: colors.text }]}>Assine pelo Android</Text>
      </View>
      <MaterialIcons name="verified-user" size={25} color="#54B689" accessibilityElementsHidden />
    </View>
    <View style={[styles.segment, { borderColor: colors.border }]}>
      {(["monthly", "annual"] as const).map((value) => <Pressable
        key={value}
        accessibilityRole="button"
        accessibilityState={{ selected: cycle === value }}
        onPress={() => setCycle(value)}
        style={({ pressed }) => [styles.segmentButton, cycle === value && { backgroundColor: colors.selected }, pressed && styles.pressed]}
      ><Text style={[styles.segmentText, { color: cycle === value ? "#2A9D8F" : colors.muted }]}>{value === "monthly" ? "Mensal" : "Anual"}</Text></Pressable>)}
    </View>
    {plans.map((plan) => {
      const product = byId.get(plan.id);
      const offer = offerFor(product);
      const annualSaving = annualSavingFor(product);
      const isCurrent = (plan.id === GOOGLE_PLAY_PRODUCTS.smart && props.currentPlan === "smart") || (plan.id === GOOGLE_PLAY_PRODUCTS.premium && props.currentPlan === "premium");
      return <View key={plan.id} style={[styles.planRow, { borderColor: colors.border }]}>
        <View style={styles.planCopy}>
          <Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text>
          <Text style={[styles.price, { color: colors.muted }]}>{offer?.displayPrice ?? "Aguardando cadastro na Play Store"}</Text>
          {annualSaving ? <Text style={styles.saving}>Economize {annualSaving} por ano</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isCurrent ? `Gerenciar plano ${plan.name}` : `Assinar plano ${plan.name}`}
          disabled={!enabled || Boolean(busyProduct)}
          onPress={() => isCurrent ? void deepLinkToSubscriptions({ skuAndroid: plan.id }) : void buy(plan.id)}
          style={({ pressed }) => [styles.buyButton, { backgroundColor: plan.accent }, (!enabled || busyProduct) && styles.disabled, pressed && styles.pressed]}
        >{busyProduct === plan.id ? <ActivityIndicator color="#071B19" /> : <Text style={styles.buyText}>{isCurrent ? "Gerenciar" : "Assinar"}</Text>}</Pressable>
      </View>;
    })}
    <Pressable
      accessibilityRole="button"
      disabled={!enabled || Boolean(busyProduct)}
      onPress={() => void getAvailablePurchases()}
      style={({ pressed }) => [styles.restore, pressed && styles.pressed]}
    ><MaterialIcons name="restore" size={18} color={colors.muted} /><Text style={[styles.restoreText, { color: colors.muted }]}>Restaurar compras</Text></Pressable>
    {!props.billingEnabled ? <Text style={[styles.notice, { color: colors.muted }]}>As assinaturas serão habilitadas após a configuração e aprovação do app na Play Store.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 16 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headingCopy: { flex: 1 }, eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { marginTop: 3, fontSize: 21, fontWeight: "900" },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3 },
  segmentButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  segmentText: { fontSize: 14, fontWeight: "800" },
  planRow: { minHeight: 72, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  planCopy: { flex: 1 }, planName: { fontSize: 17, fontWeight: "900" }, price: { marginTop: 3, fontSize: 13 },
  saving: { marginTop: 4, color: "#2A9D8F", fontSize: 12, fontWeight: "900" },
  buyButton: { minWidth: 104, minHeight: 48, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buyText: { color: "#071B19", fontSize: 14, fontWeight: "900" },
  restore: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  restoreText: { fontSize: 14, fontWeight: "800" }, notice: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 },
});
