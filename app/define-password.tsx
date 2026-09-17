import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Button from "../components/FinFlowButton";
import { finFlowTheme } from "../constants/finflow-design";
import { PASSWORD_REQUIREMENTS_MESSAGE, validatePassword } from "../lib/password";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "./_layout";

export default function DefinePasswordScreen() {
  const { isDark } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function savePassword() {
    if (!validatePassword(password).valid) return Alert.alert("Senha fraca", PASSWORD_REQUIREMENTS_MESSAGE);
    if (password !== confirmation) return Alert.alert("Senhas diferentes", "Digite a mesma senha nos dois campos.");
    setLoading(true);
    const userResult = await supabase.auth.getUser();
    const metadata = userResult.data.user?.user_metadata ?? {};
    const { error } = await supabase.auth.updateUser({
      password,
      data: { ...metadata, senha_definida: true },
    });
    setLoading(false);
    if (error) return Alert.alert("Não foi possível definir a senha", "Tente novamente em instantes.");
    router.replace("/(tabs)");
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
            <MaterialIcons name="password" size={34} color={theme.primary} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Defina sua senha</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>Seu acesso pelo Google já está confirmado. Crie também uma senha para recuperar e acessar sua conta com segurança.</Text>
          <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry={!visible} placeholder="Nova senha" placeholderTextColor={theme.textMuted} style={[styles.input, { color: theme.text }]} autoCapitalize="none" autoComplete="new-password" />
            <TouchableOpacity onPress={() => setVisible((value) => !value)} accessibilityLabel={visible ? "Ocultar senha" : "Mostrar senha"} style={styles.eye}>
              <MaterialIcons name={visible ? "visibility-off" : "visibility"} size={22} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
          <TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry={!visible} placeholder="Confirme a senha" placeholderTextColor={theme.textMuted} style={[styles.inputSingle, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceMuted }]} autoCapitalize="none" autoComplete="new-password" />
          <Text style={[styles.requirements, { color: theme.textMuted }]}>{PASSWORD_REQUIREMENTS_MESSAGE}</Text>
          <Button title={loading ? "Salvando..." : "Criar senha e continuar"} onPress={() => void savePassword()} disabled={loading} color={theme.primary} style={styles.button} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, justifyContent: "center", padding: 24 },
  card: { borderWidth: 1, borderRadius: 24, padding: 24 },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { fontSize: 27, fontWeight: "900", marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 22 },
  inputRow: { minHeight: 54, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", marginBottom: 12 },
  input: { flex: 1, minHeight: 52, paddingHorizontal: 16, fontSize: 16 },
  eye: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  inputSingle: { minHeight: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 16 },
  requirements: { fontSize: 12, lineHeight: 18, marginTop: 10, marginBottom: 20 },
  button: { minHeight: 52 },
});
