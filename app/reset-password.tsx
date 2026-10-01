import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import { useCampoFocadoVisivel, useSobreposicaoTeclado } from "../hooks/use-teclado";
import { supabase } from "../lib/supabase";
import {
  fluxoRecuperacaoVigente,
  lerEstadoLinkRecuperacao,
  lerFluxoRecuperacaoSenha,
  mensagemFalhaRecuperacao,
  PASSWORD_RECOVERY_FLOW_KEY,
  PASSWORD_RECOVERY_LINK_WAIT_MS,
  type MotivoFalhaRecuperacao,
} from "../lib/auth-flow";
import { limparNotificacoesAoSair } from "../lib/notifications";
import { PASSWORD_REQUIREMENTS_MESSAGE, validatePassword } from "../lib/password";
import { checkPwnedPassword, PWNED_PASSWORD_MESSAGE } from "../lib/pwned-password";
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
  onFocus?: () => void;
};

/** Sem link em andamento, quanto esperar o _layout começar a trocar o código. */
const ESPERA_SEM_LINK_MS = 4000;

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
  onFocus,
}: PasswordFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: theme.surfaceMuted, borderColor: hasError ? "#C0392E" : theme.border },
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
          onFocus={onFocus}
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
  const [motivoFalha, setMotivoFalha] = useState<MotivoFalhaRecuperacao | null>(null);
  const areaRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const tecladoAndroid = useSobreposicaoTeclado(areaRef, Platform.OS === "android");
  const { onScroll, garantirVisivel: mostrarCampoAcimaDoTeclado } = useCampoFocadoVisivel(scrollRef);

  const confirmacaoPreenchida = confirmarSenha.length > 0;
  const novaSenhaValida = validatePassword(novaSenha).valid;
  const senhasConferem = confirmacaoPreenchida && novaSenhaValida && novaSenha === confirmarSenha;

  // A sessão do link não pode seguir aberta sem a senha nova: o Voltar do
  // Android equivale a "Voltar ao login". Antes isso ficava na desmontagem da
  // tela, que também acontece quando a navegação só a recria (e derrubava a
  // sessão no meio da validação); a guarda de rotas do _layout cobre o resto.
  useEffect(() => {
    const inscricao = BackHandler.addEventListener("hardwareBackPress", () => {
      void voltarAoLogin();
      return true;
    });
    return () => inscricao.remove();
  }, []);

  async function fluxoRecuperacaoValido(): Promise<boolean> {
    const fluxo = lerFluxoRecuperacaoSenha(await AsyncStorage.getItem(PASSWORD_RECOVERY_FLOW_KEY));
    // Sem marcador ainda (troca do código em andamento): nada a conferir.
    if (!fluxo) return false;
    if (fluxo.expiresAt <= Date.now()) {
      await AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
      return false;
    }
    const { data, error } = await supabase.auth.getUser();
    // Falha de rede não invalida o link; só a sessão de outro usuário invalida.
    if (error) return false;
    if (!fluxoRecuperacaoVigente(fluxo, data.user?.id)) {
      await AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
      return false;
    }
    return true;
  }

  useEffect(() => {
    let ativo = true;
    void (async () => {
      // O deep link monta esta tela antes de o _layout concluir a troca do
      // código. Enquanto ela estiver em andamento, espere até 30 s (rede
      // lenta, app aberto do zero); sem link em andamento, só alguns segundos.
      const inicio = Date.now();
      while (ativo) {
        if (await fluxoRecuperacaoValido()) {
          if (ativo) setStatusFluxo("valido");
          return;
        }
        const link = lerEstadoLinkRecuperacao();
        if (link?.etapa === "falhou") {
          if (ativo) {
            setMotivoFalha(link.motivo);
            setStatusFluxo("invalido");
          }
          return;
        }
        const processando = link?.etapa === "processando";
        if (Date.now() - inicio >= (processando ? PASSWORD_RECOVERY_LINK_WAIT_MS : ESPERA_SEM_LINK_MS)) {
          if (ativo) {
            setMotivoFalha(processando ? "sem_conexao" : null);
            setStatusFluxo("invalido");
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();
    return () => { ativo = false; };
  }, []);

  async function redefinirSenha() {
    if (!(await fluxoRecuperacaoValido())) {
      setStatusFluxo("invalido");
      return Alert.alert("Link inválido ou expirado", mensagemFalhaRecuperacao(motivoFalha));
    }
    if (!novaSenha || !confirmarSenha) {
      return Alert.alert("Aviso", "Preencha os dois campos.");
    }
    if (!novaSenhaValida) {
      return Alert.alert("Senha fraca", PASSWORD_REQUIREMENTS_MESSAGE);
    }
    if (novaSenha !== confirmarSenha) {
      return Alert.alert("Senhas diferentes", "As senhas não conferem.");
    }

    setLoading(true);
    if ((await checkPwnedPassword(novaSenha)) === "pwned") {
      setLoading(false);
      return Alert.alert("Senha exposta em vazamentos", PWNED_PASSWORD_MESSAGE);
    }
    // senha_definida: quem entrou com Google e nunca criou senha deixa de ser
    // mandado à tela de definir senha depois de criar uma por aqui.
    const { error } = await supabase.auth.updateUser({ password: novaSenha, data: { senha_definida: true } });
    setLoading(false);

    if (error) {
      Alert.alert("Erro", error.message);
      return;
    }

    // Remove o marcador antes de navegar: a guarda de rotas do _layout deixa
    // de devolver o usuário para esta tela.
    await AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
    Alert.alert(
      "Senha redefinida!",
      "Sua senha foi atualizada com sucesso. Você já pode usar o app normalmente.",
      [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
    );
  }

  async function voltarAoLogin() {
    await limparNotificacoesAoSair();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.container} enabled={Platform.OS === "ios"} behavior="padding">
        <View ref={areaRef} style={[styles.container, { paddingBottom: tecladoAndroid }]}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                  <MaterialIcons name="link-off" size={34} color="#C0392E" />
                </View>
                <Text style={[styles.flowStateTitle, { color: theme.text }]}>
                  {motivoFalha === "sem_conexao"
                    ? "Sem conexão para validar o link"
                    : motivoFalha === "outro_aparelho"
                      ? "Abra o link no mesmo celular"
                      : "Link inválido ou expirado"}
                </Text>
                <Text style={[styles.flowStateText, { color: theme.textMuted }]}>{mensagemFalhaRecuperacao(motivoFalha)}</Text>
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
                <Text style={[styles.securityNoteText, { color: theme.textMuted }]}>{PASSWORD_REQUIREMENTS_MESSAGE} Não compartilhe sua senha.</Text>
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
              hasError={novaSenha.length > 0 && !novaSenhaValida}
              onFocus={() => mostrarCampoAcimaDoTeclado()}
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
              onFocus={() => mostrarCampoAcimaDoTeclado()}
            />

            {confirmacaoPreenchida && (
              <View
                style={[
                  styles.validationRow,
                  { backgroundColor: senhasConferem ? `${theme.primary}12` : "#C0392E12" },
                ]}
              >
                <MaterialIcons
                  name={senhasConferem ? "check-circle" : "error-outline"}
                  size={17}
                  color={senhasConferem ? theme.primary : "#C0392E"}
                />
                <Text style={[styles.validationText, { color: senhasConferem ? theme.primary : "#C0392E" }]}>
                  {senhasConferem ? "As senhas conferem" : "Confira a senha e os requisitos acima"}
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
        </View>
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
  invalidFlowIcon: { width: 70, height: 70, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 2, backgroundColor: "#C0392E1A" },
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
