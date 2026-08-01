import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
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
import {
  FinFlowColors,
  FinFlowRadius,
  FinFlowShadow,
  finFlowTheme,
} from "../constants/finflow-design";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "./_layout";

const SECURITY_WINDOW_MS = 5 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PasswordFieldProps = {
  theme: ReturnType<typeof finFlowTheme>;
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  autoComplete: "current-password" | "new-password";
  textContentType: "password" | "newPassword";
  onSubmitEditing?: () => void;
};

function formatPhoneForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  const localDigits = digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;

  if (localDigits.length === 11) {
    return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 7)}-${localDigits.slice(7)}`;
  }
  if (localDigits.length === 10) {
    return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 6)}-${localDigits.slice(6)}`;
  }
  return value || "Não informado";
}

function emailErrorMessage(code?: string): { title: string; message: string } {
  if (code === "email_exists" || code === "user_already_exists") {
    return {
      title: "E-mail já cadastrado",
      message: "Já existe uma conta com este e-mail. Use outro endereço ou acesse a conta já cadastrada.",
    };
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return {
      title: "Aguarde um pouco",
      message: "Muitas solicitações foram feitas. Espere alguns minutos e tente novamente.",
    };
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return {
      title: "E-mail inválido",
      message: "Confira o endereço informado e tente novamente.",
    };
  }
  return {
    title: "Não foi possível alterar",
    message: "Não conseguimos iniciar a troca do e-mail agora. Tente novamente em instantes.",
  };
}

function SecurityPasswordField({
  theme,
  label,
  placeholder,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
  autoComplete,
  textContentType,
  onSubmitEditing,
}: PasswordFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <View style={[styles.inputShell, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <View style={[styles.inputIcon, { backgroundColor: theme.primarySoft }]}>
          <MaterialIcons name="lock-outline" size={19} color={theme.primary} />
        </View>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={onSubmitEditing ? "done" : "next"}
          onSubmitEditing={onSubmitEditing}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={onToggleVisibility}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          <MaterialIcons name={visible ? "visibility-off" : "visibility"} size={20} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SegurancaScreen() {
  const router = useRouter();
  const { isDark, session } = useAppTheme();
  const theme = finFlowTheme(isDark);

  const currentEmail = session?.user?.email?.trim() ?? "";
  const metadataPhone = typeof session?.user?.user_metadata?.telefone === "string"
    ? session.user.user_metadata.telefone.trim()
    : "";
  const authPhone = session?.user?.phone?.trim() ?? "";
  const currentPhone = authPhone || metadataPhone;
  const phoneIsVerified = Boolean(authPhone && session?.user?.phone_confirmed_at);
  const initialPendingEmail = (session?.user as { new_email?: string } | undefined)?.new_email ?? "";

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState(initialPendingEmail);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const securityDeadlineRef = useRef(0);
  const securityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockSecurity = useCallback(() => {
    if (securityTimerRef.current) {
      clearTimeout(securityTimerRef.current);
      securityTimerRef.current = null;
    }
    securityDeadlineRef.current = 0;
    setIsUnlocked(false);
    setCurrentPassword("");
    setShowCurrentPassword(false);
    setNewEmail("");
    setNewPassword("");
    setConfirmPassword("");
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;

    securityDeadlineRef.current = Date.now() + SECURITY_WINDOW_MS;
    securityTimerRef.current = setTimeout(lockSecurity, SECURITY_WINDOW_MS);

    return () => {
      if (securityTimerRef.current) {
        clearTimeout(securityTimerRef.current);
        securityTimerRef.current = null;
      }
    };
  }, [isUnlocked, lockSecurity]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        lockSecurity();
        return;
      }
      if (securityDeadlineRef.current > 0 && Date.now() >= securityDeadlineRef.current) {
        lockSecurity();
      }
    });

    return () => subscription.remove();
  }, [lockSecurity]);

  useEffect(() => {
    return () => {
      if (securityTimerRef.current) clearTimeout(securityTimerRef.current);
    };
  }, []);

  function hasValidSecurityWindow(): boolean {
    if (!isUnlocked || Date.now() >= securityDeadlineRef.current) {
      lockSecurity();
      Alert.alert("Acesso expirado", "Digite sua senha atual novamente para continuar.");
      return false;
    }
    return true;
  }

  async function unlockSecurity() {
    if (!currentEmail) {
      Alert.alert("Sessão inválida", "Entre novamente na sua conta para acessar esta área.");
      return;
    }
    if (!currentPassword) {
      Alert.alert("Senha necessária", "Digite sua senha atual para continuar.");
      return;
    }

    setIsCheckingPassword(true);
    const expectedUserId = session?.user?.id;
    const { data, error } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    setIsCheckingPassword(false);

    if (error) {
      setCurrentPassword("");
      const tooManyAttempts = error.code === "over_request_rate_limit";
      Alert.alert(
        tooManyAttempts ? "Muitas tentativas" : "Senha incorreta",
        tooManyAttempts
          ? "Aguarde alguns minutos antes de tentar novamente."
          : "A senha atual não confere. Tente novamente ou use “Esqueci minha senha”.",
      );
      return;
    }

    if (!data.user || data.user.id !== expectedUserId) {
      lockSecurity();
      Alert.alert("Não foi possível validar", "Entre novamente na sua conta e tente outra vez.");
      return;
    }

    setCurrentPassword("");
    setIsUnlocked(true);
  }

  async function sendPasswordReset() {
    if (!currentEmail || isSendingReset) return;

    setIsSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(currentEmail, {
      redirectTo: "meuappfinancas://reset-password",
    });
    setIsSendingReset(false);

    if (error) {
      const isRateLimited = error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit";
      Alert.alert(
        isRateLimited ? "Aguarde um pouco" : "Não foi possível enviar",
        isRateLimited
          ? "Um link já foi solicitado recentemente. Aguarde alguns minutos e tente novamente."
          : "Não conseguimos enviar o link agora. Verifique sua conexão e tente novamente.",
      );
      return;
    }

    Alert.alert(
      "Link enviado",
      `Enviamos as instruções para ${currentEmail}. Verifique também a caixa de spam.`,
    );
  }

  async function updateEmail() {
    if (!hasValidSecurityWindow() || isUpdatingEmail) return;

    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      Alert.alert("E-mail inválido", "Digite um endereço de e-mail válido.");
      return;
    }
    if (normalizedEmail === currentEmail.toLowerCase()) {
      Alert.alert("Nada para alterar", "Este já é o e-mail da sua conta.");
      return;
    }

    setIsUpdatingEmail(true);
    const { data, error } = await supabase.auth.updateUser(
      { email: normalizedEmail },
      { emailRedirectTo: "meuappfinancas://email-confirmed" },
    );
    setIsUpdatingEmail(false);

    if (error) {
      const feedback = emailErrorMessage(error.code);
      Alert.alert(feedback.title, feedback.message);
      return;
    }

    const emailAwaitingConfirmation = (data.user as { new_email?: string } | null)?.new_email || normalizedEmail;
    setPendingEmail(emailAwaitingConfirmation);
    setNewEmail("");
    Alert.alert(
      "Confirme o novo e-mail",
      `Enviamos um link para ${emailAwaitingConfirmation}. O e-mail atual continuará válido até a confirmação. Verifique também a caixa de spam.`,
    );
  }

  async function updatePassword() {
    if (!hasValidSecurityWindow() || isUpdatingPassword) return;

    if (newPassword.length < 6) {
      Alert.alert("Senha fraca", "A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Senhas diferentes", "A nova senha e a confirmação não conferem.");
      return;
    }

    setIsUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsUpdatingPassword(false);

    if (error) {
      if (error.code === "same_password") {
        Alert.alert("Escolha outra senha", "A nova senha precisa ser diferente da senha atual.");
      } else if (error.code === "weak_password") {
        Alert.alert("Senha fraca", "Escolha uma senha mais forte e tente novamente.");
      } else if (error.code === "reauthentication_needed" || error.code === "session_expired") {
        lockSecurity();
        Alert.alert("Validação necessária", "Digite sua senha atual novamente para continuar.");
      } else {
        Alert.alert("Não foi possível alterar", "Tente novamente em instantes.");
      }
      return;
    }

    lockSecurity();
    Alert.alert(
      "Senha alterada",
      "Sua senha foi atualizada com sucesso. Para outras alterações, valide novamente a senha atual.",
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: theme.surface }]}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Segurança</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textMuted }]}>Dados de acesso</Text>
          </View>
          <View style={[styles.headerShield, { backgroundColor: theme.primarySoft }]}>
            <MaterialIcons name="shield" size={21} color={theme.primary} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!isUnlocked ? (
            <>
              <View style={[styles.hero, { backgroundColor: theme.header }]}>
                <View style={styles.heroDecorationLarge} />
                <View style={styles.heroDecorationSmall} />
                <View style={styles.heroIcon}>
                  <MaterialIcons name="password" size={37} color={theme.primaryDark} />
                </View>
                <Text style={styles.heroEyebrow}>ÁREA PROTEGIDA</Text>
                <Text style={styles.heroTitle}>Confirme que é você</Text>
                <Text style={styles.heroSubtitle}>A senha atual é obrigatória. A biometria não libera esta área.</Text>
              </View>

              <View style={[styles.card, styles.unlockCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.accountPill, { backgroundColor: theme.primarySoft }]}>
                  <MaterialIcons name="alternate-email" size={18} color={theme.primary} />
                  <Text style={[styles.accountPillText, { color: theme.text }]} numberOfLines={1}>{currentEmail}</Text>
                </View>

                <SecurityPasswordField
                  theme={theme}
                  label="Senha atual"
                  placeholder="Digite sua senha atual"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  visible={showCurrentPassword}
                  onToggleVisibility={() => setShowCurrentPassword((value) => !value)}
                  autoComplete="current-password"
                  textContentType="password"
                  onSubmitEditing={() => void unlockSecurity()}
                />

                <Button
                  title={isCheckingPassword ? "Validando..." : "Acessar segurança"}
                  color={theme.primary}
                  disabled={isCheckingPassword || !currentPassword}
                  onPress={() => void unlockSecurity()}
                  style={styles.fullButton}
                />

                <TouchableOpacity
                  style={styles.forgotButton}
                  onPress={() => void sendPasswordReset()}
                  disabled={isSendingReset}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="help-outline" size={18} color={theme.primary} />
                  <Text style={[styles.forgotButtonText, { color: theme.primary }]}>
                    {isSendingReset ? "Enviando link..." : "Esqueci minha senha"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.validatedBanner, { backgroundColor: theme.primarySoft, borderColor: `${theme.primary}45` }]}>
                <View style={[styles.validatedIcon, { backgroundColor: `${theme.primary}1F` }]}>
                  <MaterialIcons name="verified-user" size={22} color={theme.primary} />
                </View>
                <View style={styles.validatedCopy}>
                  <Text style={[styles.validatedTitle, { color: theme.text }]}>Identidade confirmada</Text>
                  <Text style={[styles.validatedText, { color: theme.textMuted }]}>Este acesso expira em 5 minutos ou ao sair do app.</Text>
                </View>
                <TouchableOpacity onPress={lockSecurity} style={styles.lockNowButton} accessibilityLabel="Bloquear agora">
                  <MaterialIcons name="lock" size={19} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>DADOS ATUAIS</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.dataRow, { borderBottomColor: theme.border }]}>
                  <View style={[styles.dataIcon, { backgroundColor: theme.primarySoft }]}>
                    <MaterialIcons name="email" size={19} color={theme.primary} />
                  </View>
                  <View style={styles.dataCopy}>
                    <Text style={[styles.dataLabel, { color: theme.textMuted }]}>E-mail</Text>
                    <Text style={[styles.dataValue, { color: theme.text }]} numberOfLines={1}>{currentEmail}</Text>
                    <Text style={[styles.dataStatus, { color: theme.primary }]}>Confirmado</Text>
                  </View>
                </View>
                <View style={styles.dataRowLast}>
                  <View style={[styles.dataIcon, { backgroundColor: `${FinFlowColors.blue}16` }]}>
                    <MaterialIcons name="phone-android" size={19} color={FinFlowColors.blue} />
                  </View>
                  <View style={styles.dataCopy}>
                    <Text style={[styles.dataLabel, { color: theme.textMuted }]}>Telefone</Text>
                    <Text style={[styles.dataValue, { color: theme.text }]}>{formatPhoneForDisplay(currentPhone)}</Text>
                    <Text style={[styles.dataStatus, { color: phoneIsVerified ? theme.primary : FinFlowColors.orange }]}>
                      {phoneIsVerified ? "Verificado por SMS" : "Ainda não verificado"}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>ALTERAR E-MAIL</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Novo e-mail</Text>
                <Text style={[styles.cardDescription, { color: theme.textMuted }]}>A mudança só será concluída depois que você abrir o link de confirmação.</Text>

                {pendingEmail ? (
                  <View style={[styles.pendingNotice, { backgroundColor: `${FinFlowColors.orange}12`, borderColor: `${FinFlowColors.orange}45` }]}>
                    <MaterialIcons name="mark-email-unread" size={19} color={FinFlowColors.orange} />
                    <View style={styles.pendingCopy}>
                      <Text style={[styles.pendingTitle, { color: theme.text }]}>Confirmação pendente</Text>
                      <Text style={[styles.pendingText, { color: theme.textMuted }]} numberOfLines={2}>{pendingEmail}</Text>
                    </View>
                  </View>
                ) : null}

                <View style={[styles.inputShell, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                  <View style={[styles.inputIcon, { backgroundColor: theme.primarySoft }]}>
                    <MaterialIcons name="alternate-email" size={19} color={theme.primary} />
                  </View>
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    placeholder="novoemail@exemplo.com"
                    placeholderTextColor={theme.textMuted}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    keyboardType="email-address"
                    returnKeyType="send"
                    onSubmitEditing={() => void updateEmail()}
                  />
                </View>

                <Button
                  title={isUpdatingEmail ? "Enviando..." : "Alterar e-mail"}
                  color={theme.primary}
                  disabled={isUpdatingEmail || !newEmail.trim()}
                  onPress={() => void updateEmail()}
                  style={styles.fullButton}
                />
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>TELEFONE</Text>
              <View style={[styles.card, styles.disabledCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.disabledIcon, { backgroundColor: `${FinFlowColors.orange}16` }]}>
                  <MaterialIcons name="sms-failed" size={24} color={FinFlowColors.orange} />
                </View>
                <View style={styles.disabledCopy}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>Alteração temporariamente indisponível</Text>
                  <Text style={[styles.cardDescription, styles.disabledDescription, { color: theme.textMuted }]}>
                    O envio de SMS ainda não está configurado. Seu telefone não será alterado sem a confirmação por código.
                  </Text>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>ALTERAR SENHA</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Crie uma nova senha</Text>
                <Text style={[styles.cardDescription, { color: theme.textMuted }]}>Use pelo menos 6 caracteres e evite reutilizar senhas de outros serviços.</Text>

                <SecurityPasswordField
                  theme={theme}
                  label="Nova senha"
                  placeholder="Digite a nova senha"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  visible={showNewPassword}
                  onToggleVisibility={() => setShowNewPassword((value) => !value)}
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
                <SecurityPasswordField
                  theme={theme}
                  label="Confirme a nova senha"
                  placeholder="Digite novamente"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  visible={showConfirmPassword}
                  onToggleVisibility={() => setShowConfirmPassword((value) => !value)}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  onSubmitEditing={() => void updatePassword()}
                />

                {confirmPassword ? (
                  <View style={[styles.passwordMatch, { backgroundColor: newPassword === confirmPassword ? `${theme.primary}12` : `${FinFlowColors.red}12` }]}>
                    <MaterialIcons
                      name={newPassword === confirmPassword ? "check-circle" : "error-outline"}
                      size={17}
                      color={newPassword === confirmPassword ? theme.primary : FinFlowColors.red}
                    />
                    <Text style={[styles.passwordMatchText, { color: newPassword === confirmPassword ? theme.primary : FinFlowColors.red }]}>
                      {newPassword === confirmPassword ? "As senhas conferem" : "As senhas não conferem"}
                    </Text>
                  </View>
                ) : null}

                <Button
                  title={isUpdatingPassword ? "Alterando..." : "Alterar senha"}
                  color={FinFlowColors.blue}
                  disabled={isUpdatingPassword || !newPassword || !confirmPassword}
                  onPress={() => void updatePassword()}
                  style={styles.fullButton}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    ...FinFlowShadow,
  },
  headerCopy: { flex: 1, marginLeft: 13 },
  headerTitle: { fontSize: 19, fontWeight: "900" },
  headerSubtitle: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  headerShield: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { flexGrow: 1, width: "100%", maxWidth: 620, alignSelf: "center", padding: 16, paddingBottom: 40 },
  hero: {
    minHeight: 250,
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 58,
    borderRadius: 30,
    alignItems: "center",
    overflow: "hidden",
    position: "relative",
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
    borderColor: "rgba(255,255,255,0.65)",
  },
  heroEyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: "900", letterSpacing: 1.8, marginBottom: 7 },
  heroTitle: { color: "#FFF", fontSize: 27, lineHeight: 32, fontWeight: "900", textAlign: "center" },
  heroSubtitle: { color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 8, maxWidth: 310 },
  card: {
    borderWidth: 1,
    borderRadius: FinFlowRadius.large,
    padding: 18,
    ...FinFlowShadow,
  },
  unlockCard: { marginHorizontal: 10, marginTop: -38 },
  accountPill: { minHeight: 43, borderRadius: FinFlowRadius.medium, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 18 },
  accountPillText: { flex: 1, fontSize: 13, fontWeight: "700" },
  fieldGroup: { marginBottom: 15 },
  fieldLabel: { fontSize: 12, fontWeight: "800", marginBottom: 7 },
  inputShell: { minHeight: 54, borderWidth: 1, borderRadius: FinFlowRadius.medium, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  inputIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  input: { flex: 1, minHeight: 52, paddingHorizontal: 11, paddingVertical: 11, fontSize: 14 },
  eyeButton: { width: 45, minHeight: 52, alignItems: "center", justifyContent: "center" },
  fullButton: { width: "100%", marginTop: 4 },
  forgotButton: { minHeight: 45, marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  forgotButtonText: { fontSize: 13, fontWeight: "800" },
  validatedBanner: { borderWidth: 1, borderRadius: FinFlowRadius.large, padding: 14, flexDirection: "row", alignItems: "center", marginBottom: 22 },
  validatedIcon: { width: 43, height: 43, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  validatedCopy: { flex: 1, marginLeft: 11 },
  validatedTitle: { fontSize: 14, fontWeight: "900" },
  validatedText: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  lockNowButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  sectionLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2, marginTop: 4, marginBottom: 9, marginLeft: 4 },
  dataRow: { minHeight: 74, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, paddingBottom: 14, marginBottom: 14 },
  dataRowLast: { minHeight: 60, flexDirection: "row", alignItems: "center" },
  dataIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", marginRight: 12 },
  dataCopy: { flex: 1, minWidth: 0 },
  dataLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  dataValue: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  dataStatus: { fontSize: 10, fontWeight: "800", marginTop: 3 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardDescription: { fontSize: 11, lineHeight: 17, marginTop: 4, marginBottom: 15 },
  pendingNotice: { borderWidth: 1, borderRadius: FinFlowRadius.medium, padding: 11, flexDirection: "row", alignItems: "center", marginBottom: 13 },
  pendingCopy: { flex: 1, marginLeft: 9, minWidth: 0 },
  pendingTitle: { fontSize: 11, fontWeight: "900" },
  pendingText: { fontSize: 10, marginTop: 2 },
  disabledCard: { flexDirection: "row", alignItems: "flex-start" },
  disabledIcon: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", marginRight: 12 },
  disabledCopy: { flex: 1 },
  disabledDescription: { marginBottom: 0 },
  passwordMatch: { minHeight: 38, borderRadius: 12, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 7, marginTop: -4, marginBottom: 12 },
  passwordMatchText: { fontSize: 11, fontWeight: "800" },
});
