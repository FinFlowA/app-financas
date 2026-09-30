import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Factor } from "@supabase/supabase-js";

import Button from "../components/FinFlowButton";
import {
  FinFlowColors,
  FinFlowRadius,
  FinFlowShadow,
  finFlowTheme,
} from "../constants/finflow-design";
import { supabase } from "../lib/supabase";
import { formatarTelefoneBrasil, telefoneBrasilE164 } from "../lib/phone";
import { PASSWORD_REQUIREMENTS_MESSAGE, validatePassword } from "../lib/password";
import { checkPwnedPassword, PWNED_PASSWORD_MESSAGE } from "../lib/pwned-password";
import {
  definirReautenticacao,
  hasVerifiedFactor,
  MAX_TOTP_FACTORS,
  normalizeTotpCode,
  totpErrorMessage,
  verifyTotpCode,
} from "../lib/mfa";
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
  const { isDark, session, showToast } = useAppTheme();
  const theme = finFlowTheme(isDark);
  const entranceProgress = useRef(new Animated.Value(0)).current;

  const currentEmail = session?.user?.email?.trim() ?? "";
  const metadataPhone = typeof session?.user?.user_metadata?.telefone === "string"
    ? session.user.user_metadata.telefone.trim()
    : "";
  const authPhone = session?.user?.phone?.trim() ?? "";
  const currentPhone = metadataPhone || authPhone;
  const initialPendingEmail = (session?.user as { new_email?: string } | undefined)?.new_email ?? "";

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState(initialPendingEmail);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  const [phoneDraft, setPhoneDraft] = useState(() => formatarTelefoneBrasil(currentPhone));
  const [isUpdatingPhone, setIsUpdatingPhone] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const securityDeadlineRef = useRef(0);
  const securityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifiedPasswordRef = useRef("");

  // Verificação em duas etapas: quem ativou confirma a senha e, na sequência,
  // o código do autenticador. Entre as duas etapas a sessão ainda não tem o
  // código; reautenticandoRef avisa o _layout para não trocar de tela.
  const hasMfa = hasVerifiedFactor(session?.user);
  const reautenticandoRef = useRef(false);
  const [unlockStage, setUnlockStage] = useState<"senha" | "codigo">("senha");
  const [unlockCode, setUnlockCode] = useState("");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<{ factorId: string; secret: string; uri: string } | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [removalCandidate, setRemovalCandidate] = useState<string | null>(null);
  const [isMfaBusy, setIsMfaBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!active) return;
      Animated.timing(entranceProgress, {
        toValue: 1,
        duration: reduceMotion ? 1 : 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => { active = false; };
  }, [entranceProgress]);

  const lockSecurity = useCallback(() => {
    if (securityTimerRef.current) {
      clearTimeout(securityTimerRef.current);
      securityTimerRef.current = null;
    }
    securityDeadlineRef.current = 0;
    verifiedPasswordRef.current = "";
    if (reautenticandoRef.current) {
      // Desistiu antes do código: o _layout reavalia e abre a verificação.
      reautenticandoRef.current = false;
      definirReautenticacao(false);
    }
    setUnlockStage("senha");
    setUnlockCode("");
    setEnrollment(null);
    setEnrollCode("");
    setRemovalCandidate(null);
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
      if (reautenticandoRef.current) {
        reautenticandoRef.current = false;
        definirReautenticacao(false);
      }
    };
  }, []);

  useEffect(() => {
    setPhoneDraft(formatarTelefoneBrasil(currentPhone));
  }, [currentPhone]);

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
    const precisaCodigo = hasMfa;
    if (precisaCodigo) {
      reautenticandoRef.current = true;
      definirReautenticacao(true);
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    setIsCheckingPassword(false);

    if (error) {
      if (precisaCodigo) {
        reautenticandoRef.current = false;
        definirReautenticacao(false);
      }
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

    verifiedPasswordRef.current = currentPassword;
    setCurrentPassword("");
    if (precisaCodigo) {
      setUnlockStage("codigo");
      return;
    }
    setIsUnlocked(true);
    void refreshFactors();
  }

  async function confirmUnlockCode() {
    if (isCheckingPassword) return;
    setIsCheckingPassword(true);
    const result = await verifyTotpCode(supabase, unlockCode);
    setIsCheckingPassword(false);
    if (result !== "ok") {
      setUnlockCode("");
      Alert.alert("Código não confere", totpErrorMessage(result));
      return;
    }
    reautenticandoRef.current = false;
    definirReautenticacao(false);
    setUnlockCode("");
    setUnlockStage("senha");
    setIsUnlocked(true);
    void refreshFactors();
  }

  async function refreshFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
  }

  async function startEnrollment() {
    if (!hasValidSecurityWindow() || isMfaBusy) return;
    setIsMfaBusy(true);
    setRemovalCandidate(null);
    // Cadastros abandonados ficam como fatores não verificados; limpamos antes
    // de começar outro para não esbarrar no limite do Auth.
    const { data: current } = await supabase.auth.mfa.listFactors();
    for (const factor of current?.all ?? []) {
      if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const agora = new Date();
    const doisDigitos = (valor: number) => String(valor).padStart(2, "0");
    const friendlyName = `Autenticador de ${doisDigitos(agora.getDate())}/${doisDigitos(agora.getMonth() + 1)}/${agora.getFullYear()} ${doisDigitos(agora.getHours())}:${doisDigitos(agora.getMinutes())}`;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName, issuer: "FinFlow" });
    setIsMfaBusy(false);
    if (error || !data) {
      Alert.alert("Não foi possível ativar", "Tente novamente em instantes.");
      return;
    }
    setEnrollCode("");
    setEnrollment({ factorId: data.id, secret: data.totp.secret, uri: data.totp.uri });
  }

  async function openAuthenticator() {
    if (!enrollment) return;
    try {
      await Linking.openURL(enrollment.uri);
    } catch {
      Alert.alert(
        "Nenhum app autenticador encontrado",
        "Instale o Google Authenticator ou o Microsoft Authenticator, ou digite a chave manualmente no app que você já usa.",
      );
    }
  }

  async function shareSecret() {
    if (!enrollment) return;
    await Share.share({ message: enrollment.secret }).catch(() => undefined);
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setIsMfaBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setEnrollCode("");
    setIsMfaBusy(false);
  }

  async function confirmEnrollment() {
    if (!enrollment || !hasValidSecurityWindow() || isMfaBusy) return;
    const code = normalizeTotpCode(enrollCode);
    if (!code) {
      Alert.alert("Código incompleto", "Digite os 6 dígitos que aparecem no app autenticador.");
      return;
    }
    setIsMfaBusy(true);
    const firstFactor = factors.length === 0;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
    setIsMfaBusy(false);
    if (error) {
      setEnrollCode("");
      Alert.alert("Código não confere", totpErrorMessage(error.status === 429 ? "rate_limited" : "invalid"));
      return;
    }
    setEnrollment(null);
    setEnrollCode("");
    await refreshFactors();
    Alert.alert(
      firstFactor ? "Verificação em duas etapas ativada" : "Autenticador reserva adicionado",
      firstFactor
        ? "A partir de agora o FinFlow pede o código do autenticador ao entrar. Outros aparelhos conectados foram desconectados."
        : "Você pode usar o código de qualquer um dos autenticadores cadastrados.",
    );
  }

  async function removeFactor(factorId: string) {
    if (!hasValidSecurityWindow() || isMfaBusy) return;
    if (removalCandidate !== factorId) {
      setRemovalCandidate(factorId);
      return;
    }
    setIsMfaBusy(true);
    const lastFactor = factors.length === 1;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setRemovalCandidate(null);
    setIsMfaBusy(false);
    if (error) {
      Alert.alert("Não foi possível remover", "Bloqueie e desbloqueie a área de segurança e tente novamente.");
      return;
    }
    await refreshFactors();
    Alert.alert(lastFactor ? "Verificação em duas etapas desativada" : "Autenticador removido");
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
      { email: normalizedEmail, current_password: verifiedPasswordRef.current },
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

    if (!validatePassword(newPassword).valid) {
      Alert.alert("Senha fraca", PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Senhas diferentes", "A nova senha e a confirmação não conferem.");
      return;
    }

    setIsUpdatingPassword(true);
    if ((await checkPwnedPassword(newPassword)) === "pwned") {
      setIsUpdatingPassword(false);
      Alert.alert("Senha exposta em vazamentos", PWNED_PASSWORD_MESSAGE);
      return;
    }
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      current_password: verifiedPasswordRef.current,
    });
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

  async function updateOptionalPhone() {
    if (!hasValidSecurityWindow() || isUpdatingPhone) return;

    const normalizedPhone = phoneDraft.trim() ? telefoneBrasilE164(phoneDraft) : null;
    if (phoneDraft.trim() && !normalizedPhone) {
      Alert.alert("Celular inválido", "Informe um celular brasileiro válido, com DDD e 11 dígitos.");
      return;
    }

    setIsUpdatingPhone(true);
    const metadataAtual = session?.user?.user_metadata ?? {};
    const { error } = await supabase.auth.updateUser({
      current_password: verifiedPasswordRef.current,
      data: {
        ...metadataAtual,
        telefone: normalizedPhone,
      },
    });
    setIsUpdatingPhone(false);

    if (error) {
      Alert.alert("Não foi possível salvar", "Confira sua conexão e tente novamente.");
      return;
    }

    setPhoneDraft(formatarTelefoneBrasil(normalizedPhone ?? ""));
    showToast(normalizedPhone ? "Telefone salvo ✓" : "Telefone removido ✓", "success");
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <Animated.View style={[styles.container, {
        opacity: entranceProgress,
        transform: [{ translateY: entranceProgress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }]}>
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
                <Animated.View style={[styles.heroIcon, {
                  transform: [{ scale: entranceProgress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0.82, 1.06, 1] }) }],
                }]}>
                  <MaterialIcons name="password" size={37} color={theme.primaryDark} />
                </Animated.View>
                <Text style={styles.heroEyebrow}>ÁREA PROTEGIDA</Text>
                <Text style={styles.heroTitle}>Confirme que é você</Text>
                <Text style={styles.heroSubtitle}>A senha atual é obrigatória. A biometria não libera esta área.</Text>
              </View>

              <View style={[styles.card, styles.unlockCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.accountPill, { backgroundColor: theme.primarySoft }]}>
                  <MaterialIcons name="alternate-email" size={18} color={theme.primary} />
                  <Text style={[styles.accountPillText, { color: theme.text }]} numberOfLines={1}>{currentEmail}</Text>
                </View>

                {unlockStage === "codigo" ? (
                  <>
                    <Text style={[styles.cardDescription, { color: theme.textMuted }]}>
                      Senha confirmada. Sua conta usa verificação em duas etapas: digite o código de 6 dígitos do app autenticador.
                    </Text>
                    <TextInput
                      style={[styles.codeInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}
                      placeholder="000000"
                      placeholderTextColor={theme.textMuted}
                      value={unlockCode}
                      onChangeText={(value) => setUnlockCode(value.replace(/\D/g, "").slice(0, 6))}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      accessibilityLabel="Código do app autenticador"
                      onSubmitEditing={() => void confirmUnlockCode()}
                    />
                    <Button
                      title={isCheckingPassword ? "Verificando..." : "Confirmar código"}
                      color={theme.primary}
                      disabled={isCheckingPassword || unlockCode.length !== 6}
                      onPress={() => void confirmUnlockCode()}
                      style={styles.fullButton}
                    />
                    <TouchableOpacity style={styles.forgotButton} onPress={lockSecurity} accessibilityRole="button">
                      <Text style={[styles.forgotButtonText, { color: theme.textMuted }]}>Cancelar</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
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
                  </>
                )}

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

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>VERIFICAÇÃO EM DUAS ETAPAS</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {factors.length > 0 ? "Ativada" : "Desativada"}
                </Text>
                <Text style={[styles.cardDescription, { color: theme.textMuted }]}>
                  Além da senha, o FinFlow pede um código de 6 dígitos gerado por um app autenticador (Google Authenticator, Microsoft Authenticator…).
                </Text>

                {factors.map((factor) => (
                  <View key={factor.id} style={[styles.factorRow, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
                    <MaterialIcons name="phonelink-lock" size={19} color={theme.primary} />
                    <Text style={[styles.factorName, { color: theme.text }]} numberOfLines={1}>{factor.friendly_name || "Autenticador"}</Text>
                    <TouchableOpacity
                      onPress={() => void removeFactor(factor.id)}
                      disabled={isMfaBusy}
                      style={[styles.factorRemove, removalCandidate === factor.id && { backgroundColor: FinFlowColors.red }]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.factorRemoveText, { color: removalCandidate === factor.id ? "#FFF" : FinFlowColors.red }]}>
                        {removalCandidate === factor.id ? (factors.length === 1 ? "Confirmar: desativar" : "Confirmar") : "Remover"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {enrollment ? (
                  <View style={[styles.enrollBox, { borderColor: `${theme.primary}45`, backgroundColor: theme.primarySoft }]}>
                    <Text style={[styles.enrollStep, { color: theme.text }]}>1. Cadastre o FinFlow no app autenticador</Text>
                    <Button title="Abrir no app autenticador" color={theme.primary} onPress={() => void openAuthenticator()} style={styles.fullButton} />
                    <Text style={[styles.cardDescription, { color: theme.textMuted, marginBottom: 4 }]}>
                      Ou digite esta chave no app (toque e segure para copiar):
                    </Text>
                    <Text selectable style={[styles.secretText, { color: theme.text }]}>
                      {enrollment.secret.replace(/(.{4})/g, "$1 ").trim()}
                    </Text>
                    <TouchableOpacity style={styles.forgotButton} onPress={() => void shareSecret()} accessibilityRole="button">
                      <MaterialIcons name="share" size={17} color={theme.primary} />
                      <Text style={[styles.forgotButtonText, { color: theme.primary }]}>Compartilhar chave</Text>
                    </TouchableOpacity>
                    <Text style={[styles.enrollStep, { color: theme.text }]}>2. Digite o código que o app mostra agora</Text>
                    <TextInput
                      style={[styles.codeInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                      placeholder="000000"
                      placeholderTextColor={theme.textMuted}
                      value={enrollCode}
                      onChangeText={(value) => setEnrollCode(value.replace(/\D/g, "").slice(0, 6))}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      accessibilityLabel="Código do app autenticador"
                      onSubmitEditing={() => void confirmEnrollment()}
                    />
                    <Button
                      title={isMfaBusy ? "Verificando..." : "Ativar"}
                      color={theme.primary}
                      disabled={isMfaBusy || enrollCode.length !== 6}
                      onPress={() => void confirmEnrollment()}
                      style={styles.fullButton}
                    />
                    <TouchableOpacity style={styles.forgotButton} onPress={() => void cancelEnrollment()} disabled={isMfaBusy} accessibilityRole="button">
                      <Text style={[styles.forgotButtonText, { color: theme.textMuted }]}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                ) : factors.length < MAX_TOTP_FACTORS ? (
                  <>
                    <Button
                      title={factors.length > 0 ? "Adicionar autenticador reserva" : "Ativar verificação em duas etapas"}
                      color={theme.primary}
                      disabled={isMfaBusy}
                      onPress={() => void startEnrollment()}
                      style={styles.fullButton}
                    />
                    <Text style={[styles.cardDescription, { color: theme.textMuted, marginTop: 8, marginBottom: 0 }]}>
                      {factors.length > 0
                        ? "Um segundo aparelho (outro celular ou tablet) evita perder o acesso se o principal for perdido."
                        : "Ao ativar, outros aparelhos conectados serão desconectados e passarão a pedir o código no próximo acesso."}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.cardDescription, { color: theme.textMuted, marginBottom: 0 }]}>
                    Você já cadastrou o máximo de {MAX_TOTP_FACTORS} autenticadores.
                  </Text>
                )}

                {factors.length > 0 ? (
                  <Text style={[styles.cardDescription, { color: theme.textMuted, marginTop: 10, marginBottom: 0 }]}>
                    Perdeu o celular com o autenticador? Fale com o suporte pelo e-mail Finflowfinancas@gmail.com para recuperar o acesso.
                  </Text>
                ) : null}
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
                    <Text style={[styles.dataValue, { color: theme.text }]}>{formatarTelefoneBrasil(currentPhone) || "Não informado"}</Text>
                    <Text style={[styles.dataStatus, { color: theme.textMuted }]}>
                      Opcional · não verificado
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
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Telefone opcional</Text>
                <Text style={[styles.cardDescription, { color: theme.textMuted }]}>
                  Enquanto não houver verificação, este número não será usado para entrar, recuperar a conta ou comprovar sua identidade.
                </Text>
                <View style={[styles.inputShell, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                  <View style={[styles.inputIcon, { backgroundColor: theme.primarySoft }]}>
                    <MaterialIcons name="phone-android" size={19} color={theme.primary} />
                  </View>
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    placeholder="(11) 99999-9999"
                    placeholderTextColor={theme.textMuted}
                    value={phoneDraft}
                    onChangeText={(value) => setPhoneDraft(formatarTelefoneBrasil(value))}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    maxLength={15}
                    returnKeyType="done"
                    onSubmitEditing={() => void updateOptionalPhone()}
                  />
                </View>
                <Button
                  title={isUpdatingPhone
                    ? "Salvando..."
                    : phoneDraft.trim()
                      ? "Salvar telefone"
                      : currentPhone
                        ? "Remover telefone"
                        : "Telefone não informado"}
                  color={theme.primary}
                  disabled={isUpdatingPhone || (!phoneDraft.trim() && !currentPhone)}
                  onPress={() => void updateOptionalPhone()}
                  style={styles.fullButton}
                />
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>ALTERAR SENHA</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Crie uma nova senha</Text>
                <Text style={[styles.cardDescription, { color: theme.textMuted }]}>{PASSWORD_REQUIREMENTS_MESSAGE} Evite reutilizar senhas de outros serviços.</Text>

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
                  <View style={[styles.passwordMatch, { backgroundColor: validatePassword(newPassword).valid && newPassword === confirmPassword ? `${theme.primary}12` : `${FinFlowColors.red}12` }]}>
                    <MaterialIcons
                      name={validatePassword(newPassword).valid && newPassword === confirmPassword ? "check-circle" : "error-outline"}
                      size={17}
                      color={validatePassword(newPassword).valid && newPassword === confirmPassword ? theme.primary : FinFlowColors.red}
                    />
                    <Text style={[styles.passwordMatchText, { color: validatePassword(newPassword).valid && newPassword === confirmPassword ? theme.primary : FinFlowColors.red }]}>
                      {validatePassword(newPassword).valid && newPassword === confirmPassword ? "As senhas conferem" : "Confira a senha e os requisitos acima"}
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
      </Animated.View>
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
  codeInput: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
    marginBottom: 12,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
  },
  factorRow: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  factorName: { flex: 1, fontSize: 13, fontWeight: "800" },
  factorRemove: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  factorRemoveText: { fontSize: 12, fontWeight: "900" },
  enrollBox: { borderWidth: 1, borderRadius: FinFlowRadius.medium, padding: 14, marginTop: 4 },
  enrollStep: { fontSize: 13, fontWeight: "900", marginBottom: 10, marginTop: 4 },
  secretText: { fontSize: 16, fontWeight: "800", letterSpacing: 1, textAlign: "center", marginBottom: 4 },
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
