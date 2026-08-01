import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { finFlowTheme, FinFlowColors } from "../../constants/finflow-design";
import { useAppTheme } from "../_layout"; // Puxando nossa memória global!

export default function TabLayout() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: FinFlowColors.primary,
        tabBarInactiveTintColor: theme.textMuted,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopWidth: 1,
          borderColor: theme.border,
          elevation: 12,
          minHeight: Platform.OS === "android" ? 70 : 85,
          paddingBottom: Platform.OS === "android" ? 15 : 25,
          paddingTop: 10,
          position: "absolute",
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="home" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transacoes"
        options={{
          title: "Histórico",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="receipt-long" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="caixinhas"
        options={{
          title: "Objetivos",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="savings" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="relatorios"
        options={{
          title: "Fluxo",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="account-balance" size={26} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="configuracoes"
        options={{
          title: "Ajustes",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="settings" size={26} color={color} />
          ),
        }}
      />

      {/* Cartões: visível nas tabs */}
      <Tabs.Screen
        name="cartoes"
        options={{
          title: "Cartões",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="credit-card" size={26} color={color} />
          ),
          href: null, // Acessado via botão na home — oculto nas tabs para não sobrecarregar
        }}
      />

      {/* Telas ocultas das tabs */}
      <Tabs.Screen name="ranking" options={{ href: null }} />
    </Tabs>
  );
}
