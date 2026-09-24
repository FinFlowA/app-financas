import { MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { finFlowTheme, FinFlowColors } from "../../constants/finflow-design";
import { useAppTheme } from "../_layout"; // Puxando nossa memória global!

const VISIBLE_TABS = [
  { name: "index", label: "Início", icon: "home" },
  { name: "transacoes", label: "Histórico", icon: "receipt-long" },
  { name: "caixinhas", label: "Objetivos", icon: "savings" },
  { name: "relatorios", label: "Fluxo", icon: "account-balance" },
  { name: "configuracoes", label: "Ajustes", icon: "settings" },
] as const;

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 14);
  const [barWidth, setBarWidth] = useState(0);
  const activeRouteName = state.routes[state.index]?.name;
  const foundIndex = VISIBLE_TABS.findIndex((tab) => tab.name === activeRouteName);
  const nextIndex = foundIndex >= 0 ? foundIndex : 0;
  const indicatorPosition = useRef(new Animated.Value(nextIndex)).current;

  useEffect(() => {
    Animated.spring(indicatorPosition, {
      toValue: nextIndex,
      stiffness: 230,
      damping: 24,
      mass: 0.82,
      overshootClamping: false,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.01,
      useNativeDriver: true,
    }).start();
  }, [indicatorPosition, nextIndex]);

  const innerBarWidth = Math.max(0, barWidth - 2);
  const itemWidth = innerBarWidth > 0 ? innerBarWidth / VISIBLE_TABS.length : 0;
  const indicatorTranslate = Animated.multiply(indicatorPosition, itemWidth);

  return (
    <View
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      style={[styles.floatingBar, { height: 64 + bottomInset, paddingBottom: bottomInset, backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      {barWidth > 0 && (
        <Animated.View pointerEvents="none" style={[styles.slidingIndicator, { left: 1 + (itemWidth - 50) / 2, transform: [{ translateX: indicatorTranslate }] }]} />
      )}
      {VISIBLE_TABS.map((tab) => {
        const route = state.routes.find((candidate) => candidate.name === tab.name);
        if (!route) return null;
        const focused = activeRouteName === tab.name;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <TouchableOpacity
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            activeOpacity={0.72}
            style={styles.customTabItem}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
          >
            <View style={[styles.iconShell, focused && styles.iconShellFocused]}>
              <MaterialIcons name={tab.icon} size={focused ? 28 : 25} color={focused ? "#FFF" : theme.textMuted} />
            </View>
            <Text style={[styles.customTabLabel, { color: focused ? theme.text : theme.textMuted }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 14);
  const tabBarHeight = 64 + bottomInset;

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textMuted,
        headerShown: false,
        animation: "shift",
        transitionSpec: {
          animation: "timing",
          config: {
            duration: 220,
            easing: Easing.out(Easing.cubic),
          },
        },
        // As abas são telas extensas. Congelar as inativas impede que um
        // clique na aba atual recalcule também todas as telas já visitadas.
        freezeOnBlur: true,
        lazy: true,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 32,
          elevation: 18,
          height: tabBarHeight,
          marginHorizontal: 12,
          marginBottom: 0,
          paddingBottom: bottomInset,
          paddingTop: 7,
          position: "absolute",
          overflow: "visible",
          shadowColor: "#001E1A",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.22,
          shadowRadius: 18,
        },
        tabBarItemStyle: {
          minHeight: 54,
          overflow: "visible",
        },
        tabBarIconStyle: { height: 32, overflow: "visible" },
        tabBarLabelStyle: { fontSize: 10, lineHeight: 12, fontWeight: "700", marginBottom: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
        }}
      />
      <Tabs.Screen
        name="transacoes"
        options={{
          title: "Histórico",
        }}
      />
      <Tabs.Screen
        name="caixinhas"
        options={{
          title: "Objetivos",
        }}
      />
      <Tabs.Screen
        name="relatorios"
        options={{
          title: "Fluxo",
        }}
      />

      <Tabs.Screen
        name="configuracoes"
        options={{
          title: "Ajustes",
        }}
      />

      {/* Cartões: visível nas tabs */}
      <Tabs.Screen
        name="cartoes"
        options={{
          title: "Cartões",
          href: null, // Acessado via botão na home — oculto nas tabs para não sobrecarregar
        }}
      />

      {/* Telas ocultas das tabs */}
      <Tabs.Screen name="ranking" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  floatingBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 0,
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 32,
    paddingTop: 7,
    overflow: "visible",
    elevation: 18,
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  slidingIndicator: {
    position: "absolute",
    top: -4,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: FinFlowColors.primary,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.92)",
    elevation: 10,
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  customTabItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "flex-start",
    position: "relative",
  },
  iconShell: {
    width: 42,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
  },
  iconShellFocused: {
    transform: [{ translateY: -4 }],
  },
  customTabLabel: {
    position: "absolute",
    top: 47,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  iconShellActive: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: FinFlowColors.primary,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.92)",
    transform: [{ translateY: -11 }],
    elevation: 10,
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
});
