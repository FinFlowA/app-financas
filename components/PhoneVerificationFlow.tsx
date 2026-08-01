import { MaterialIcons } from "@expo/vector-icons";
import type { User } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { FinFlowColors, finFlowTheme } from "../constants/finflow-design";
import { formatarTelefoneBrasil, telefoneBrasilE164, telefoneMascarado } from "../lib/phone";
import { supabase } from "../lib/supabase";

type PhoneVerificationFlowProps = {
  isDark: boolean;
  initialPhone?: string;
  currentVerifiedPhone?: string;
  embedded?: boolean;
  onVerified?: (user: User | null) => void | Promise<void>;
};

type FlowStep = "phone" | "code" | "verified";

type AuthLikeError = {
  code?: string;
  message?: string;
};

function phoneErrorMessage(error: AuthLikeError, action: "send" | "verify"): string {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (
    code === "phone_exists" ||
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("outra conta")
  ) {
    return "Este telefone já pertence a outra conta do FinFlow.";
  }
  if (
    code === "over_sms_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    message.includes("rate limit") ||
    message.includes("security purposes")
  ) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (
    code === "otp_expired" ||
    code === "otp_disabled" ||
    code === "invalid_grant" ||
    message.includes("expired") ||
    message.includes("invalid token")
  ) {
    return "O código expirou ou não é válido. Solicite um novo código.";
  }
  if (code === "hook_timeout" || message.includes("hook timed out")) {
    return "O serviço de SMS demorou para responder. Tente novamente em instantes.";
  }
  if (
    code === "sms_send_failed" ||
    code === "hook_payload_invalid_content_type" ||
    message.includes("sms") ||
    message.includes("hook")
  ) {
    return "Não foi possível enviar o SMS agora. Confira o número e tente novamente.";
  }

  return action === "send"
    ? "Não foi possível enviar o código agora. Confira sua conexão e tente novamente."
    : "Não foi possível confirmar o código. Tente novamente.";
}

export default function PhoneVerificationFlow({
  isDark,
  initialPhone = "",
  currentVerifiedPhone = "",
  embedded = false,
  onVerified,
}: PhoneVerificationFlowProps) {
  const theme = finFlowTheme(isDark);
  const [step, setStep] = useState<FlowStep>("phone");
  const [phone, setPhone] = useState(() => formatarTelefoneBrasil(initialPhone));
  const [pendingPhone, setPendingPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const currentVerifiedE164 = useMemo(
    () => telefoneBrasilE164(currentVerifiedPhone),
    [currentVerifiedPhone],
  );

  useEffect(() => {
    if (step === "phone") setPhone(formatarTelefoneBrasil(initialPhone));
  }, [initialPhone, step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode(targetPhone?: string) {
    if (isSending) return;
    const normalized = telefoneBrasilE164(targetPhone ?? phone);
    if (!normalized) {
      setError("Informe um celular brasileiro válido, com DDD e 11 dígitos.");
      return;
    }
    if (currentVerifiedE164 && normalized === currentVerifiedE164) {
      setError("Este já é o telefone confirmado da sua conta.");
      return;
    }

    setIsSending(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ phone: normalized });
    setIsSending(false);

    if (updateError) {
      setError(phoneErrorMessage(updateError, "send"));
      return;
    }

    setPendingPhone(normalized);
    setPhone(formatarTelefoneBrasil(normalized));
    setCode("");
    setStep("code");
    setCooldown(60);
  }

  async function resendCode() {
    if (!pendingPhone || cooldown > 0 || isSending) return;
    setIsSending(true);
    setError("");
    const { error: resendError } = await supabase.auth.resend({
      type: "phone_change",
      phone: pendingPhone,
    });
    setIsSending(false);

    if (resendError) {
      setError(phoneErrorMessage(resendError, "send"));
      return;
    }
    setCooldown(60);
  }

  async function verifyCode() {
    if (!pendingPhone || isVerifying) return;
    if (code.length !== 6) {
      setError("Digite os 6 números enviados por SMS.");
      return;
    }

    setIsVerifying(true);
    setError("");
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      phone: pendingPhone,
      token: code,
      type: "phone_change",
    });

    if (verifyError) {
      setIsVerifying(false);
      setError(phoneErrorMessage(verifyError, "verify"));
      return;
    }

    const verifiedUser = data.user ?? (await supabase.auth.getUser()).data.user;
    let finalUser = verifiedUser;
    if (verifiedUser) {
      const metadata = verifiedUser.user_metadata ?? {};
      const { data: metadataData } = await supabase.auth.updateUser({
        data: {
          ...metadata,
          telefone: pendingPhone,
        },
      });
      finalUser = metadataData.user ?? finalUser;
    }
    const { data: refreshedData } = await supabase.auth.refreshSession();
    finalUser = refreshedData.user ?? finalUser;
    setIsVerifying(false);
    setStep("verified");
    await onVerified?.(finalUser);
  }

  function changePhone() {
    setStep("phone");
    setCode("");
    setPendingPhone("");
    setCooldown(0);
    setError("");
  }

  return (
    <View
      style={[
        styles.container,
        embedded && styles.embedded,
        !embedded && {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}
    >
      {step === "phone" ? (
        <>
          <View style={styles.introRow}>
            <View style={[styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
              <MaterialIcons name="sms" size={22} color={theme.primary} />
            </View>
            <View style={styles.introCopy}>
              <Text style={[styles.title, { color: theme.text }]}>Telefone com DDD</Text>
              <Text style={[styles.description, { color: theme.textMuted }]}>Enviaremos um código de uso único por SMS.</Text>
            </View>
          </View>

          <View style={[styles.inputShell, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Text style={[styles.countryCode, { color: theme.textMuted }]}>+55</Text>
            <View style={[styles.countryDivider, { backgroundColor: theme.border }]} />
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="(11) 99999-9999"
              placeholderTextColor={theme.textMuted}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={(value) => {
                setPhone(formatarTelefoneBrasil(value));
                setError("");
              }}
              maxLength={15}
              returnKeyType="send"
              onSubmitEditing={() => void sendCode()}
              editable={!isSending}
              accessibilityLabel="Telefone com DDD"
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary }, isSending && styles.disabled]}
            onPress={() => void sendCode()}
            disabled={isSending}
            accessibilityRole="button"
          >
            {isSending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryButtonText}>Enviar código por SMS</Text>}
          </TouchableOpacity>
        </>
      ) : null}

      {step === "code" ? (
        <>
          <View style={styles.introRow}>
            <View style={[styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
              <MaterialIcons name="mark-chat-read" size={22} color={theme.primary} />
            </View>
            <View style={styles.introCopy}>
              <Text style={[styles.title, { color: theme.text }]}>Digite o código</Text>
              <Text style={[styles.description, { color: theme.textMuted }]}>Enviado para {telefoneMascarado(pendingPhone)}.</Text>
            </View>
          </View>

          <TextInput
            style={[
              styles.codeInput,
              {
                color: theme.text,
                backgroundColor: theme.surfaceMuted,
                borderColor: error ? FinFlowColors.red : theme.border,
              },
            ]}
            placeholder="000000"
            placeholderTextColor={theme.textMuted}
            keyboardType="number-pad"
            autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
            textContentType="oneTimeCode"
            value={code}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={() => void verifyCode()}
            editable={!isVerifying}
            accessibilityLabel="Código recebido por SMS"
          />

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary }, (isVerifying || code.length !== 6) && styles.disabled]}
            onPress={() => void verifyCode()}
            disabled={isVerifying || code.length !== 6}
            accessibilityRole="button"
          >
            {isVerifying ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryButtonText}>Confirmar telefone</Text>}
          </TouchableOpacity>

          <View style={styles.secondaryActions}>
            <TouchableOpacity onPress={changePhone} disabled={isVerifying} accessibilityRole="button">
              <Text style={[styles.secondaryText, { color: theme.primary }]}>Corrigir número</Text>
            </TouchableOpacity>
            <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
            <TouchableOpacity
              onPress={() => void resendCode()}
              disabled={cooldown > 0 || isSending || isVerifying}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryText, { color: cooldown > 0 ? theme.textMuted : theme.primary }]}>
                {isSending ? "Reenviando..." : cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {step === "verified" ? (
        <View style={styles.verifiedState}>
          <View style={[styles.verifiedIcon, { backgroundColor: theme.primarySoft }]}>
            <MaterialIcons name="verified" size={28} color={theme.primary} />
          </View>
          <View style={styles.verifiedCopy}>
            <Text style={[styles.title, { color: theme.text }]}>Telefone confirmado</Text>
            <Text style={[styles.description, { color: theme.textMuted }]}>{formatarTelefoneBrasil(pendingPhone)} foi validado com segurança.</Text>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: `${FinFlowColors.red}12` }]}>
          <MaterialIcons name="error-outline" size={18} color={FinFlowColors.red} />
          <Text style={[styles.errorText, { color: FinFlowColors.red }]}>{error}</Text>
        </View>
      ) : null}

      {step !== "verified" ? (
        <View style={styles.securityNote}>
          <MaterialIcons name="lock-outline" size={15} color={theme.textMuted} />
          <Text style={[styles.securityText, { color: theme.textMuted }]}>O código é pessoal. O FinFlow nunca pedirá sua senha ou dados bancários por SMS.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  embedded: { borderWidth: 0, padding: 0 },
  introRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  iconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  introCopy: { flex: 1, marginLeft: 12 },
  title: { fontSize: 15, fontWeight: "900" },
  description: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  inputShell: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  countryCode: { fontSize: 15, fontWeight: "800" },
  countryDivider: { width: 1, height: 25, marginHorizontal: 11 },
  input: { flex: 1, minHeight: 52, fontSize: 16, fontWeight: "700", paddingVertical: 0 },
  codeInput: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 18,
    textAlign: "center",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 13,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFF", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  secondaryActions: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 15 },
  secondaryText: { fontSize: 12, fontWeight: "800" },
  actionDivider: { width: 1, height: 17, marginHorizontal: 13 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, padding: 11, marginTop: 13 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "700", marginLeft: 8 },
  securityNote: { flexDirection: "row", alignItems: "flex-start", marginTop: 14, paddingHorizontal: 2 },
  securityText: { flex: 1, fontSize: 10.5, lineHeight: 15, marginLeft: 7 },
  verifiedState: { flexDirection: "row", alignItems: "center" },
  verifiedIcon: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  verifiedCopy: { flex: 1, marginLeft: 13 },
});
