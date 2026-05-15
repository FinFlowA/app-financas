/**
 * app/planos.tsx
 * Tela de comparação e seleção de planos do FinFlow.
 *
 * Mostra Free / Smart / Premium com todos os recursos,
 * alternância mensal/anual e destaque de economia.
 *
 * Integração de pagamento: arquitetura preparada para
 * Stripe, Mercado Pago ou RevenueCat (pontos marcados com TODO).
 */

import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "./_layout";
import {
  PLANOS,
  PRECOS,
  fmtPreco,
  type TipoPlano,
} from "../lib/planos";

export default function PlanosScreen() {
  const { isDark, plano: planoAtual, setPlano, session } = useAppTheme();
  const router = useRouter();

  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [processando, setProcessando] = useState(false);

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F5F5",
    texto: isDark ? "#FFFFFF" : "#1A1A1A",
    secundario: isDark ? "#AAAAAA" : "#666666",
    card: isDark ? "#1E1E1E" : "#FFFFFF",
    borda: isDark ? "#333" : "#EEE",
    pillFundo: isDark ? "#2C2C2C" : "#E8E8E8",
  };

  const getPreco = (planoId: TipoPlano): string => {
    if (planoId === "free") return "Grátis";
    const p = PRECOS[planoId as "smart" | "premium"];
    if (ciclo === "anual") {
      return `R$ ${p.anualPorMes.toFixed(2).replace(".", ",")}/mês`;
    }
    return `R$ ${p.mensal.toFixed(2).replace(".", ",")}/mês`;
  };

  const getSubtituloPreco = (planoId: TipoPlano): string | null => {
    if (planoId === "free") return null;
    const p = PRECOS[planoId as "smart" | "premium"];
    if (ciclo === "anual") {
      return `R$ ${p.anual.toFixed(2).replace(".", ",")} cobrado anualmente`;
    }
    return null;
  };

  const handleSelecionarPlano = async (planoId: TipoPlano) => {
    if (planoId === planoAtual) return;

    if (planoId === "free") {
      Alert.alert(
        "Fazer Downgrade?",
        "Ao voltar para o Free, você perderá acesso a recursos avançados. Seus dados continuam salvos.",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Confirmar",
            onPress: async () => {
              await setPlano("free");
              router.back();
            },
          },
        ]
      );
      return;
    }

    setProcessando(true);

    /**
     * TODO: Integração com pagamento
     *
     * Opção 1 — Stripe:
     *   const session = await stripe.createPaymentSheet({ ... })
     *
     * Opção 2 — Mercado Pago:
     *   const preference = await mp.createPreference({ ... })
     *   await WebBrowser.openBrowserAsync(preference.init_point)
     *
     * Opção 3 — RevenueCat (recomendado para apps mobile):
     *   const offerings = await Purchases.getOfferings()
     *   await Purchases.purchasePackage(package)
     *
     * Após confirmação do pagamento:
     *   await setPlano(planoId)
     *   await sincronizarStatusPremium(session.user.id, planoId)
     */

    // Por enquanto, ativa imediatamente (simulação)
    Alert.alert(
      "Plano Selecionado",
      `O plano ${planoId === "smart" ? "Smart" : "Premium"} foi ativado!\n\n(Integração de pagamento em breve via Stripe/Mercado Pago)`,
      [
        {
          text: "OK",
          onPress: async () => {
            await setPlano(planoId);
            router.back();
          },
        },
      ]
    );

    setProcessando(false);
  };

  const corDestaque = (planoId: TipoPlano) => {
    if (planoId === "smart") return "#2A9D8F";
    if (planoId === "premium") return "#F4A261";
    return Cores.borda;
  };

  const eSelecionado = (planoId: TipoPlano) => planoId === planoAtual;

  return (
    <SafeAreaView style={[estilos.safeArea, { backgroundColor: Cores.fundo }]}>
      {/* Header */}
      <View style={estilos.header}>
        <TouchableOpacity onPress={() => router.back()} style={estilos.voltarBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Cores.texto} />
        </TouchableOpacity>
        <Text style={[estilos.headerTitulo, { color: Cores.texto }]}>Planos FinFlow</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[estilos.subtitulo, { color: Cores.secundario }]}>
          Escolha o plano ideal para o seu controle financeiro
        </Text>

        {/* Alternância Mensal / Anual */}
        <View style={[estilos.cicloContainer, { backgroundColor: Cores.pillFundo }]}>
          <TouchableOpacity
            style={[estilos.cicloBtn, ciclo === "mensal" && { backgroundColor: Cores.card }]}
            onPress={() => setCiclo("mensal")}
          >
            <Text style={[estilos.cicloBtnText, { color: ciclo === "mensal" ? Cores.texto : Cores.secundario }]}>
              Mensal
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[estilos.cicloBtn, ciclo === "anual" && { backgroundColor: Cores.card }]}
            onPress={() => setCiclo("anual")}
          >
            <Text style={[estilos.cicloBtnText, { color: ciclo === "anual" ? Cores.texto : Cores.secundario }]}>
              Anual
            </Text>
            {ciclo === "anual" && (
              <View style={estilos.economiaBadge}>
                <Text style={estilos.economiaBadgeText}>2 meses grátis</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {ciclo === "anual" && (
          <Text style={[estilos.economiaTexto, { color: "#2A9D8F" }]}>
            Economize até R$ 88,90 por ano no plano anual
          </Text>
        )}

        {/* Cards de planos */}
        <View style={estilos.planosContainer}>
          {PLANOS.map((p) => {
            const selecionado = eSelecionado(p.id);
            const destaque = corDestaque(p.id);

            return (
              <TouchableOpacity
                key={p.id}
                style={[
                  estilos.planoCard,
                  {
                    backgroundColor: Cores.card,
                    borderColor: selecionado ? destaque : Cores.borda,
                    borderWidth: selecionado ? 2 : 1,
                  },
                ]}
                onPress={() => handleSelecionarPlano(p.id)}
                activeOpacity={0.8}
              >
                {/* Badge */}
                {p.badge && (
                  <View style={[estilos.badge, { backgroundColor: destaque }]}>
                    <Text style={estilos.badgeText}>{p.badge}</Text>
                  </View>
                )}

                {/* Plano atual */}
                {selecionado && (
                  <View style={[estilos.atualBadge, { backgroundColor: destaque + "22", borderColor: destaque }]}>
                    <MaterialIcons name="check-circle" size={12} color={destaque} />
                    <Text style={[estilos.atualBadgeText, { color: destaque }]}>Plano Atual</Text>
                  </View>
                )}

                {/* Nome e preço */}
                <View style={[estilos.planoHeader, { borderBottomColor: Cores.borda }]}>
                  <Text style={[estilos.planoNome, { color: Cores.texto }]}>{p.nome}</Text>
                  <Text style={[estilos.planoDescricao, { color: Cores.secundario }]}>{p.descricao}</Text>
                  <Text style={[estilos.planoPreco, { color: selecionado ? destaque : Cores.texto }]}>
                    {getPreco(p.id)}
                  </Text>
                  {getSubtituloPreco(p.id) && (
                    <Text style={[estilos.planoSubPreco, { color: Cores.secundario }]}>
                      {getSubtituloPreco(p.id)}
                    </Text>
                  )}
                </View>

                {/* Recursos */}
                <View style={estilos.recursosContainer}>
                  {p.destaque.map((item, i) => (
                    <View key={i} style={estilos.recursoLinha}>
                      <MaterialIcons
                        name="check-circle"
                        size={16}
                        color={destaque}
                        style={{ marginRight: 8, marginTop: 1 }}
                      />
                      <Text style={[estilos.recursoTexto, { color: Cores.texto }]}>{item}</Text>
                    </View>
                  ))}
                </View>

                {/* Botão */}
                {!selecionado && (
                  <TouchableOpacity
                    style={[estilos.btnSelecionar, { backgroundColor: destaque }]}
                    onPress={() => handleSelecionarPlano(p.id)}
                    disabled={processando}
                  >
                    <Text style={estilos.btnSelecionarText}>
                      {p.id === "free" ? "Usar Gratuitamente" : `Assinar ${p.nome}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Nota sobre pagamento */}
        <View style={[estilos.notaContainer, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
          <MaterialIcons name="security" size={18} color={Cores.secundario} />
          <Text style={[estilos.notaTexto, { color: Cores.secundario }]}>
            Pagamento seguro. Cancele a qualquer momento. Seus dados ficam salvos mesmo no downgrade.
          </Text>
        </View>

        {/* Comparação de IA */}
        <View style={[estilos.iaContainer, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
          <Text style={[estilos.iaTitle, { color: Cores.texto }]}>Recursos de Inteligência Artificial</Text>

          <View style={estilos.iaLinha}>
            <Text style={[estilos.iaItem, { color: Cores.secundario }]}>IA Operacional (criar/editar)</Text>
            <View style={estilos.iaPlanos}>
              <MaterialIcons name="close" size={16} color="#E76F51" />
              <MaterialIcons name="check" size={16} color="#2A9D8F" style={{ marginHorizontal: 18 }} />
              <MaterialIcons name="check" size={16} color="#F4A261" />
            </View>
          </View>

          <View style={estilos.iaLinha}>
            <Text style={[estilos.iaItem, { color: Cores.secundario }]}>IA Analítica (análises e insights)</Text>
            <View style={estilos.iaPlanos}>
              <MaterialIcons name="close" size={16} color="#E76F51" />
              <MaterialIcons name="close" size={16} color="#E76F51" style={{ marginHorizontal: 18 }} />
              <MaterialIcons name="check" size={16} color="#F4A261" />
            </View>
          </View>

          <View style={estilos.iaLinha}>
            <Text style={[estilos.iaItem, { color: Cores.secundario }]}>Ações por dia</Text>
            <View style={estilos.iaPlanos}>
              <Text style={[estilos.iaValor, { color: Cores.secundario }]}>0</Text>
              <Text style={[estilos.iaValor, { color: "#2A9D8F", marginHorizontal: 10 }]}>15</Text>
              <Text style={[estilos.iaValor, { color: "#F4A261" }]}>50</Text>
            </View>
          </View>

          <View style={[estilos.iaLegenda]}>
            <Text style={[estilos.iaLegendaItem, { color: Cores.secundario }]}>Free</Text>
            <Text style={[estilos.iaLegendaItem, { color: "#2A9D8F" }]}>Smart</Text>
            <Text style={[estilos.iaLegendaItem, { color: "#F4A261" }]}>Premium</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  voltarBtn: { padding: 8 },
  headerTitulo: { fontSize: 20, fontWeight: "bold" },
  subtitulo: { textAlign: "center", fontSize: 14, marginHorizontal: 24, marginBottom: 20 },

  cicloContainer: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 4,
    marginBottom: 8,
  },
  cicloBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  cicloBtnText: { fontWeight: "700", fontSize: 15 },
  economiaBadge: {
    backgroundColor: "#2A9D8F",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  economiaBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "bold" },
  economiaTexto: { textAlign: "center", fontSize: 13, marginBottom: 16, fontWeight: "600" },

  planosContainer: { paddingHorizontal: 16, gap: 16 },
  planoCard: {
    borderRadius: 16,
    padding: 20,
    position: "relative",
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: { color: "#FFF", fontSize: 11, fontWeight: "bold" },
  atualBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
  },
  atualBadgeText: { fontSize: 11, fontWeight: "bold" },
  planoHeader: {
    borderBottomWidth: 1,
    paddingBottom: 16,
    marginBottom: 16,
  },
  planoNome: { fontSize: 22, fontWeight: "bold", marginBottom: 2 },
  planoDescricao: { fontSize: 13, marginBottom: 10 },
  planoPreco: { fontSize: 26, fontWeight: "bold" },
  planoSubPreco: { fontSize: 12, marginTop: 2 },
  recursosContainer: { gap: 10, marginBottom: 16 },
  recursoLinha: { flexDirection: "row", alignItems: "flex-start" },
  recursoTexto: { flex: 1, fontSize: 14 },
  btnSelecionar: {
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  btnSelecionarText: { color: "#FFF", fontWeight: "bold", fontSize: 15 },

  notaContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  notaTexto: { flex: 1, fontSize: 12, lineHeight: 18 },

  iaContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  iaTitle: { fontSize: 15, fontWeight: "bold", marginBottom: 14 },
  iaLinha: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  iaItem: { flex: 1, fontSize: 13 },
  iaPlanos: { flexDirection: "row", alignItems: "center" },
  iaValor: { fontSize: 13, fontWeight: "bold", width: 30, textAlign: "center" },
  iaLegenda: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 0,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#33333333",
    paddingTop: 8,
  },
  iaLegendaItem: { fontSize: 11, fontWeight: "bold", width: 50, textAlign: "center" },
});
