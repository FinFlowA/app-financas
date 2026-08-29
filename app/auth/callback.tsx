import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FinFlowShadow, finFlowTheme } from "../../constants/finflow-design";
import { finalizarLoginOAuth, PENDING_EMAIL_CONFIRMATION_KEY } from "../../lib/auth-flow";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";

/**
 * Retorno do login com Google quando o sistema entrega a URL como navegação
 * comum, em vez de ser interceptada por WebBrowser.openAuthSessionAsync em
 * signInWithGoogle (app/login.tsx). Sem esta tela, esse retorno cai como rota
 * não encontrada.
 */
export default function AuthCallbackScreen() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const [status, setStatus] = useState<"verificando" | "idade_invalida" | "erro">("verificando");

  useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const codigo = typeof params.code === "string" ? params.code : null;
        if (params.error || !codigo) {
          if (ativo) setStatus("erro");
          return;
        }

        const troca = await supabase.auth.exchangeCodeForSession(codigo);
        if (troca.error) {
          const sessaoExistente = await supabase.auth.getSession();
          if (!sessaoExistente.data.session) {
            if (ativo) setStatus("erro");
            return;
          }
        }

        const resultado = await finalizarLoginOAuth(supabase);
        if (!ativo) return;
        if (resultado.status === "idade_invalida") {
          setStatus("idade_invalida");
          return;
        }
        if (resultado.status === "erro") {
          setStatus("erro");
          return;
        }

        await AsyncStorage.removeItem(PENDING_EMAIL_CONFIRMATION_KEY);
        router.replace("/(tabs)");
      } catch (error) {
        if (__DEV__) console.error("Falha ao concluir login com Google (fallback)", error);
        if (ativo) setStatus("erro");
      }
    })();

    return () => {
      ativo = false;
    };
  }, [params.code, params.error]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.header }]} pointerEvents="none">
        <View style={styles.headerGlow} />
        <MaterialIcons name="verified-user" size={28} color="#D9FFF0" />
        <Text style={styles.headerText}>Conta FinFlow</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {status === "verificando" ? (
            <>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.title, { color: theme.text, marginTop: 18 }]}>Concluindo login com Google</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Aguarde um instante.</Text>
            </>
          ) : status === "idade_invalida" ? (
            <>
              <View style={[styles.iconWrap, { backgroundColor: "#EE6B631A" }]}>
                <MaterialIcons name="block" size={42} color="#EE6B63" />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Acesso não permitido</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>O FinFlow é destinado somente a pessoas com 18 anos ou mais.</Text>
              <TouchableOpacity style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => router.replace("/login")} activeOpacity={0.84}>
                <Text style={styles.buttonText}>Voltar ao login</Text>
                <MaterialIcons name="arrow-forward" size={19} color="#FFF" />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[styles.iconWrap, { backgroundColor: "#EE6B631A" }]}>
                <MaterialIcons name="link-off" size={42} color="#EE6B63" />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Não foi possível entrar com Google</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>Confira a conta escolhida e tente novamente. Você também pode entrar com e-mail e senha.</Text>
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
});
