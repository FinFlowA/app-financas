import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useAppTheme } from "../_layout"; // Puxando nossa memória global!

export default function TabLayout() {
  const { isDark } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2A9D8F",
        tabBarInactiveTintColor: isDark ? "#666" : "#999",
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? "#1E1E1E" : "#F8FAFC",
          borderTopWidth: 1,
          borderColor: isDark ? "#333" : "#CBD5E1",
          elevation: 5,
          minHeight: Platform.OS === "android" ? 70 : 85,
          paddingBottom: Platform.OS === "android" ? 15 : 25,
          paddingTop: 10,
        },
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
