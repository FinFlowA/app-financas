/**
 * app/planos.tsx
 * Tela de planos do FinFlow — temporariamente em manutenção.
 *
 * A comparação de planos e o checkout ficam desativados aqui; o arquivo
 * completo com Free/Smart/Premium continua no histórico do git para quando
 * as assinaturas voltarem.
 */

import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "./_layout";

export default function PlanosScreen() {
  const { isDark } = useAppTheme();
  const router = useRouter();

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F2EC",
    texto: isDark ? "#FFFFFF" : "#27313A",
    secundario: isDark ? "#AAAAAA" : "#6B7280",
    card: isDark ? "#1E1E1E" : "#FFFDF9",
    borda: isDark ? "#333" : "#E5E7EB",
    destaque: "#2A9D8F",
  };

  return (
    <SafeAreaView style={[estilos.safeArea, { backgroundColor: Cores.fundo }]}>
      <View style={estilos.header}>
        <TouchableOpacity onPress={() => router.back()} style={estilos.voltarBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Cores.texto} />
        </TouchableOpacity>
        <Text style={[estilos.headerTitulo, { color: Cores.texto }]}>Planos FinFlow</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={estilos.conteudo} showsVerticalScrollIndicator={false}>
        <View style={[estilos.card, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
          <View style={[estilos.icone, { backgroundColor: Cores.destaque + "1F" }]}>
            <MaterialIcons name="build" size={26} color={Cores.destaque} />
          </View>
          <Text style={[estilos.titulo, { color: Cores.texto }]}>Planos em manutenção</Text>
          <Text style={[estilos.texto, { color: Cores.secundario }]}>
            Estamos ajustando os planos do FinFlow. Enquanto isso, todos os recursos, incluindo a IA, continuam liberados sem custo para sua conta.
          </Text>
          <Text style={[estilos.texto, { color: Cores.secundario }]}>
            Nenhuma cobrança será feita durante esse período. Se você já tinha uma assinatura ativa, ela continua valendo normalmente.
          </Text>
        </View>
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
  conteudo: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  icone: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  titulo: { fontSize: 19, fontWeight: "900", textAlign: "center" },
  texto: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
