import { MaterialIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { finFlowTheme } from "../constants/finflow-design";
import { MFA_SUPPORT_EMAIL, totpErrorMessage, verifyTotpCode } from "../lib/mfa";
import { limparNotificacoesAoSair } from "../lib/notifications";
import { supabase } from "../lib/supabase";

/**
 * Segunda etapa do login para quem ativou a verificação em duas etapas.
 * O _layout mostra esta tela no lugar do app enquanto a sessão não tiver o
 * código; ao confirmar, o Supabase emite MFA_CHALLENGE_VERIFIED e o app libera.
 */
export default function MfaChallengeScreen({ isDark, userId }: { isDark: boolean; userId?: string | null }) {
  const theme = finFlowTheme(isDark);
  const [codigo, setCodigo] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmar() {
    if (verificando) return;
    setVerificando(true);
    setErro("");
    const resultado = await verifyTotpCode(supabase, codigo);
    if (resultado !== "ok") {
      setErro(totpErrorMessage(resultado));
      setCodigo("");
    }
    setVerificando(false);
  }

  async function sair() {
    await limparNotificacoesAoSair(userId ?? null);
    await supabase.auth.signOut({ scope: "local" });
  }

  function falarComSuporte() {
    const assunto = encodeURIComponent("[FinFlow - Verificação em duas etapas]");
    void Linking.openURL(`mailto:${MFA_SUPPORT_EMAIL}?subject=${assunto}`);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.tela, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={[styles.cartao, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <View style={[styles.icone, { backgroundColor: theme.primary }]}>
          <MaterialIcons name="phonelink-lock" size={34} color="#FFF" />
        </View>
        <Text style={[styles.titulo, { color: theme.text }]}>Verificação em duas etapas</Text>
        <Text style={[styles.descricao, { color: theme.textMuted }]}>
          Abra o app autenticador (Google Authenticator, Microsoft Authenticator…) e digite o código de 6 dígitos do FinFlow.
        </Text>

        <TextInput
          value={codigo}
          onChangeText={(texto) => setCodigo(texto.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          placeholder="000000"
          placeholderTextColor={theme.textMuted}
          onSubmitEditing={() => void confirmar()}
          accessibilityLabel="Código de 6 dígitos"
          style={[styles.campo, { color: theme.text, borderColor: erro ? "#E76F51" : theme.border, backgroundColor: theme.surface }]}
        />

        {!!erro && (
          <View style={styles.erro}>
            <MaterialIcons name="error-outline" size={18} color="#E76F51" />
            <Text style={styles.erroTexto}>{erro}</Text>
          </View>
        )}

        <TouchableOpacity
          disabled={verificando || codigo.length !== 6}
          onPress={() => void confirmar()}
          style={[styles.botao, { backgroundColor: theme.primary, opacity: verificando || codigo.length !== 6 ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          {verificando ? <ActivityIndicator size="small" color="#FFF" /> : <MaterialIcons name="verified-user" size={20} color="#FFF" />}
          <Text style={styles.botaoTexto}>{verificando ? "Verificando..." : "Confirmar e entrar"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => void sair()} style={styles.link} accessibilityRole="button">
          <Text style={[styles.linkTexto, { color: theme.textMuted }]}>Entrar com outra conta</Text>
        </TouchableOpacity>

        <Text style={[styles.ajuda, { color: theme.textMuted }]}>
          Perdeu o celular com o autenticador?{" "}
          <Text style={{ color: theme.primary, fontWeight: "800" }} onPress={falarComSuporte}>Fale com o suporte</Text>
          {" "}para confirmar sua identidade e recuperar o acesso.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, justifyContent: "center", padding: 22 },
  cartao: { borderWidth: 1, borderRadius: 24, padding: 24, alignItems: "center" },
  icone: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  titulo: { marginTop: 16, fontSize: 21, fontWeight: "900", textAlign: "center" },
  descricao: { marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: "center" },
  campo: {
    marginTop: 20,
    alignSelf: "stretch",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 10,
    textAlign: "center",
  },
  erro: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch" },
  erroTexto: { flex: 1, color: "#E76F51", fontSize: 13, fontWeight: "700" },
  botao: {
    marginTop: 16,
    alignSelf: "stretch",
    minHeight: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  botaoTexto: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  link: { marginTop: 14, paddingVertical: 6, paddingHorizontal: 10 },
  linkTexto: { fontSize: 14, fontWeight: "700" },
  ajuda: { marginTop: 10, fontSize: 12, lineHeight: 18, textAlign: "center" },
});
