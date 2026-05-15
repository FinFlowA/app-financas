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
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    const { error } = await supabase.auth.signInWithPassword({
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
      router.replace("/(tabs)");
    }
    setLoading(false);
  }

  async function signUpWithEmail() {
    if (!nome || !email || !password)
      return Alert.alert(
        "Aviso",
        "Preencha todos os campos obrigatórios (Nome, E-mail e Senha).",
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

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        emailRedirectTo: "meuappfinancas://email-confirmed",
        data: {
          nome_usuario: nome,
          telefone: telefone.trim(),
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
      Alert.alert(
        "Conta Criada com Sucesso!",
        `Bem-vindo(a), ${nome}!\n\nUm e-mail de confirmação foi enviado para ${email}. Verifique sua caixa de entrada e confirme para ativar sua conta.`,
      );
      setIsLogin(true);
      setPassword("");
      setConfirmPassword("");
      setNome("");
      setTelefone("");
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* LOGO */}
        <View style={styles.iconContainer}>
          <Image
            source={require("../assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>FinFlow</Text>
        <Text style={styles.subtitle}>
          {isRecuperandoSenha
            ? "Recuperação de Acesso"
            : isLogin
              ? "Bem-vindo de volta!"
              : "Crie sua conta para começar"}
        </Text>

        {isRecuperandoSenha && (
          <View style={styles.recuperacaoBadge}>
            <MaterialIcons name="lock-reset" size={16} color="#E76F51" />
            <Text style={styles.recuperacaoTexto}>Recuperação de senha</Text>
          </View>
        )}

        {/* NOME — só no cadastro */}
        {!isLogin && !isRecuperandoSenha && (
          <View style={styles.inputContainer}>
            <MaterialIcons
              name="person"
              size={20}
              color="#666"
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Seu Nome (Ex: Luis)"
              placeholderTextColor="#999"
              onChangeText={setNome}
              value={nome}
              autoCapitalize="words"
            />
          </View>
        )}

        {/* EMAIL — sempre visível */}
        <View style={styles.inputContainer}>
          <MaterialIcons
            name="email"
            size={20}
            color="#666"
            style={styles.inputIcon}
          />
          <TextInput
            style={styles.input}
            placeholder="Seu E-mail"
            placeholderTextColor="#999"
            onChangeText={setEmail}
            value={email}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        {/* TELEFONE — só no cadastro */}
        {!isLogin && !isRecuperandoSenha && (
          <View style={styles.inputContainer}>
            <MaterialIcons
              name="phone"
              size={20}
              color="#666"
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Telefone (Ex: 11 99999-9999)"
              placeholderTextColor="#999"
              onChangeText={(v) => setTelefone(formatarTelefone(v))}
              value={telefone}
              keyboardType="phone-pad"
            />
          </View>
        )}

        {/* SENHA — visível quando não está recuperando */}
        {!isRecuperandoSenha && (
          <View style={styles.inputContainer}>
            <MaterialIcons
              name="lock"
              size={20}
              color="#666"
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Sua Senha"
              placeholderTextColor="#999"
              onChangeText={setPassword}
              value={password}
              secureTextEntry={!mostrarSenha}
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => setMostrarSenha((v) => !v)}
              style={styles.olhoBtn}
            >
              <MaterialIcons
                name={mostrarSenha ? "visibility-off" : "visibility"}
                size={20}
                color="#666"
              />
            </TouchableOpacity>
          </View>
        )}

        {/* CONFIRMAR SENHA — só no cadastro */}
        {!isLogin && !isRecuperandoSenha && (
          <>
            <View
              style={[
                styles.inputContainer,
                confirmPassword.length > 0 &&
                  password !== confirmPassword &&
                  styles.inputContainerErro,
              ]}
            >
              <MaterialIcons
                name="lock-outline"
                size={20}
                color="#666"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirmar Senha"
                placeholderTextColor="#999"
                onChangeText={setConfirmPassword}
                value={confirmPassword}
                secureTextEntry={!mostrarConfirmSenha}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setMostrarConfirmSenha((v) => !v)}
                style={styles.olhoBtn}
              >
                <MaterialIcons
                  name={mostrarConfirmSenha ? "visibility-off" : "visibility"}
                  size={20}
                  color="#666"
                />
              </TouchableOpacity>
            </View>
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <Text style={styles.erroSenha}>As senhas não conferem</Text>
            )}
            {confirmPassword.length > 0 && password === confirmPassword && (
              <Text style={styles.senhaOk}>Senhas conferem ✓</Text>
            )}
          </>
        )}

        {/* BOTÃO PRINCIPAL */}
        <TouchableOpacity
          style={[
            styles.mainButton,
            (loading || !!bloqueadoAte) && styles.buttonDisabled,
          ]}
          onPress={
            isRecuperandoSenha
              ? recuperarSenha
              : isLogin
                ? signInWithEmail
                : signUpWithEmail
          }
          disabled={loading || !!bloqueadoAte}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : bloqueadoAte ? (
            <Text style={styles.mainButtonText}>
              Aguarde {segundosRestantes}s
            </Text>
          ) : (
            <Text style={styles.mainButtonText}>
              {isRecuperandoSenha
                ? "Enviar Link de Recuperação"
                : isLogin
                  ? "Entrar"
                  : "Criar Conta"}
            </Text>
          )}
        </TouchableOpacity>

        {/* ESQUECI A SENHA — só no login */}
        {isLogin && !isRecuperandoSenha && (
          <TouchableOpacity
            style={{ marginTop: 12, alignItems: "center" }}
            onPress={() => setIsRecuperandoSenha(true)}
          >
            <Text
              style={{ color: "#E76F51", fontSize: 14, fontWeight: "bold" }}
            >
              Esqueci minha senha
            </Text>
          </TouchableOpacity>
        )}

        {/* TROCAR TELA */}
        <TouchableOpacity style={styles.switchButton} onPress={trocarTela}>
          <Text style={styles.switchButtonText}>
            {isRecuperandoSenha
              ? "Voltar para o Login"
              : isLogin
                ? "Não tem uma conta? Crie aqui."
                : "Já tem uma conta? Faça login."}
          </Text>
        </TouchableOpacity>

        {/* CONSENTIMENTO LGPD — exibido apenas no cadastro */}
        {!isLogin && !isRecuperandoSenha && (
          <View style={styles.consentimentoContainer}>
            <Text style={styles.consentimentoTexto}>
              Ao criar uma conta, você concorda com nossos{" "}
              <Text
                style={styles.consentimentoLink}
                onPress={() => WebBrowser.openBrowserAsync("https://luishpalacio.github.io/finflow-docs/terms-of-use")}
              >
                Termos de Uso
              </Text>
              {" "}e{" "}
              <Text
                style={styles.consentimentoLink}
                onPress={() => WebBrowser.openBrowserAsync("https://luishpalacio.github.io/finflow-docs/privacy-policy")}
              >
                Política de Privacidade
              </Text>
              , incluindo o tratamento dos seus dados conforme a LGPD.
            </Text>
          </View>
        )}
      </ScrollView>

      {modalErro && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalErro(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", backgroundColor: "#1E1E1E", borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: modalErro.cor ?? "#E76F51" }}>
              <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>{modalErro.titulo}</Text>
              <Text style={{ color: "#AAAAAA", fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 }}>{modalErro.mensagem}</Text>
              <TouchableOpacity
                style={{ backgroundColor: modalErro.cor ?? "#E76F51", paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
                onPress={() => setModalErro(null)}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 48,
    paddingHorizontal: 28,
    paddingBottom: 36,
  },
  iconContainer: { alignItems: "center", marginBottom: 8 },
  logo: { width: 220, height: 220 },
  recuperacaoBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#E76F5122",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 20,
    alignSelf: "center",
  },
  recuperacaoTexto: { color: "#E76F51", fontSize: 13, fontWeight: "600" },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#FFF",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: "#AAA",
    textAlign: "center",
    marginBottom: 28,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2C",
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#444",
  },
  inputContainerErro: {
    borderColor: "#E76F51",
  },
  inputIcon: { paddingHorizontal: 15 },
  input: { flex: 1, paddingVertical: 15, color: "#FFF", fontSize: 16 },
  olhoBtn: { paddingHorizontal: 15, paddingVertical: 15 },
  erroSenha: {
    color: "#E76F51",
    fontSize: 12,
    marginTop: -10,
    marginBottom: 12,
    marginLeft: 5,
  },
  senhaOk: {
    color: "#2A9D8F",
    fontSize: 12,
    marginTop: -10,
    marginBottom: 12,
    marginLeft: 5,
  },
  mainButton: {
    backgroundColor: "#2A9D8F",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  buttonDisabled: { backgroundColor: "#444" },
  mainButtonText: { color: "#FFF", fontSize: 16, fontWeight: "bold" },
  switchButton: { marginTop: 20, alignItems: "center" },
  switchButtonText: { color: "#F4A261", fontSize: 14, fontWeight: "600" },
  consentimentoContainer: { marginTop: 20, paddingHorizontal: 4 },
  consentimentoTexto: { color: "#888", fontSize: 12, textAlign: "center", lineHeight: 18 },
  consentimentoLink: { color: "#2A9D8F", textDecorationLine: "underline" },
});
