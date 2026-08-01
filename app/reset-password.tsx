import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Button from "../components/FinFlowButton";
import { FinFlowRadius, FinFlowShadow, finFlowTheme } from "../constants/finflow-design";
import { supabase } from "../lib/supabase";
import { lerFluxoRecuperacaoSenha, PASSWORD_RECOVERY_FLOW_KEY } from "../lib/auth-flow";
import { useAppTheme } from "./_layout";

type PasswordFieldProps = {
  theme: ReturnType<typeof finFlowTheme>;
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  icon: "lock-outline" | "verified-user";
  hasError?: boolean;
};

function ResetPasswordField({
  theme,
  label,
  placeholder,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
  icon,
  hasError = false,
}: PasswordFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: theme.surfaceMuted, borderColor: hasError ? "#EE6B63" : theme.border },
        ]}
      >
        <View style={[styles.inputIcon, { backgroundColor: theme.primarySoft }]}>
          <MaterialIcons name={icon} size={19} color={theme.primary} />
        </View>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          onChangeText={onChangeText}
          value={value}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TouchableOpacity
          onPress={onToggleVisibility}
          style={styles.eyeButton}
          accessibilityLabel={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          <MaterialIcons name={visible ? "visibility-off" : "visibility"} size={20} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ResetPasswordScreen() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarNova, setMostrarNova] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusFluxo, setStatusFluxo] = useState<"verificando" | "valido" | "invalido">("verificando");
  const concluiu = useRef(false);

  const confirmacaoPreenchida = confirmarSenha.length > 0;
  const senhasConferem = confirmacaoPreenchida && novaSenha === confirmarSenha;

  // Se o usuário sair da tela sem redefinir a senha, desconecta para evitar acesso indevido.
  useEffect(() => {
    return () => {
      if (!concluiu.current) {
        supabase.auth.signOut();
      }
    };
  }, []);

  async function fluxoRecuperacaoValido(): Promise<boolean> {
    const [raw, authResult] = await Promise.all([
      AsyncStorage.getItem(PASSWORD_RECOVERY_FLOW_KEY),
      supabase.auth.getUser(),
    ]);
    const fluxo = lerFluxoRecuperacaoSenha(raw);
    const userId = authResult.data.user?.id;
    const valido = !authResult.error
      && Boolean(userId)
      && fluxo !== null
      && fluxo.userId === userId
      && fluxo.expiresAt > Date.now();

    if (!valido) await AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
    return valido;
  }

  useEffect(() => {
    let ativo = true;
    void fluxoRecuperacaoValido().then((valido) => {
      if (ativo) setStatusFluxo(valido ? "valido" : "invalido");
    });
    return () => { ativo = false; };
  }, []);

  async function redefinirSenha() {
    if (!(await fluxoRecuperacaoValido())) {
      setStatusFluxo("invalido");
      return Alert.alert(
        "Link inválido ou expirado",
        "Solicite um novo link de recuperação para alterar sua senha.",
      );
    }
    if (!novaSenha || !confirmarSenha) {
      return Alert.alert("Aviso", "Preencha os dois campos.");
    }
    if (novaSenha.length < 6) {
      return Alert.alert("Senha fraca", "A senha deve ter pelo menos 6 caracteres.");
    }
    if (novaSenha !== confirmarSenha) {
      return Alert.alert("Senhas diferentes", "As senhas não conferem.");
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setLoading(false);

    if (error) {
      Alert.alert("Erro", error.message);
      return;
    }

    concluiu.current = true;
    await AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
    Alert.alert(
      "Senha redefinida!",
      "Sua senha foi atualizada com sucesso. Você já pode usar o app normalmente.",
      [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
    );
  }

  function voltarAoLogin() {
    supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, { backgroundColor: theme.header }]}>
            <View style={styles.heroDecorationLarge} />
            <View style={styles.heroDecorationSmall} />
            <View style={styles.heroIcon}>
              <MaterialIcons name="lock-reset" size={38} color={theme.primaryDark} />
            </View>
            <Text style={styles.eyebrow}>ACESSO SEGURO</Text>
            <Text style={styles.heroTitle}>Crie uma nova senha</Text>
            <Text style={styles.heroSubtitle}>Escolha uma senha segura e fácil de lembrar.</Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {statusFluxo === "verificando" ? (
              <View style={styles.flowState}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.flowStateTitle, { color: theme.text }]}>Validando link seguro</Text>
                <Text style={[styles.flowStateText, { color: theme.textMuted }]}>Aguarde um instante.</Text>
              </View>
            ) : statusFluxo === "invalido" ? (
              <View style={styles.flowState}>
                <View style={styles.invalidFlowIcon}>
                  <MaterialIcons name="link-off" size={34} color="#EE6B63" />
                </View>
                <Text style={[styles.flowStateTitle, { color: theme.text }]}>Link inválido ou expirado</Text>
                <Text style={[styles.flowStateText, { color: theme.textMuted }]}>Abra um novo link enviado pelo FinFlow para redefinir sua senha.</Text>
                <Button title="Voltar ao login" color={theme.primary} onPress={voltarAoLogin} style={styles.primaryButton} />
              </View>
            ) : (
              <>
            <View style={[styles.securityNote, { backgroundColor: theme.primarySoft, borderColor: `${theme.primary}35` }]}>
              <View style={[styles.securityNoteIcon, { backgroundColor: `${theme.primary}1F` }]}>
                <MaterialIcons name="shield" size={19} color={theme.primary} />
              </View>
              <View style={styles.securityNoteCopy}>
                <Text style={[styles.securityNoteTitle, { color: theme.text }]}>Proteja sua conta</Text>
                <Text style={[styles.securityNoteText, { color: theme.textMuted }]}>Use no mínimo 6 caracteres e não compartilhe sua senha.</Text>
              </View>
            </View>

            <ResetPasswordField
              theme={theme}
              label="Nova senha"
              placeholder="Digite sua nova senha"
              value={novaSenha}
              onChangeText={setNovaSenha}
              visible={mostrarNova}
              onToggleVisibility={() => setMostrarNova((value) => !value)}
              icon="lock-outline"
            />

            <ResetPasswordField
              theme={theme}
              label="Confirme a nova senha"
              placeholder="Digite a senha novamente"
              value={confirmarSenha}
              onChangeText={setConfirmarSenha}
              visible={mostrarConfirmar}
              onToggleVisibility={() => setMostrarConfirmar((value) => !value)}
              icon="verified-user"
              hasError={confirmacaoPreenchida && !senhasConferem}
            />

            {confirmacaoPreenchida && (
              <View
                style={[
                  styles.validationRow,
                  { backgroundColor: senhasConferem ? `${theme.primary}12` : "#EE6B6312" },
                ]}
              >
                <MaterialIcons
                  name={senhasConferem ? "check-circle" : "error-outline"}
                  size={17}
                  color={senhasConferem ? theme.primary : "#EE6B63"}
                />
                <Text style={[styles.validationText, { color: senhasConferem ? theme.primary : "#EE6B63" }]}>
                  {senhasConferem ? "As senhas conferem" : "As senhas não conferem"}
                </Text>
              </View>
            )}

            <Button
              title={loading ? "Aguarde..." : "Redefinir senha"}
              color={theme.primary}
              onPress={redefinirSenha}
              disabled={loading}
              style={styles.primaryButton}
            />

            <TouchableOpacity style={styles.backToLogin} onPress={voltarAoLogin} disabled={loading}>
              <MaterialIcons name="arrow-back" size={17} color={theme.textMuted} />
              <Text style={[styles.backToLoginText, { color: theme.textMuted }]}>Voltar ao login</Text>
            </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24 },
  hero: {
    position: "relative",
    overflow: "hidden",
    minHeight: 245,
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 58,
    borderRadius: 30,
    alignItems: "center",
  },
  heroDecorationLarge: {
    position: "absolute",
    width: 330,
    height: 145,
    right: -155,
    top: 38,
    borderRadius: 170,
    backgroundColor: "rgba(255,255,255,0.10)",
    transform: [{ rotate: "-12deg" }],
  },
  heroDecorationSmall: {
    position: "absolute",
    width: 260,
    height: 105,
    left: -138,
    bottom: 14,
    borderRadius: 140,
    backgroundColor: "rgba(2,60,51,0.14)",
    transform: [{ rotate: "10deg" }],
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
    backgroundColor: "rgba(255,255,255,0.93)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },
  eyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  heroTitle: { color: "#FFF", fontSize: 26, fontWeight: "900", letterSpacing: -0.4, marginTop: 5, textAlign: "center" },
  heroSubtitle: { color: "rgba(255,255,255,0.84)", fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: "center" },
  formCard: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    zIndex: 2,
    marginTop: -36,
    padding: 22,
    borderRadius: 26,
    borderWidth: 1,
    ...FinFlowShadow,
  },
  flowState: { width: "100%", alignItems: "center", paddingVertical: 16 },
  invalidFlowIcon: { width: 70, height: 70, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 2, backgroundColor: "#EE6B631A" },
  flowStateTitle: { fontSize: 19, lineHeight: 25, fontWeight: "900", textAlign: "center", marginTop: 14 },
  flowStateText: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7, marginBottom: 16 },
  securityNote: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: FinFlowRadius.medium, borderWidth: 1, marginBottom: 22 },
  securityNoteIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  securityNoteCopy: { flex: 1 },
  securityNoteTitle: { fontSize: 13, fontWeight: "800" },
  securityNoteText: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  fieldGroup: { marginBottom: 15 },
  fieldLabel: { fontSize: 12, fontWeight: "800", marginBottom: 7 },
  inputContainer: { minHeight: 56, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: FinFlowRadius.medium, paddingHorizontal: 8 },
  inputIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 54, paddingHorizontal: 11, fontSize: 15 },
  eyeButton: { width: 42, height: 50, alignItems: "center", justifyContent: "center" },
  validationRow: { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", borderRadius: FinFlowRadius.pill, paddingHorizontal: 10, paddingVertical: 6, marginTop: -3, marginBottom: 14 },
  validationText: { fontSize: 11, fontWeight: "800" },
  primaryButton: { width: "100%", minHeight: 52, borderRadius: FinFlowRadius.medium, marginTop: 2 },
  backToLogin: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 9 },
  backToLoginText: { fontSize: 12, fontWeight: "700" },
});
