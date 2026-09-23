import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import GooglePlayBillingPanel from "../components/GooglePlayBillingPanel";
import { useAppTheme } from "./_layout";

type Plano = { name: string; subtitle: string; accent: string; badge?: string; items: readonly string[] };
const PLANOS: readonly Plano[] = [
  { name: "Gratuito", subtitle: "Para organizar o essencial", accent: "#54B689", items: ["40 lançamentos por mês", "2 contas, 1 cartão e 1 objetivo", "7 categorias por tipo", "Fluxo mensal e relatórios resumidos", "Contas compartilhadas"] },
  { name: "Pro", subtitle: "Mais capacidade para o dia a dia", accent: "#2A9D8F", badge: "MAIS POPULAR", items: ["150 lançamentos por mês", "5 contas, 3 cartões e 3 objetivos", "14 categorias por tipo", "Fluxo diário, extrato e conciliação", "Relatórios completos", "IA: 60 consultas e 15 ações por dia"] },
  { name: "Plus", subtitle: "Controle e inteligência completos", accent: "#E9A15B", badge: "COMPLETO", items: ["Lançamentos e recursos ilimitados", "Todos os recursos do Pro", "Projeções e análises avançadas", "IA: 200 consultas e 50 ações por dia", "Contas compartilhadas"] },
];

export default function PlanosScreen() {
  const { isDark, session, billingEnabled, plano, refreshEntitlement, showToast } = useAppTheme();
  const router = useRouter();
  const colors = { background: isDark ? "#0C1818" : "#F5F7F5", text: isDark ? "#F5FAF8" : "#17302D", muted: isDark ? "#9DB0AD" : "#60716E", card: isDark ? "#132625" : "#FFFFFF", border: isDark ? "#29413E" : "#D9E5E1" };
  return <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={8} onPress={() => router.back()} style={styles.back}><MaterialIcons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity><Text style={[styles.headerTitle, { color: colors.text }]}>Planos FinFlow</Text><View style={styles.headerSpacer} /></View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}><Text style={[styles.eyebrow, { color: "#54B689" }]}>ESCOLHA SEU PLANO</Text><Text style={[styles.title, { color: colors.text }]}>Cresça no seu ritmo</Text><Text style={[styles.copy, { color: colors.muted }]}>Os planos já estão definidos. As cobranças continuam desativadas nesta versão local.</Text></View>
      {PLANOS.map((plan, index) => <View key={plan.name} style={[styles.card, { backgroundColor: colors.card, borderColor: index === 1 ? plan.accent : colors.border }]}>
        <View style={styles.cardTop}><View style={styles.cardHeading}><Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{plan.subtitle}</Text></View>{plan.badge ? <Text style={[styles.badge, { color: plan.accent, borderColor: `${plan.accent}66`, backgroundColor: `${plan.accent}18` }]}>{plan.badge}</Text> : null}</View>
        <View style={styles.items}>{plan.items.map((item) => <View key={item} style={styles.item}><MaterialIcons name="check-circle" size={18} color={plan.accent} /><Text style={[styles.itemText, { color: colors.text }]}>{item}</Text></View>)}</View>
        <View style={[styles.disabledButton, { borderColor: colors.border }]}><MaterialIcons name="lock-outline" size={18} color={colors.muted} /><Text style={[styles.disabledText, { color: colors.muted }]}>{index === 0 ? "Plano inicial" : Platform.OS === "android" ? "Opções de assinatura abaixo" : "Assinatura em breve"}</Text></View>
      </View>)}
      <GooglePlayBillingPanel
        isDark={isDark}
        userId={session?.user?.id}
        billingEnabled={billingEnabled}
        currentPlan={plano}
        refreshEntitlement={refreshEntitlement}
        showToast={showToast}
      />
      <Text style={[styles.note, { color: colors.muted }]}>Parcelas e recorrências contam no mês do vencimento. Transferências contam uma vez. Uma conta compartilhada ocupa uma vaga de cada participante após o aceite.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, header: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }, back: { width: 48, height: 48, alignItems: "center", justifyContent: "center" }, headerSpacer: { width: 48 }, headerTitle: { fontSize: 20, fontWeight: "900" }, content: { padding: 20, paddingBottom: 40, gap: 16 }, intro: { alignItems: "center", paddingVertical: 8, gap: 6 }, eyebrow: { fontSize: 12, fontWeight: "900", letterSpacing: 1.2 }, title: { fontSize: 28, fontWeight: "900", textAlign: "center" }, copy: { maxWidth: 430, fontSize: 15, lineHeight: 22, textAlign: "center" }, card: { borderWidth: 1, borderRadius: 20, padding: 20 }, cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, cardHeading: { flex: 1 }, planName: { fontSize: 24, fontWeight: "900" }, subtitle: { marginTop: 3, fontSize: 14, lineHeight: 20 }, badge: { overflow: "hidden", borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "900" }, items: { marginTop: 18, gap: 12 }, item: { minHeight: 24, flexDirection: "row", alignItems: "flex-start", gap: 10 }, itemText: { flex: 1, fontSize: 15, lineHeight: 21 }, disabledButton: { minHeight: 48, marginTop: 20, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: 0.72 }, disabledText: { fontSize: 14, fontWeight: "800" }, note: { fontSize: 13, lineHeight: 20, textAlign: "center", paddingHorizontal: 8 },
});
