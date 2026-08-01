import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FinFlowColors, FinFlowRadius, FinFlowShadow, finFlowTheme } from "../constants/finflow-design";
import { supabase } from "../lib/supabase";
import {
  dataNascimentoParaISO,
  formatarDataNascimento,
  idadeEmAnos,
  LEGAL_DOCUMENT_VERSION,
} from "../lib/legal";
import { useAppTheme } from "./_layout";

type AuthTheme = ReturnType<typeof finFlowTheme>;
type MaterialIconName = React.ComponentProps<typeof MaterialIcons>["name"];

interface AuthFieldProps extends TextInputProps {
  label: string;
  icon: MaterialIconName;
  theme: AuthTheme;
  trailing?: React.ReactNode;
  helper?: React.ReactNode;
  error?: boolean;
  success?: boolean;
}

function AuthField({
  label,
  icon,
  theme,
  trailing,
  helper,
  error = false,
  success = false,
  onFocus,
  onBlur,
  style,
  ...inputProps
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? FinFlowColors.red
    : success
      ? FinFlowColors.primary
      : focused
        ? theme.primary
        : theme.border;

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: theme.surfaceMuted, borderColor },
          focused && styles.inputContainerFocused,
        ]}
      >
        <View style={[styles.inputIconWrap, { backgroundColor: focused ? theme.primarySoft : "transparent" }]}>
          <MaterialIcons name={icon} size={19} color={focused ? theme.primary : theme.textMuted} />
        </View>
        <TextInput
          {...inputProps}
          style={[styles.input, { color: theme.text }, style]}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.primary}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
        />
        {trailing}
      </View>
      {helper}
    </View>
  );
}

export default function LoginScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const theme = finFlowTheme(isDark);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [loading, setLoading] = useState(false);

  const [isLogin, setIsLogin] = useState(true);
  const [isRecuperandoSenha, setIsRecuperandoSenha] = useState(false);

  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmSenha, setMostrarConfirmSenha] = useState(false);

  const [tentativasFalhadas, setTentativasFalhadas] = useState(0);
  const [bloqueadoAte, setBloqueadoAte] = useState<number | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const [modalErro, setModalErro] = useState<{ titulo: string; mensagem: string; cor?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (bloqueadoAte === null) return;
    timerRef.current = setInterval(() => {
      const restante = Math.ceil((bloqueadoAte - Date.now()) / 1000);
      if (restante <= 0) {
        setSegundosRestantes(0);
        setBloqueadoAte(null);
        setTentativasFalhadas(0);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setSegundosRestantes(restante);
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [bloqueadoAte]);

  const validarEmail = (e: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const formatarTelefone = (valor: string) => {
    const nums = valor.replace(/\D/g, "").slice(0, 11);
    if (nums.length <= 2) return nums;
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`;
    if (nums.length <= 11)
      return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`;
    return valor;
  };

  async function signInWithEmail() {
    if (bloqueadoAte && Date.now() < bloqueadoAte)
      return Alert.alert(
        "Aguarde",
        `Muitas tentativas. Tente novamente em ${segundosRestantes}s.`,
      );
    if (!email || !password)
      return Alert.alert("Aviso", "Preencha email e senha.");
    if (!validarEmail(email))
      return Alert.alert(
        "Aviso",
        "Digite um e-mail válido (ex: nome@dominio.com).",
      );

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const novasTentativas = tentativasFalhadas + 1;
      setTentativasFalhadas(novasTentativas);
      if (novasTentativas >= 3) {
        setBloqueadoAte(Date.now() + 30000);
        setModalErro({ titulo: "Bloqueado", mensagem: "3 tentativas incorretas. Aguarde 30 segundos.", cor: "#FF4444" });
      } else {
        const mensagemErro =
          error.message.includes("Invalid login credentials") ||
          error.message.includes("invalid_credentials")
            ? "E-mail ou senha incorretos."
            : "Não foi possível entrar. Verifique suas credenciais.";
        setModalErro({
          titulo: "Erro ao entrar",
          mensagem: `${mensagemErro} (${3 - novasTentativas} tentativa${3 - novasTentativas !== 1 ? "s" : ""} restante${3 - novasTentativas !== 1 ? "s" : ""})`,
          cor: "#E76F51",
        });
      }
    } else {
      const nascimento = data.user?.user_metadata?.data_nascimento;
      const idade = nascimento ? idadeEmAnos(nascimento) : null;
      if (idade !== null && idade < 18) {
        await supabase.auth.signOut();
        setLoading(false);
        setModalErro({
          titulo: "Acesso não permitido",
          mensagem: "O FinFlow é destinado somente a pessoas com 18 anos ou mais.",
          cor: "#E76F51",
        });
        return;
      }
      router.replace("/(tabs)");
    }
    setLoading(false);
  }

  async function signUpWithEmail() {
    if (!nome || !email || !telefone || !dataNascimento || !password)
      return Alert.alert(
        "Aviso",
        "Preencha todos os campos obrigatórios: nome, e-mail, telefone, data de nascimento e senha.",
      );
    if (!validarEmail(email))
      return Alert.alert(
        "Aviso",
        "Digite um e-mail válido (ex: nome@dominio.com).",
      );

    if (password !== confirmPassword)
      return Alert.alert(
        "Senhas diferentes",
        "A senha e a confirmação não conferem. Verifique e tente novamente.",
      );

    if (password.length < 6)
      return Alert.alert(
        "Senha fraca",
        "A senha deve ter pelo menos 6 caracteres.",
      );

    const nascimentoISO = dataNascimentoParaISO(dataNascimento);
    const idade = nascimentoISO ? idadeEmAnos(nascimentoISO) : null;
    if (idade === null)
      return Alert.alert("Data inválida", "Informe uma data de nascimento válida no formato DD/MM/AAAA.");
    if (idade < 18)
      return setModalErro({
        titulo: "Cadastro não permitido",
        mensagem: "O FinFlow é destinado somente a pessoas com 18 anos ou mais.",
        cor: "#E76F51",
      });
    if (!aceitouTermos)
      return Alert.alert(
        "Aceite necessário",
        "Para criar sua conta, você precisa ler e concordar com os Termos de Uso e a Política de Privacidade.",
      );

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        emailRedirectTo: "meuappfinancas://email-confirmed",
        data: {
          nome_usuario: nome,
          telefone: telefone.trim(),
          data_nascimento: nascimentoISO,
          termos_aceitos_em: new Date().toISOString(),
          termos_versao: LEGAL_DOCUMENT_VERSION,
          tutorial_pendente: true,
        },
      },
    });

    if (error) {
      Alert.alert("Erro ao criar conta", error.message);
    } else if (!data.user || (data.user.identities?.length ?? 0) === 0) {
      Alert.alert(
        "E-mail já cadastrado",
        "Este e-mail já está em uso. Faça login ou recupere sua senha.",
      );
    } else {
      setModalErro({
        titulo: "Conta criada com sucesso!",
        mensagem: `Bem-vindo(a), ${nome}!\n\nEnviamos um e-mail de confirmação para ${email}. Verifique sua caixa de entrada para ativar sua conta.`,
        cor: "#2A9D8F",
      });
      setIsLogin(true);
      setPassword("");
      setConfirmPassword("");
      setNome("");
      setTelefone("");
      setDataNascimento("");
      setAceitouTermos(false);
    }
    setLoading(false);
  }

  async function recuperarSenha() {
    if (!email)
      return Alert.alert(
        "Aviso",
        "Digite o seu e-mail no campo acima para enviarmos o link de recuperação.",
      );

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "meuappfinancas://reset-password",
    });
    setLoading(false);

    if (error) {
      Alert.alert("Erro", error.message);
    } else {
      Alert.alert(
        "E-mail Enviado! 📩",
        "Verifique a sua caixa de entrada (e o spam). Enviámos um link seguro para redefinir a sua senha.",
      );
      setIsRecuperandoSenha(false);
    }
  }

  const trocarTela = () => {
    if (isRecuperandoSenha) {
      setIsRecuperandoSenha(false);
    } else {
      setIsLogin(!isLogin);
      setPassword("");
      setConfirmPassword("");
      setMostrarSenha(false);
      setMostrarConfirmSenha(false);
    }
  };

  const selecionarModo = (modoLogin: boolean) => {
    setIsRecuperandoSenha(false);
    if (isLogin === modoLogin) return;
    setIsLogin(modoLogin);
    setPassword("");
    setConfirmPassword("");
    setMostrarSenha(false);
    setMostrarConfirmSenha(false);
  };

  const tituloFormulario = isRecuperandoSenha
    ? "Recupere seu acesso"
    : isLogin
      ? "Bem-vindo de volta"
      : "Crie sua conta";
  const descricaoFormulario = isRecuperandoSenha
    ? "Informe seu e-mail e enviaremos um link seguro para você definir uma nova senha."
    : isLogin
      ? "Entre para acompanhar suas contas, metas e próximos passos."
      : "Organize sua vida financeira em poucos minutos.";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, isWide && styles.scrollContentWide]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        >
          <View style={[styles.authShell, isWide && styles.authShellWide]}>
            <View
              style={[
                styles.brandPanel,
                { backgroundColor: theme.header },
                isWide ? styles.brandPanelWide : styles.brandPanelMobile,
              ]}
            >
              <View pointerEvents="none" style={styles.brandDecoration}>
                <View style={styles.brandWaveLarge} />
                <View style={styles.brandWaveMedium} />
                <View style={styles.brandGlow} />
              </View>

              <TouchableOpacity
                style={styles.themeButton}
                onPress={toggleTheme}
                accessibilityRole="button"
                accessibilityLabel={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
              >
                <MaterialIcons name={isDark ? "light-mode" : "dark-mode"} size={20} color="#FFF" />
              </TouchableOpacity>

              <View style={[styles.brandContent, isWide && styles.brandContentWide]}>
                <View style={styles.logoBadge}>
                  <Image
                    source={require("../assets/images/icon.png")}
                    style={styles.logo}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.brandTitle}>FinFlow</Text>
                <Text style={styles.brandEyebrow}>SEU PAINEL FINANCEIRO</Text>
                <Text style={[styles.brandDescription, isWide && styles.brandDescriptionWide]}>
                  Clareza para cuidar do presente e tranquilidade para planejar o futuro.
                </Text>

                {isWide && (
                  <View style={styles.brandBenefits}>
                    <View style={styles.brandBenefitItem}>
                      <MaterialIcons name="account-balance-wallet" size={18} color="#D9FFF0" />
                      <Text style={styles.brandBenefitText}>Contas e movimentações em um só lugar</Text>
                    </View>
                    <View style={styles.brandBenefitItem}>
                      <MaterialIcons name="insights" size={18} color="#D9FFF0" />
                      <Text style={styles.brandBenefitText}>Visão simples do realizado e do previsto</Text>
                    </View>
                    <View style={styles.brandBenefitItem}>
                      <MaterialIcons name="verified-user" size={18} color="#D9FFF0" />
                      <Text style={styles.brandBenefitText}>Seus dados protegidos com segurança</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            <View
              style={[
                styles.formPanel,
                { backgroundColor: theme.surface, borderColor: theme.border },
                isWide ? styles.formPanelWide : styles.formPanelMobile,
              ]}
            >
              <View style={styles.formInner}>
                <View style={styles.formHeaderRow}>
                  <View style={styles.formHeadingCopy}>
                    <Text style={[styles.formTitle, { color: theme.text }]}>{tituloFormulario}</Text>
                    <Text style={[styles.formSubtitle, { color: theme.textMuted }]}>{descricaoFormulario}</Text>
                  </View>
                  {isRecuperandoSenha && (
                    <TouchableOpacity style={[styles.backButton, { backgroundColor: theme.surfaceMuted }]} onPress={trocarTela} accessibilityLabel="Voltar ao login">
                      <MaterialIcons name="arrow-back" size={20} color={theme.primary} />
                    </TouchableOpacity>
                  )}
                </View>

                {!isRecuperandoSenha && (
                  <View style={[styles.modeTabs, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                    <TouchableOpacity
                      style={[styles.modeTab, isLogin && { backgroundColor: theme.surface }]}
                      onPress={() => selecionarModo(true)}
                      accessibilityState={{ selected: isLogin }}
                    >
                      <Text style={[styles.modeTabText, { color: isLogin ? theme.primary : theme.textMuted }]}>Entrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeTab, !isLogin && { backgroundColor: theme.surface }]}
                      onPress={() => selecionarModo(false)}
                      accessibilityState={{ selected: !isLogin }}
                    >
                      <Text style={[styles.modeTabText, { color: !isLogin ? theme.primary : theme.textMuted }]}>Criar conta</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {isRecuperandoSenha && (
                  <View style={[styles.recuperacaoBadge, { backgroundColor: theme.primarySoft, borderColor: `${theme.primary}45` }]}>
                    <View style={[styles.recuperacaoIcon, { backgroundColor: `${theme.primary}1F` }]}>
                      <MaterialIcons name="lock-reset" size={20} color={theme.primary} />
                    </View>
                    <Text style={[styles.recuperacaoTexto, { color: theme.text }]}>O link será enviado para o e-mail cadastrado.</Text>
                  </View>
                )}

                <View style={styles.formFields}>
                  {/* NOME — só no cadastro */}
                  {!isLogin && !isRecuperandoSenha && (
                    <AuthField
                      label="Nome completo"
                      icon="person-outline"
                      theme={theme}
                      placeholder="Como você quer ser chamado"
                      onChangeText={setNome}
                      value={nome}
                      autoCapitalize="words"
                      autoComplete="name"
                      textContentType="name"
                      returnKeyType="next"
                    />
                  )}

                  {/* EMAIL — sempre visível */}
                  <AuthField
                    label="E-mail"
                    icon="mail-outline"
                    theme={theme}
                    placeholder="seuemail@exemplo.com"
                    onChangeText={setEmail}
                    value={email}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType={isRecuperandoSenha ? "send" : "next"}
                    onSubmitEditing={isRecuperandoSenha ? recuperarSenha : undefined}
                  />

                  {!isLogin && !isRecuperandoSenha && (
                    <View style={[styles.twoColumnFields, !isWide && styles.twoColumnFieldsStacked]}>
                      <View style={isWide ? styles.halfField : styles.fullWidthField}>
                        <AuthField
                          label="Telefone com DDD"
                          icon="phone-iphone"
                          theme={theme}
                          placeholder="(11) 99999-9999"
                          onChangeText={(valor) => setTelefone(formatarTelefone(valor))}
                          value={telefone}
                          keyboardType="phone-pad"
                          autoComplete="tel"
                          textContentType="telephoneNumber"
                          maxLength={15}
                          returnKeyType="next"
                        />
                      </View>
                      <View style={isWide ? styles.halfField : styles.fullWidthField}>
                        <AuthField
                          label="Data de nascimento"
                          icon="cake"
                          theme={theme}
                          placeholder="DD/MM/AAAA"
                          onChangeText={(valor) => setDataNascimento(formatarDataNascimento(valor))}
                          value={dataNascimento}
                          keyboardType="number-pad"
                          maxLength={10}
                          returnKeyType="next"
                        />
                      </View>
                    </View>
                  )}

                  {/* SENHA — visível quando não está recuperando */}
                  {!isRecuperandoSenha && (
                    <AuthField
                      label="Senha"
                      icon="lock-outline"
                      theme={theme}
                      placeholder={isLogin ? "Digite sua senha" : "Mínimo de 6 caracteres"}
                      onChangeText={setPassword}
                      value={password}
                      secureTextEntry={!mostrarSenha}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      textContentType={isLogin ? "password" : "newPassword"}
                      returnKeyType={isLogin ? "done" : "next"}
                      onSubmitEditing={isLogin ? signInWithEmail : undefined}
                      trailing={
                        <TouchableOpacity
                          onPress={() => setMostrarSenha((valor) => !valor)}
                          style={styles.olhoBtn}
                          accessibilityLabel={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                        >
                          <MaterialIcons name={mostrarSenha ? "visibility-off" : "visibility"} size={20} color={theme.textMuted} />
                        </TouchableOpacity>
                      }
                    />
                  )}

                  {/* CONFIRMAR SENHA — só no cadastro */}
                  {!isLogin && !isRecuperandoSenha && (
                    <AuthField
                      label="Confirme sua senha"
                      icon="verified-user"
                      theme={theme}
                      placeholder="Digite novamente"
                      onChangeText={setConfirmPassword}
                      value={confirmPassword}
                      secureTextEntry={!mostrarConfirmSenha}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      returnKeyType="done"
                      onSubmitEditing={signUpWithEmail}
                      error={confirmPassword.length > 0 && password !== confirmPassword}
                      success={confirmPassword.length > 0 && password === confirmPassword}
                      trailing={
                        <TouchableOpacity
                          onPress={() => setMostrarConfirmSenha((valor) => !valor)}
                          style={styles.olhoBtn}
                          accessibilityLabel={mostrarConfirmSenha ? "Ocultar confirmação de senha" : "Mostrar confirmação de senha"}
                        >
                          <MaterialIcons name={mostrarConfirmSenha ? "visibility-off" : "visibility"} size={20} color={theme.textMuted} />
                        </TouchableOpacity>
                      }
                      helper={confirmPassword.length > 0 ? (
                        <View style={styles.passwordFeedback}>
                          <MaterialIcons
                            name={password === confirmPassword ? "check-circle" : "error-outline"}
                            size={14}
                            color={password === confirmPassword ? theme.primary : FinFlowColors.red}
                          />
                          <Text style={[styles.passwordFeedbackText, { color: password === confirmPassword ? theme.primary : FinFlowColors.red }]}>
                            {password === confirmPassword ? "As senhas conferem" : "As senhas não conferem"}
                          </Text>
                        </View>
                      ) : undefined}
                    />
                  )}
                </View>

                {/* ESQUECI A SENHA — só no login */}
                {isLogin && !isRecuperandoSenha && (
                  <TouchableOpacity style={styles.forgotButton} onPress={() => setIsRecuperandoSenha(true)}>
                    <MaterialIcons name="lock-reset" size={16} color={theme.primary} />
                    <Text style={[styles.forgotButtonText, { color: theme.primary }]}>Esqueci minha senha</Text>
                  </TouchableOpacity>
                )}

                {/* CONSENTIMENTO LGPD — exibido apenas no cadastro */}
                {!isLogin && !isRecuperandoSenha && (
                  <View style={[styles.consentimentoContainer, { backgroundColor: theme.primarySoft, borderColor: `${theme.primary}38` }]}>
                    <TouchableOpacity
                      style={styles.consentimentoCheckRow}
                      onPress={() => setAceitouTermos((valor) => !valor)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: aceitouTermos }}
                    >
                      <MaterialIcons
                        name={aceitouTermos ? "check-box" : "check-box-outline-blank"}
                        size={24}
                        color={aceitouTermos ? theme.primary : theme.textMuted}
                      />
                      <Text style={[styles.consentimentoCheckTexto, { color: theme.text }]}>Li e concordo com os documentos do FinFlow.</Text>
                    </TouchableOpacity>
                    <Text style={[styles.consentimentoTexto, { color: theme.textMuted }]}>
                      Consulte nossos{" "}
                      <Text
                        style={[styles.consentimentoLink, { color: theme.primary }]}
                        onPress={() => WebBrowser.openBrowserAsync("https://finflowa.github.io/finflow-legal/#termos")}
                      >
                        Termos de Uso
                      </Text>
                      {" "}e{" "}
                      <Text
                        style={[styles.consentimentoLink, { color: theme.primary }]}
                        onPress={() => WebBrowser.openBrowserAsync("https://finflowa.github.io/finflow-legal/#privacidade")}
                      >
                        Política de Privacidade
                      </Text>
                      , incluindo o tratamento dos seus dados conforme a LGPD.
                    </Text>
                  </View>
                )}

                {/* BOTÃO PRINCIPAL */}
                <TouchableOpacity
                  style={[
                    styles.mainButton,
                    { backgroundColor: theme.primary },
                    (loading || !!bloqueadoAte) && [styles.buttonDisabled, { backgroundColor: theme.border }],
                  ]}
                  onPress={
                    isRecuperandoSenha
                      ? recuperarSenha
                      : isLogin
                        ? signInWithEmail
                        : signUpWithEmail
                  }
                  disabled={loading || !!bloqueadoAte}
                  activeOpacity={0.84}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : bloqueadoAte ? (
                    <>
                      <MaterialIcons name="timer" size={19} color={theme.textMuted} />
                      <Text style={[styles.mainButtonText, { color: theme.textMuted }]}>Aguarde {segundosRestantes}s</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.mainButtonText}>
                        {isRecuperandoSenha
                          ? "Enviar link seguro"
                          : isLogin
                            ? "Entrar no FinFlow"
                            : "Criar minha conta"}
                      </Text>
                      <MaterialIcons name={isRecuperandoSenha ? "send" : "arrow-forward"} size={19} color="#FFF" />
                    </>
                  )}
                </TouchableOpacity>

                {/* TROCAR TELA */}
                <TouchableOpacity style={styles.switchButton} onPress={trocarTela}>
                  <Text style={[styles.switchButtonPrefix, { color: theme.textMuted }]}>
                    {isRecuperandoSenha
                      ? "Lembrou sua senha? "
                      : isLogin
                        ? "Ainda não tem uma conta? "
                        : "Já possui uma conta? "}
                    <Text style={[styles.switchButtonText, { color: theme.primary }]}>
                      {isRecuperandoSenha ? "Voltar ao login" : isLogin ? "Cadastre-se" : "Faça login"}
                    </Text>
                  </Text>
                </TouchableOpacity>

                <View style={[styles.legalDivider, { backgroundColor: theme.border }]} />

                {/* BOTÕES LEGAIS — sempre visíveis */}
                <View style={styles.legalBtnRow}>
                  <TouchableOpacity
                    style={styles.legalBtn}
                    onPress={() => WebBrowser.openBrowserAsync("https://finflowa.github.io/finflow-legal/#privacidade")}
                  >
                    <MaterialIcons name="privacy-tip" size={14} color={theme.primary} />
                    <Text style={[styles.legalBtnText, { color: theme.primary }]}>Privacidade</Text>
                  </TouchableOpacity>
                  <View style={[styles.legalSeparador, { backgroundColor: theme.border }]} />
                  <TouchableOpacity
                    style={styles.legalBtn}
                    onPress={() => WebBrowser.openBrowserAsync("https://finflowa.github.io/finflow-legal/#termos")}
                  >
                    <MaterialIcons name="description" size={14} color={theme.primary} />
                    <Text style={[styles.legalBtnText, { color: theme.primary }]}>Termos de Uso</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
      </ScrollView>

        {modalErro && (
          <Modal animationType="fade" transparent visible onRequestClose={() => setModalErro(null)} statusBarTranslucent>
            <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
              <View style={[styles.modalCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]} accessibilityViewIsModal>
                <TouchableOpacity style={[styles.modalClose, { backgroundColor: theme.surfaceMuted }]} onPress={() => setModalErro(null)} accessibilityLabel="Fechar aviso">
                  <MaterialIcons name="close" size={19} color={theme.textMuted} />
                </TouchableOpacity>
                <View style={[styles.modalIcon, { backgroundColor: `${modalErro.cor ?? FinFlowColors.red}1F` }]}>
                  <MaterialIcons
                    name={modalErro.cor === "#2A9D8F" ? "check-circle" : "error-outline"}
                    size={34}
                    color={modalErro.cor ?? FinFlowColors.red}
                  />
                </View>
                <Text style={[styles.modalTitle, { color: theme.text }]}>{modalErro.titulo}</Text>
                <Text style={[styles.modalMessage, { color: theme.textMuted }]}>{modalErro.mensagem}</Text>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: modalErro.cor ?? FinFlowColors.red }]}
                  onPress={() => setModalErro(null)}
                  activeOpacity={0.84}
                >
                  <Text style={styles.modalButtonText}>Entendi</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  scrollContentWide: { justifyContent: "center", paddingHorizontal: 28, paddingVertical: 34 },
  authShell: { width: "100%", alignSelf: "center" },
  authShellWide: {
    maxWidth: 1100,
    minHeight: 700,
    flexDirection: "row",
    borderRadius: 32,
    ...FinFlowShadow,
  },
  brandPanel: { position: "relative", overflow: "hidden", justifyContent: "center" },
  brandPanelMobile: {
    minHeight: 258,
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 62,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },
  brandPanelWide: {
    flex: 0.88,
    minHeight: 700,
    paddingHorizontal: 44,
    paddingVertical: 52,
    borderTopLeftRadius: 32,
    borderBottomLeftRadius: 32,
  },
  brandDecoration: { ...StyleSheet.absoluteFillObject },
  brandWaveLarge: {
    position: "absolute",
    width: 520,
    height: 250,
    right: -230,
    top: 72,
    borderRadius: 260,
    backgroundColor: "rgba(119, 245, 187, 0.16)",
    transform: [{ rotate: "-13deg" }],
  },
  brandWaveMedium: {
    position: "absolute",
    width: 430,
    height: 190,
    left: -210,
    bottom: -28,
    borderRadius: 220,
    backgroundColor: "rgba(7, 83, 72, 0.28)",
    transform: [{ rotate: "12deg" }],
  },
  brandGlow: {
    position: "absolute",
    width: 210,
    height: 210,
    right: -52,
    bottom: -80,
    borderRadius: 105,
    backgroundColor: "rgba(217, 255, 240, 0.10)",
  },
  themeButton: {
    position: "absolute",
    zIndex: 4,
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4, 49, 42, 0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  brandContent: { zIndex: 2, alignItems: "center" },
  brandContentWide: { alignItems: "flex-start" },
  logoBadge: {
    width: 86,
    height: 86,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.91)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
    shadowColor: "#003C31",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  logo: { width: 72, height: 72 },
  brandTitle: { color: "#FFF", fontSize: 32, fontWeight: "900", letterSpacing: -0.7 },
  brandEyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "800", letterSpacing: 1.6, marginTop: 2 },
  brandDescription: { maxWidth: 390, color: "rgba(255,255,255,0.90)", fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 13 },
  brandDescriptionWide: { textAlign: "left" },
  brandBenefits: { width: "100%", marginTop: 34, gap: 15 },
  brandBenefitItem: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandBenefitText: { flex: 1, color: "rgba(255,255,255,0.86)", fontSize: 13, lineHeight: 19 },
  formPanel: { borderWidth: 1 },
  formPanelMobile: {
    zIndex: 3,
    marginTop: -38,
    marginHorizontal: 14,
    paddingHorizontal: 21,
    paddingTop: 26,
    paddingBottom: 22,
    borderRadius: 26,
    ...FinFlowShadow,
  },
  formPanelWide: {
    flex: 1.12,
    minHeight: 700,
    justifyContent: "center",
    paddingHorizontal: 46,
    paddingVertical: 42,
    borderLeftWidth: 0,
    borderTopRightRadius: 32,
    borderBottomRightRadius: 32,
  },
  formInner: { width: "100%", maxWidth: 520, alignSelf: "center" },
  formHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 20 },
  formHeadingCopy: { flex: 1 },
  formTitle: { fontSize: 27, lineHeight: 33, fontWeight: "900", letterSpacing: -0.6 },
  formSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  modeTabs: { flexDirection: "row", padding: 4, borderRadius: 16, borderWidth: 1, marginBottom: 22 },
  modeTab: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modeTabText: { fontSize: 13, fontWeight: "800" },
  recuperacaoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  recuperacaoIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  recuperacaoTexto: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  formFields: { width: "100%" },
  fieldGroup: { width: "100%", marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "700", marginBottom: 7, marginLeft: 2 },
  inputContainer: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: FinFlowRadius.medium,
  },
  inputContainerFocused: {
    shadowColor: FinFlowColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 1,
  },
  inputIconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginLeft: 7 },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 14, fontSize: 15 },
  olhoBtn: { width: 48, minHeight: 52, alignItems: "center", justifyContent: "center" },
  twoColumnFields: { width: "100%", flexDirection: "row", gap: 12 },
  twoColumnFieldsStacked: { flexDirection: "column", gap: 0 },
  halfField: { flex: 1, minWidth: 0 },
  fullWidthField: { width: "100%", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  passwordFeedback: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, marginLeft: 3 },
  passwordFeedbackText: { fontSize: 11, fontWeight: "600" },
  forgotButton: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 5, marginTop: -2, marginBottom: 4, paddingVertical: 6 },
  forgotButtonText: { fontSize: 12, fontWeight: "700" },
  consentimentoContainer: { padding: 13, borderRadius: 16, borderWidth: 1, marginTop: 4, marginBottom: 2 },
  consentimentoCheckRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 7 },
  consentimentoCheckTexto: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  consentimentoTexto: { fontSize: 11, lineHeight: 17 },
  consentimentoLink: { fontWeight: "700", textDecorationLine: "underline" },
  mainButton: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
    borderRadius: FinFlowRadius.medium,
    marginTop: 16,
    shadowColor: FinFlowColors.primaryDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 3,
  },
  buttonDisabled: { shadowOpacity: 0, elevation: 0 },
  mainButtonText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  switchButton: { marginTop: 18, alignItems: "center", paddingVertical: 4 },
  switchButtonPrefix: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  switchButtonText: { fontWeight: "800" },
  legalDivider: { height: 1, marginTop: 19, marginBottom: 8 },
  legalBtnRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  legalBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  legalBtnText: { fontSize: 11, fontWeight: "700" },
  legalSeparador: { width: 1, height: 14 },
  modalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22 },
  modalCard: { width: "100%", maxWidth: 420, padding: 24, paddingTop: 30, borderRadius: 24, borderWidth: 1, ...FinFlowShadow },
  modalClose: { position: "absolute", top: 12, right: 12, zIndex: 2, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  modalIcon: { alignSelf: "center", width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  modalTitle: { paddingHorizontal: 16, fontSize: 20, lineHeight: 25, fontWeight: "800", textAlign: "center", marginBottom: 9 },
  modalMessage: { fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 22 },
  modalButton: { minHeight: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  modalButtonText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
});
