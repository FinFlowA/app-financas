import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as Updates from "expo-updates";
import React, {
  Component,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { pedirPermissaoNotificacoes } from "../lib/notifications";
import {
  type TipoPlano,
  type LimitesPlano,
  LIMITES_PLANOS,
  dentroDoLimite,
  msgLimiteAtingido,
  nomePlano,
} from "../lib/planos";
import { verificarCotaIA, consumirAcaoIA, msgCotaEsgotada } from "../lib/ia-limites";

// ERROR BOUNDARY
class ErrorBoundary extends Component<{ children: ReactNode }, { temErro: boolean }> {
  state = { temErro: false };
  static getDerivedStateFromError() { return { temErro: true }; }
  render() {
    if (this.state.temErro) {
      return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#121212", padding: 30 }}>
          <MaterialIcons name="error-outline" size={64} color="#E76F51" />
          <Text style={{ color: "#FFF", fontSize: 20, fontWeight: "bold", marginTop: 16, textAlign: "center" }}>
            Algo deu errado
          </Text>
          <Text style={{ color: "#AAA", fontSize: 14, marginTop: 8, textAlign: "center" }}>
            Feche e abra o aplicativo novamente. Se o problema persistir, contacte o suporte.
          </Text>
          <TouchableOpacity
            style={{ marginTop: 24, backgroundColor: "#2A9D8F", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}
            onPress={() => this.setState({ temErro: false })}
          >
            <Text style={{ color: "#FFF", fontWeight: "bold" }}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export const ThemeContext = createContext({
  isDark: false,
  toggleTheme: async () => {},
  isBiometricEnabled: false,
  toggleBiometric: async (_value: boolean) => {},
  session: null as any,
  showToast: (_msg: string, _tipo?: "success" | "error" | "info") => {},
  notificacoesAtivas: false,
  toggleNotificacoes: async (_value: boolean) => {},
  // Sistema de planos
  plano: "free" as TipoPlano,
  setPlano: (_plano: TipoPlano) => {},
  limites: LIMITES_PLANOS.free as LimitesPlano,
  /** Verifica se pode criar mais itens. Se não puder, exibe modal de upgrade e retorna false */
  verificarLimite: (_tipo: keyof LimitesPlano, _qtdAtual: number): boolean => true,
  /** Mostra modal de limite com mensagem customizada */
  mostrarModalLimite: (_mensagem: string, _planoNecessario?: TipoPlano) => {},
  // Controle de cota da IA
  iaAcoesHoje: 0,
  /** Tenta consumir 1 ação de IA. Retorna false se cota esgotada (e exibe modal) */
  tentarAcaoIA: async (): Promise<boolean> => false,
});

export const useAppTheme = () => useContext(ThemeContext);

export default function RootLayout() {
  const systemTheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();

  const [isDark, setIsDark] = useState(systemTheme === "dark");
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [notificacoesAtivas, setNotificacoesAtivas] = useState(false);
  const [modalAtualizacao, setModalAtualizacao] = useState<"baixando" | "pronta" | null>(null);

  // Sistema de planos
  const [plano, setPlanoState] = useState<TipoPlano>("free");
  const [iaAcoesHoje, setIaAcoesHoje] = useState(0);
  const [modalLimite, setModalLimite] = useState<{
    visivel: boolean;
    mensagem: string;
    planoNecessario?: TipoPlano;
  }>({ visivel: false, mensagem: "" });
  const [modalDowngrade, setModalDowngrade] = useState<{
    visivel: boolean;
    bloqueados: { tipo: string; nome: string }[];
  }>({ visivel: false, bloqueados: [] });

  // Toast
  const [toastMsg, setToastMsg] = useState("");
  const [toastTipo, setToastTipo] = useState<"success" | "error" | "info">("success");
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, tipo: "success" | "error" | "info" = "success") => {
    setToastMsg(msg);
    setToastTipo(tipo);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastOpacity.setValue(1);
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, 1800);
  };

  // Intercepta deep links do email (recuperação de senha e confirmação de conta)
  const url = Linking.useURL();
  useEffect(() => {
    if (!url) return;

    // Fluxo PKCE (Supabase moderno): code= nos query params
    try {
      const parsed = new URL(url);
      const code = parsed.searchParams.get("code");
      if (code) {
        supabase.auth.exchangeCodeForSession(code).catch((e) =>
          console.log("Erro ao trocar código:", e)
        );
        return;
      }
    } catch {}

    // Fluxo implícito (legado): tokens no fragmento #
    const fragment = url.split("#")[1];
    if (!fragment) return;
    const params = Object.fromEntries(new URLSearchParams(fragment));
    if (params.access_token && params.refresh_token) {
      supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      }).then(() => {
        if (params.type === "signup") {
          router.replace("/email-confirmed" as any);
        }
      });
    }
  }, [url]);

  // Verifica atualizações OTA ao abrir o app
  useEffect(() => {
    async function verificarAtualizacao() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          setModalAtualizacao("baixando");
          await Updates.fetchUpdateAsync();
          setModalAtualizacao("pronta");
        }
      } catch (error) {
        console.log("Erro ao buscar atualizações:", error);
      }
    }
    if (!__DEV__) verificarAtualizacao();
  }, []);

  // Inicializa sessão e escuta mudanças de autenticação
  useEffect(() => {
    carregarConfiguracoes();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/reset-password" as any);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load per-user notification preference
  useEffect(() => {
    if (!session?.user?.id) return;
    AsyncStorage.getItem(`@notificacoes_enabled_${session.user.id}`).then((val) => {
      setNotificacoesAtivas(val === "true");
    });
  }, [session?.user?.id]);

  // Carrega plano e cota de IA do usuário
  useEffect(() => {
    if (!session?.user?.id) return;
    const uid = session.user.id;

    AsyncStorage.getItem(`@plano_usuario_${uid}`).then((val) => {
      if (val === "smart" || val === "premium" || val === "free") {
        setPlanoState(val);
      }
    });

    verificarCotaIA(uid, plano).then(({ usadas }) => {
      setIaAcoesHoje(usadas);
    });
  }, [session?.user?.id]);

  // Solicita permissão de notificação na primeira sessão do usuário neste dispositivo
  useEffect(() => {
    if (!session) return;
    const chave = `@notificacoes_perguntado_${session.user.id}`;
    AsyncStorage.getItem(chave).then((val) => {
      if (val !== null) return;
      AsyncStorage.setItem(chave, "true");
      Alert.alert(
        "🔔 Notificações",
        "Deseja receber lembretes de lançamentos vencendo e avisos semanais para manter suas finanças em dia?",
        [
          { text: "Não, obrigado", style: "cancel" },
          {
            text: "Sim, quero!",
            onPress: async () => {
              const concedida = await pedirPermissaoNotificacoes();
              if (concedida) {
                setNotificacoesAtivas(true);
                await AsyncStorage.setItem(`@notificacoes_enabled_${session.user.id}`, "true");
                Alert.alert("Ativado!", "Você receberá notificações sobre seus lançamentos.");
              }
            },
          },
        ]
      );
    });
  }, [session?.user?.id]);

  // Guarda de rotas: redireciona conforme estado de autenticação
  useEffect(() => {
    if (!isReady || !isAuthReady) return;

    const seg = segments[0] as string;
    const inAuthGroup = seg === "login";
    const inSpecialFlow = seg === "reset-password" || seg === "email-confirmed";

    if (!session && !inAuthGroup && !inSpecialFlow) {
      router.replace("/login");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, isReady, isAuthReady, segments]);

  const setPlano = async (novoPlano: TipoPlano) => {
    const planOrder: Record<TipoPlano, number> = { free: 0, smart: 1, premium: 2 };
    const eDowngrade = planOrder[novoPlano] < planOrder[plano];
    const eUpgrade = planOrder[novoPlano] > planOrder[plano];
    const uid = session?.user?.id;

    if (eUpgrade && uid) {
      // Desbloquear todos os itens que foram bloqueados por downgrade anterior
      await Promise.all([
        supabase.from("contas").update({ bloqueado_plano: false }).eq("user_id", uid).eq("bloqueado_plano", true),
        supabase.from("cartoes").update({ bloqueado_plano: false }).eq("user_id", uid).eq("bloqueado_plano", true),
        supabase.from("caixinhas").update({ bloqueado_plano: false }).eq("user_id", uid).eq("bloqueado_plano", true),
        supabase.from("categorias").update({ bloqueado_plano: false }).eq("user_id", uid).eq("bloqueado_plano", true),
      ]);
    }

    if (eDowngrade && uid) {
      const limites = LIMITES_PLANOS[novoPlano];
      const bloqueados: { tipo: string; nome: string }[] = [];

      if (limites.contas > 0) {
        const { data: contas } = await supabase.from("contas").select("id, nome").eq("user_id", uid).eq("arquivado", false).eq("bloqueado_plano", false).order("id");
        if (contas && contas.length > limites.contas) {
          for (const c of contas.slice(limites.contas)) {
            await supabase.from("contas").update({ bloqueado_plano: true }).eq("id", c.id);
            bloqueados.push({ tipo: "Conta", nome: c.nome });
          }
        }
      }

      if (limites.cartoes > 0) {
        const { data: cartoes } = await supabase.from("cartoes").select("id, nome").eq("user_id", uid).eq("ativo", true).eq("bloqueado_plano", false).order("id");
        if (cartoes && cartoes.length > limites.cartoes) {
          for (const c of cartoes.slice(limites.cartoes)) {
            await supabase.from("cartoes").update({ bloqueado_plano: true }).eq("id", c.id);
            bloqueados.push({ tipo: "Cartão", nome: c.nome });
          }
        }
      }

      if (limites.caixinhas > 0) {
        const { data: caixinhas } = await supabase.from("caixinhas").select("id, nome").eq("user_id", uid).eq("arquivado", false).eq("bloqueado_plano", false).order("id");
        if (caixinhas && caixinhas.length > limites.caixinhas) {
          for (const c of caixinhas.slice(limites.caixinhas)) {
            await supabase.from("caixinhas").update({ bloqueado_plano: true }).eq("id", c.id);
            bloqueados.push({ tipo: "Caixinha", nome: c.nome });
          }
        }
      }

      if (limites.categoriasDespesa > 0) {
        const { data: catDesp } = await supabase.from("categorias").select("id, nome").eq("user_id", uid).eq("tipo", "despesa").eq("ativa", true).eq("bloqueado_plano", false).order("id");
        if (catDesp && catDesp.length > limites.categoriasDespesa) {
          for (const c of catDesp.slice(limites.categoriasDespesa)) {
            await supabase.from("categorias").update({ bloqueado_plano: true }).eq("id", c.id);
            bloqueados.push({ tipo: "Categoria", nome: c.nome });
          }
        }
      }

      if (limites.categoriasReceita > 0) {
        const { data: catRec } = await supabase.from("categorias").select("id, nome").eq("user_id", uid).eq("tipo", "receita").eq("ativa", true).eq("bloqueado_plano", false).order("id");
        if (catRec && catRec.length > limites.categoriasReceita) {
          for (const c of catRec.slice(limites.categoriasReceita)) {
            await supabase.from("categorias").update({ bloqueado_plano: true }).eq("id", c.id);
            bloqueados.push({ tipo: "Categoria", nome: c.nome });
          }
        }
      }

      if (bloqueados.length > 0) {
        setModalDowngrade({ visivel: true, bloqueados });
      }
    }

    setPlanoState(novoPlano);
    if (uid) {
      await AsyncStorage.setItem(`@plano_usuario_${uid}`, novoPlano);
    }
  };

  const verificarLimite = (tipo: keyof LimitesPlano, qtdAtual: number): boolean => {
    const limite = LIMITES_PLANOS[plano][tipo] as number;
    if (dentroDoLimite(limite, qtdAtual)) return true;

    const msg = msgLimiteAtingido(tipo, plano);
    const proxPlano: TipoPlano = plano === "free" ? "smart" : "premium";
    setModalLimite({ visivel: true, mensagem: msg, planoNecessario: proxPlano });
    return false;
  };

  const mostrarModalLimite = (mensagem: string, planoNecessario?: TipoPlano) => {
    setModalLimite({ visivel: true, mensagem, planoNecessario });
  };

  const tentarAcaoIA = async (): Promise<boolean> => {
    if (!session?.user?.id) return false;
    const uid = session.user.id;

    const resultado = await consumirAcaoIA(uid, plano);
    if (!resultado) {
      const msg = msgCotaEsgotada(plano);
      const proxPlano: TipoPlano = plano === "free" ? "smart" : plano === "smart" ? "premium" : "premium";
      setModalLimite({ visivel: true, mensagem: msg, planoNecessario: proxPlano !== plano ? proxPlano : undefined });
      return false;
    }

    // Atualiza contador local
    verificarCotaIA(uid, plano).then(({ usadas }) => setIaAcoesHoje(usadas));
    return true;
  };

  const carregarConfiguracoes = async () => {
    try {
      const temaSalvo = await AsyncStorage.getItem("@dark_mode");
      if (temaSalvo !== null) setIsDark(temaSalvo === "true");

      const biometriaSalva = await AsyncStorage.getItem("@biometric_enabled");
      const biometriaAtiva = biometriaSalva === "true";
      setIsBiometricEnabled(biometriaAtiva);

      if (biometriaAtiva) {
        verificarBiometria();
      } else {
        setIsUnlocked(true);
      }
    } catch {
      setIsUnlocked(true);
    } finally {
      setIsReady(true);
    }
  };

  const toggleNotificacoes = async (value: boolean) => {
    if (value) {
      const concedida = await pedirPermissaoNotificacoes();
      if (!concedida) {
        Alert.alert("Permissão Negada", "Para ativar as notificações, habilite-as nas configurações do seu celular.");
        return;
      }
    }
    setNotificacoesAtivas(value);
    await AsyncStorage.setItem(`@notificacoes_enabled_${session?.user?.id}`, value ? "true" : "false");
  };

  const verificarBiometria = async () => {
    const temHardware = await LocalAuthentication.hasHardwareAsync();
    const temBiometria = await LocalAuthentication.isEnrolledAsync();
    if (temHardware && temBiometria) {
      autenticar();
    } else {
      setIsUnlocked(true);
    }
  };

  const autenticar = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Acesse sua Carteira",
      fallbackLabel: "Usar senha padrão",
    });
    if (result.success) setIsUnlocked(true);
  };

  const toggleTheme = async () => {
    const newValue = !isDark;
    setIsDark(newValue);
    await AsyncStorage.setItem("@dark_mode", newValue ? "true" : "false");
  };

  const toggleBiometric = async (value: boolean) => {
    setIsBiometricEnabled(value);
    await AsyncStorage.setItem("@biometric_enabled", value ? "true" : "false");
    if (value) setIsUnlocked(true);
  };

  if (!isReady || !isAuthReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: isDark ? "#121212" : "#FFF" }}>
        <ActivityIndicator size="large" color="#2A9D8F" />
      </View>
    );
  }

  if (session && isBiometricEnabled && !isUnlocked) {
    return (
      <View style={[styles.lockScreen, { backgroundColor: isDark ? "#121212" : "#FFF" }]}>
        <MaterialIcons name="lock" size={80} color="#2A9D8F" />
        <Text style={[styles.lockTitle, { color: isDark ? "#FFF" : "#1A1A1A" }]}>
          App Protegido
        </Text>
        <TouchableOpacity style={styles.button} onPress={autenticar}>
          <Text style={styles.buttonText}>Entrar com Biometria</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toastCor = toastTipo === "error" ? "#E76F51" : toastTipo === "info" ? "#457B9D" : "#2A9D8F";

  return (
    <View style={{ flex: 1 }}>
      <ErrorBoundary>
        <ThemeContext.Provider value={{
          isDark, toggleTheme, isBiometricEnabled, toggleBiometric, session, showToast,
          notificacoesAtivas, toggleNotificacoes,
          plano, setPlano, limites: LIMITES_PLANOS[plano],
          verificarLimite, mostrarModalLimite,
          iaAcoesHoje, tentarAcaoIA,
        }}>
          <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="email-confirmed" />
              <Stack.Screen name="planos" />
            </Stack>
            <StatusBar style={isDark ? "light" : "dark"} />
          </ThemeProvider>
        </ThemeContext.Provider>
      </ErrorBoundary>

      {/* Toast global */}
      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { backgroundColor: toastCor, opacity: toastOpacity }]}
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>

      <Modal animationType="fade" transparent visible={modalAtualizacao !== null}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(42,157,143,0.14)" }]}>
              {modalAtualizacao === "baixando"
                ? <ActivityIndicator size="large" color="#2A9D8F" />
                : <MaterialIcons name="auto-awesome" size={34} color="#2A9D8F" />}
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              {modalAtualizacao === "baixando" ? "Preparando novidades" : "FinFlow atualizado!"}
            </Text>
            {modalAtualizacao === "baixando" ? (
              <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
                Estamos baixando melhorias para deixar sua experiência ainda melhor.
              </Text>
            ) : (
              <>
                <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D", marginBottom: 14 }]}>
                  A nova versão já está pronta para uso.
                </Text>
                <View style={[styles.updateList, { backgroundColor: isDark ? "#272727" : "#F2F7F6" }]}>
                  {[
                    "Histórico mais claro e organizado",
                    "Ajustes opcionais de juros e desconto",
                    "Mais cores e ícones para personalizar",
                    "Melhorias gerais de estabilidade",
                  ].map((item) => (
                    <View key={item} style={styles.updateItem}>
                      <MaterialIcons name="check-circle" size={18} color="#2A9D8F" />
                      <Text style={{ flex: 1, color: isDark ? "#DDD" : "#34404B", fontSize: 13, lineHeight: 19 }}>{item}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 18 }]} onPress={() => Updates.reloadAsync()}>
                  <MaterialIcons name="refresh" size={18} color="#FFF" />
                  <Text style={styles.modalLimiteBtnText}>Reiniciar e aproveitar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal de downgrade — itens bloqueados */}
      <Modal
        animationType="fade"
        transparent
        visible={modalDowngrade.visivel}
        onRequestClose={() => setModalDowngrade({ visivel: false, bloqueados: [] })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <MaterialIcons name="info-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#111827" }]}>
              Itens arquivados automaticamente
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#6B7280" }]}>
              Os itens abaixo excediam o limite do plano gratuito e foram arquivados. Seus dados continuam salvos.
            </Text>
            <View style={{ width: "100%", marginBottom: 20 }}>
              {modalDowngrade.bloqueados.map((b, i) => (
                <View key={i} style={[styles.downgradeItem, { borderColor: isDark ? "#333" : "#E5E7EB" }]}>
                  <MaterialIcons name="archive" size={14} color={isDark ? "#AAA" : "#6B7280"} />
                  <Text style={{ color: isDark ? "#DDD" : "#374151", fontSize: 13, marginLeft: 8 }}>
                    <Text style={{ fontWeight: "600" }}>{b.tipo}:</Text> {b.nome}
                  </Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.modalLimiteBtnFechar, { backgroundColor: isDark ? "#2C2C2C" : "#F3F4F6" }]}
              onPress={() => setModalDowngrade({ visivel: false, bloqueados: [] })}
            >
              <Text style={[styles.modalLimiteBtnFecharText, { color: isDark ? "#AAA" : "#6B7280" }]}>
                Entendi
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de limite de plano */}
      <Modal
        animationType="fade"
        transparent
        visible={modalLimite.visivel}
        onRequestClose={() => setModalLimite({ visivel: false, mensagem: "" })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={styles.modalLimiteTopo}>
              <MaterialIcons name="workspace-premium" size={32} color="#F4A261" />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#1A1A1A" }]}>
              Limite do Plano {nomePlano(plano)}
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#666" }]}>
              {modalLimite.mensagem}
            </Text>
            {modalLimite.planoNecessario && (
              <TouchableOpacity
                style={styles.modalLimiteBtnUpgrade}
                onPress={() => {
                  setModalLimite({ visivel: false, mensagem: "" });
                  router.push("/planos" as any);
                }}
              >
                <MaterialIcons name="arrow-upward" size={16} color="#FFF" />
                <Text style={styles.modalLimiteBtnText}>
                  Ver Plano {nomePlano(modalLimite.planoNecessario)}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modalLimiteBtnFechar, { backgroundColor: isDark ? "#2C2C2C" : "#F0F0F0" }]}
              onPress={() => setModalLimite({ visivel: false, mensagem: "" })}
            >
              <Text style={[styles.modalLimiteBtnFecharText, { color: isDark ? "#AAA" : "#666" }]}>
                Entendi
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  lockScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 22, fontWeight: "bold", marginVertical: 20 },
  button: { backgroundColor: "#2A9D8F", padding: 15, borderRadius: 10 },
  buttonText: { color: "#FFF", fontWeight: "bold" },
  toast: {
    position: "absolute",
    bottom: 90,
    left: 24,
    right: 24,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  toastText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },
  // Modal de limite de plano
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalLimite: {
    width: "100%",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    elevation: 10,
  },
  modalLimiteTopo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(244,162,97,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalLimiteTitulo: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  modalLimiteMensagem: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalLimiteBtnUpgrade: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F4A261",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: "100%",
    justifyContent: "center",
    marginBottom: 10,
  },
  modalLimiteBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 15 },
  modalLimiteBtnFechar: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  modalLimiteBtnFecharText: { fontWeight: "600", fontSize: 14 },
  downgradeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  updateList: { width: "100%", borderRadius: 14, padding: 14, gap: 10 },
  updateItem: { flexDirection: "row", alignItems: "center", gap: 9 },
});
