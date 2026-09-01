import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FinFlowShadow, finFlowTheme } from "../constants/finflow-design";
import { PENDING_EMAIL_CONFIRMATION_KEY } from "../lib/auth-flow";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "./_layout";

export default function EmailConfirmedScreen() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const [status, setStatus] = useState<"verificando" | "confirmado" | "invalido">("verificando");

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!ativo) return;
      if (error || !data.user?.email_confirmed_at) {
        setStatus("invalido");
        return;
      }

      await AsyncStorage.removeItem(PENDING_EMAIL_CONFIRMATION_KEY);
      if (!ativo) return;
      setStatus("confirmado");
      timer = setTimeout(() => router.replace("/(tabs)"), 5000);
    });

    return () => {
      ativo = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.header }]} pointerEvents="none">
        <View style={styles.headerGlow} />
        <MaterialIcons name="verified" size={28} color="#D9FFF0" />
        <Text style={styles.headerText}>Conta FinFlow</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {status === "verificando" ? (
            <>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.title, { color: theme.text, marginTop: 18 }]}>Validando confirmação</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Aguarde enquanto conferimos seu link seguro.</Text>
            </>
          ) : status === "confirmado" ? (
            <>
              <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}>
                <MaterialIcons name="mark-email-read" size={42} color={theme.primary} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>E-mail confirmado!</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Sua conta foi verificada com sucesso e já está pronta para usar.</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => router.replace("/(tabs)")} activeOpacity={0.84}>
                <Text style={styles.buttonText}>Continuar no FinFlow</Text>
                <MaterialIcons name="arrow-forward" size={19} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.timerText, { color: theme.textMuted }]}>Você será redirecionado automaticamente.</Text>
            </>
          ) : (
            <>
              <View style={[styles.iconWrap, { backgroundColor: "#C0392E1A" }]}>
                <MaterialIcons name="link-off" size={42} color="#C0392E" />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Link inválido ou expirado</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Volte ao login e solicite um novo envio da confirmação.</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => router.replace("/login")} activeOpacity={0.84}>
                <Text style={styles.buttonText}>Voltar ao login</Text>
                <MaterialIcons name="arrow-forward" size={19} color="#FFF" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 150, paddingHorizontal: 22, paddingTop: 20, alignItems: "center", justifyContent: "center", overflow: "hidden", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerGlow: { position: "absolute", width: 250, height: 130, right: -70, bottom: -55, borderRadius: 140, backgroundColor: "rgba(217,255,240,0.12)", transform: [{ rotate: "-12deg" }] },
  headerText: { color: "#FFF", fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 7 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 18, paddingBottom: 36 },
  card: { width: "100%", maxWidth: 440, alignSelf: "center", alignItems: "center", borderRadius: 24, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 30, ...FinFlowShadow },
  iconWrap: { width: 76, height: 76, borderRadius: 25, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  subtitle: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, marginBottom: 24 },
  button: { width: "100%", minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16 },
  buttonText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  timerText: { fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 12 },
});
