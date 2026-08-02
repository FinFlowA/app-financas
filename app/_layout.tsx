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
  useCallback,
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
  AppState,
  DeviceEventEmitter,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { exibirEventoObrigatorioLocal, pedirPermissaoNotificacoes } from "../lib/notifications";
import {
  type TipoPlano,
  type LimitesPlano,
  LIMITES_PLANOS,
  LIMITES_DESENVOLVIMENTO,
  dentroDoLimite,
  msgLimiteAtingido,
  nomePlano,
} from "../lib/planos";
import { DEVELOPMENT_ENTITLEMENT, fetchMyEntitlement } from "../lib/subscriptions";
import { verificarCotaIA, consumirAcaoIA, msgCotaEsgotada } from "../lib/ia-limites";
import { RELEASE_NOTES } from "../lib/release-notes";
import {
  CATEGORIAS_INICIAIS_METADATA_KEY,
  garantirCategoriaOutros,
} from "../lib/default-categories";
import { criarFluxoRecuperacaoSenha, PASSWORD_RECOVERY_FLOW_KEY } from "../lib/auth-flow";
import { FinFlowRadius, FinFlowShadow, finFlowTheme } from "../constants/finflow-design";
import FinFlowAlertHost from "../components/FinFlowAlertHost";
import FinFlowOnboarding from "../components/FinFlowOnboarding";
import PartnershipDissolutionModals, {
  type DecisaoContaDissolucao,
  type ResumoDissolucao,
} from "../components/PartnershipDissolutionModals";
import {
  dataNascimentoParaISO,
  formatarDataNascimento,
  idadeEmAnos,
  LEGAL_DOCUMENT_VERSION,
  listarPendenciasCadastro,
  type PendenciaCadastro,
} from "../lib/legal";

type DecisaoCaixinha = {
  id: number;
  nome: string;
  meta_valor: number;
  saldo_total: number;
  saldo_disponivel: number;
  cor: string;
  icone: string;
  data_prazo: string | null;
};

type NotificacaoParceria = {
  id: number;
  tipo: "convite_parceria" | "parceria_aceita" | "parceria_recusada";
  referencia_id: number;
  titulo: string;
  mensagem: string;
  dados: Record<string, unknown> | null;
  criada_em: string;
};

// ERROR BOUNDARY
class ErrorBoundary extends Component<{ children: ReactNode }, { temErro: boolean }> {
  state = { temErro: false };
  static getDerivedStateFromError() { return { temErro: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Erro não tratado no FinFlow:", error, info.componentStack);
  }
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
  billingEnabled: false,
  limitsEnabled: false,
  temCadastroPendente: false,
  temPopupPrioritario: false,
  refreshEntitlement: async () => {},
});

export const useAppTheme = () => useContext(ThemeContext);

export default function RootLayout() {
  const systemTheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();

  const [isDark, setIsDark] = useState(systemTheme === "dark");
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [autenticandoBiometria, setAutenticandoBiometria] = useState(false);
  const [erroDesbloqueio, setErroDesbloqueio] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [notificacoesAtivas, setNotificacoesAtivas] = useState(false);
  const [modalAtualizacao, setModalAtualizacao] = useState<"baixando" | "pronta" | "novidades" | null>(null);
  const [modalNotificacoes, setModalNotificacoes] = useState<"pergunta" | "ativado" | null>(null);
  const [decisoesCaixinha, setDecisoesCaixinha] = useState<DecisaoCaixinha[]>([]);
  const [definindoSaldoCaixinha, setDefinindoSaldoCaixinha] = useState(false);
  const [saldoCaixinha, setSaldoCaixinha] = useState("");
  const [resolvendoCaixinha, setResolvendoCaixinha] = useState(false);
  const [resumoDissolucao, setResumoDissolucao] = useState<ResumoDissolucao | null>(null);
  const [decisoesContaDissolucao, setDecisoesContaDissolucao] = useState<DecisaoContaDissolucao[]>([]);
  const [processandoDissolucao, setProcessandoDissolucao] = useState(false);
  const dissolucaoResumoIndisponivel = useRef(false);
  const [notificacoesParceria, setNotificacoesParceria] = useState<NotificacaoParceria[]>([]);
  const buscandoNotificacoesParceria = useRef(false);
  const notificacoesParceriaIndisponiveis = useRef(false);
  const [pendenciasCadastro, setPendenciasCadastro] = useState<PendenciaCadastro[]>([]);
  const [nascimentoPendente, setNascimentoPendente] = useState("");
  const [termosPendentesAceitos, setTermosPendentesAceitos] = useState(false);
  const [salvandoCadastroPendente, setSalvandoCadastroPendente] = useState(false);
  const [erroCadastroPendente, setErroCadastroPendente] = useState("");
  const [tutorialUsuario, setTutorialUsuario] = useState<{
    userId: string | null;
    status: "verificando" | "pendente" | "concluido";
  }>({ userId: null, status: "verificando" });

  // Sistema de planos
  const [plano, setPlanoState] = useState<TipoPlano>("free");
  const [iaAcoesHoje, setIaAcoesHoje] = useState(0);
  const [entitlement, setEntitlement] = useState(DEVELOPMENT_ENTITLEMENT);
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
  const autenticacaoEmAndamento = useRef(false);
  const categoriasIniciaisProcessadas = useRef(new Set<string>());

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

  const autenticar = useCallback(async () => {
    if (autenticacaoEmAndamento.current) return;

    autenticacaoEmAndamento.current = true;
    setAutenticandoBiometria(true);
    setErroDesbloqueio("");

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Desbloquear o FinFlow",
        fallbackLabel: "Usar senha do dispositivo",
        cancelLabel: "Cancelar",
      });

      if (result.success) {
        setIsUnlocked(true);
        return;
      }

      if (result.error !== "user_cancel" && result.error !== "system_cancel" && result.error !== "app_cancel") {
        setErroDesbloqueio("Não foi possível confirmar sua identidade. Tente novamente.");
      }
    } catch {
      setErroDesbloqueio("Não foi possível abrir a verificação do dispositivo.");
    } finally {
      autenticacaoEmAndamento.current = false;
      setAutenticandoBiometria(false);
    }
  }, []);

  const verificarBiometria = useCallback(async () => {
    const temHardware = await LocalAuthentication.hasHardwareAsync();
    const temBiometria = await LocalAuthentication.isEnrolledAsync();
    if (temHardware && temBiometria) {
      await autenticar();
    } else {
      setIsUnlocked(true);
    }
  }, [autenticar]);

  const carregarConfiguracoes = useCallback(async () => {
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
  }, [verificarBiometria]);

  // Intercepta deep links do email (recuperação de senha e confirmação de conta)
  const url = Linking.useURL();
  const iniciarFluxoRecuperacaoSenha = useCallback(async (userId?: string) => {
    if (!userId) return;
    await AsyncStorage.setItem(
      PASSWORD_RECOVERY_FLOW_KEY,
      JSON.stringify(criarFluxoRecuperacaoSenha(userId)),
    );
    router.replace("/reset-password" as any);
  }, [router]);

  useEffect(() => {
    if (!url) return;

    // Fluxo PKCE (Supabase moderno): code= nos query params
    try {
      const parsed = new URL(url);
      const code = parsed.searchParams.get("code");
      if (code) {
        supabase.auth.exchangeCodeForSession(code)
          .then(({ data, error }) => {
            if (error) {
              console.log("Erro ao trocar código:", error);
              return;
            }
            if (url.includes("email-confirmed") && data.user?.email_confirmed_at) {
              router.replace("/email-confirmed" as any);
            }
          })
          .catch((e) => console.log("Erro ao trocar código:", e));
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
      }).then(({ data, error }) => {
        if (error) {
          console.log("Erro ao abrir link de autenticação:", error);
          return;
        }
        if (params.type === "signup") {
          router.replace("/email-confirmed" as any);
        } else if (params.type === "recovery") {
          void iniciarFluxoRecuperacaoSenha(data.session?.user.id);
        }
      });
    }
  }, [iniciarFluxoRecuperacaoSenha, router, url]);

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

  useEffect(() => {
    if (__DEV__ || !Updates.updateId) return;
    const chave = "@finflow_ultimas_novidades_exibidas";
    AsyncStorage.getItem(chave).then((ultima) => {
      if (ultima !== RELEASE_NOTES.id) {
        setModalAtualizacao("novidades");
      }
    });
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
        void iniciarFluxoRecuperacaoSenha(session?.user.id);
      } else if (event === "SIGNED_OUT") {
        void AsyncStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
      }
    });

    return () => subscription.unsubscribe();
  }, [carregarConfiguracoes, iniciarFluxoRecuperacaoSenha]);

  const verificarCadastroPendente = useCallback(() => {
    const metadata = session?.user?.user_metadata as Record<string, unknown> | undefined;
    setPendenciasCadastro(listarPendenciasCadastro(metadata));
    setErroCadastroPendente("");
  }, [session?.user?.user_metadata]);

  useEffect(() => {
    if (!session?.user?.id) {
      setPendenciasCadastro([]);
      return;
    }
    verificarCadastroPendente();
  }, [session?.user?.id, verificarCadastroPendente]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    if (metadata[CATEGORIAS_INICIAIS_METADATA_KEY] === true) {
      categoriasIniciaisProcessadas.current.add(uid);
      return;
    }
    if (categoriasIniciaisProcessadas.current.has(uid)) return;

    categoriasIniciaisProcessadas.current.add(uid);
    garantirCategoriaOutros(uid, metadata)
      .then(({ alterouCategorias }) => {
        if (alterouCategorias) {
          DeviceEventEmitter.emit("finflow:categorias-padrao-prontas");
        }
      })
      .catch((error) => {
        categoriasIniciaisProcessadas.current.delete(uid);
        console.warn("Não foi possível criar as categorias iniciais:", error);
      });
  }, [session?.user?.id, session?.user?.user_metadata]);

  const tutorialMarcadoPendente = session?.user?.user_metadata?.tutorial_pendente === true;
  const tutorialStatus = tutorialUsuario.userId === session?.user?.id
    ? tutorialUsuario.status
    : "verificando";
  const tutorialBloqueando = Boolean(
    session?.user?.id && tutorialMarcadoPendente && tutorialStatus !== "concluido",
  );
  const tutorialVisivel = tutorialBloqueando && tutorialStatus === "pendente";

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setTutorialUsuario({ userId: null, status: "verificando" });
      return;
    }

    if (!tutorialMarcadoPendente) {
      setTutorialUsuario({ userId: uid, status: "concluido" });
      return;
    }

    let ativo = true;
    setTutorialUsuario({ userId: uid, status: "verificando" });
    AsyncStorage.getItem(`@finflow_tutorial_concluido_${uid}`)
      .then((valor) => {
        if (!ativo) return;
        setTutorialUsuario({
          userId: uid,
          status: valor === "true" ? "concluido" : "pendente",
        });
      })
      .catch(() => {
        if (ativo) setTutorialUsuario({ userId: uid, status: "pendente" });
      });

    return () => {
      ativo = false;
    };
  }, [session?.user?.id, tutorialMarcadoPendente]);

  const concluirOuPularTutorial = async () => {
    const uid = session?.user?.id;
    if (!uid) return;

    // Fecha imediatamente e grava primeiro no aparelho. Assim, uma falha de rede
    // nunca obriga o usuário a rever o tutorial neste dispositivo.
    setTutorialUsuario({ userId: uid, status: "concluido" });
    try {
      await AsyncStorage.setItem(`@finflow_tutorial_concluido_${uid}`, "true");
    } catch (error) {
      console.warn("Não foi possível salvar o tutorial no dispositivo:", error);
    }

    const metadataAtual = session?.user?.user_metadata ?? {};
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          ...metadataAtual,
          tutorial_pendente: false,
          tutorial_concluido_em: new Date().toISOString(),
        },
      });
      if (error) {
        console.warn("Tutorial concluído localmente; sincronização pendente:", error.message);
      }
    } catch (error) {
      console.warn("Tutorial concluído localmente; sincronização pendente:", error);
    }
  };

  const concluirCadastroPendente = async () => {
    if (salvandoCadastroPendente) return;

    const precisaNascimento = pendenciasCadastro.includes("data_nascimento");
    const precisaTermos = pendenciasCadastro.includes("termos");
    const nascimentoISO = precisaNascimento
      ? dataNascimentoParaISO(nascimentoPendente)
      : null;

    if (precisaNascimento && !nascimentoISO) {
      setErroCadastroPendente("Informe uma data de nascimento válida.");
      return;
    }
    if (nascimentoISO && (idadeEmAnos(nascimentoISO) ?? -1) < 18) {
      setErroCadastroPendente("O FinFlow é destinado somente a maiores de 18 anos.");
      return;
    }
    if (precisaTermos && !termosPendentesAceitos) {
      setErroCadastroPendente("É necessário aceitar os Termos de Uso e a Política de Privacidade.");
      return;
    }

    setSalvandoCadastroPendente(true);
    setErroCadastroPendente("");
    const metadataAtual = session?.user?.user_metadata ?? {};
    const { data, error } = await supabase.auth.updateUser({
      data: {
        ...metadataAtual,
        ...(nascimentoISO ? { data_nascimento: nascimentoISO } : {}),
        ...(precisaTermos ? {
          termos_aceitos_em: new Date().toISOString(),
          termos_versao: LEGAL_DOCUMENT_VERSION,
        } : {}),
      },
    });
    setSalvandoCadastroPendente(false);

    if (error || !data.user) {
      setErroCadastroPendente("Não foi possível salvar. Confira sua conexão e tente novamente.");
      return;
    }

    setNascimentoPendente("");
    setTermosPendentesAceitos(false);
    setPendenciasCadastro(listarPendenciasCadastro(data.user.user_metadata));
    showToast("Cadastro atualizado com segurança ✓", "success");
  };

  // Load per-user notification preference
  useEffect(() => {
    if (!session?.user?.id) return;
    AsyncStorage.getItem(`@notificacoes_enabled_${session.user.id}`).then((val) => {
      setNotificacoesAtivas(val === "true");
    });
  }, [session?.user?.id]);

  const carregarDecisoesCaixinha = useCallback(async () => {
    if (!session?.user?.id) {
      setDecisoesCaixinha([]);
      return;
    }
    const { data, error } = await supabase.rpc("get_minhas_decisoes_caixinha");
    if (!error && data) setDecisoesCaixinha(data as DecisaoCaixinha[]);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    carregarDecisoesCaixinha();

    const eventoLocal = DeviceEventEmitter.addListener(
      "finflow:parceria-dissolvida",
      carregarDecisoesCaixinha,
    );
    const eventoApp = AppState.addEventListener("change", (estado) => {
      if (estado === "active") carregarDecisoesCaixinha();
    });

    return () => {
      eventoLocal.remove();
      eventoApp.remove();
    };
  }, [carregarDecisoesCaixinha, session?.user?.id]);

  const carregarResumoDissolucao = useCallback(async () => {
    if (!session?.user?.id) {
      setResumoDissolucao(null);
      setDecisoesContaDissolucao([]);
      return;
    }
    if (dissolucaoResumoIndisponivel.current) return;

    const [resumoResult, contasResult] = await Promise.all([
      supabase.rpc("get_meu_resumo_dissolucao"),
      supabase.rpc("get_minhas_decisoes_conta_dissolucao"),
    ]);
    const erros = [resumoResult.error, contasResult.error].filter(Boolean);
    const migrationAusente = erros.some((erro) =>
      erro?.code === "42883" || erro?.code === "PGRST202" || erro?.code === "PGRST205"
    );
    if (migrationAusente) {
      // O app continua compatível com o backend anterior até a migration ser
      // aplicada. As decisões antigas de caixinha permanecem funcionando.
      dissolucaoResumoIndisponivel.current = true;
      setResumoDissolucao(null);
      setDecisoesContaDissolucao([]);
      return;
    }
    if (erros.length > 0) {
      console.log("Falha ao carregar resumo da parceria:", erros[0]?.message);
      return;
    }

    const resumoBruto = Array.isArray(resumoResult.data) ? resumoResult.data[0] : null;
    setResumoDissolucao(resumoBruto ? {
      ...resumoBruto,
      itens: Array.isArray(resumoBruto.itens) ? resumoBruto.itens : [],
    } as ResumoDissolucao : null);
    setDecisoesContaDissolucao((contasResult.data ?? []) as DecisaoContaDissolucao[]);
  }, [session?.user?.id]);

  useEffect(() => {
    dissolucaoResumoIndisponivel.current = false;
    setResumoDissolucao(null);
    setDecisoesContaDissolucao([]);
    if (!session?.user?.id) return;

    void carregarResumoDissolucao();
    const eventoLocal = DeviceEventEmitter.addListener(
      "finflow:parceria-dissolvida",
      carregarResumoDissolucao,
    );
    const eventoApp = AppState.addEventListener("change", (estado) => {
      if (estado === "active") void carregarResumoDissolucao();
    });

    return () => {
      eventoLocal.remove();
      eventoApp.remove();
    };
  }, [carregarResumoDissolucao, session?.user?.id]);

  const confirmarResumoDissolucao = async () => {
    if (!resumoDissolucao || processandoDissolucao) return;
    setProcessandoDissolucao(true);
    const { data, error } = await supabase.rpc("confirmar_resumo_dissolucao", {
      p_resumo_id: resumoDissolucao.resumo_id,
    });
    setProcessandoDissolucao(false);
    if (error || data !== true) {
      Alert.alert("Não foi possível continuar", "O resumo permanece salvo. Confira sua conexão e tente novamente.");
      return;
    }
    setResumoDissolucao(null);
    await carregarResumoDissolucao();
  };

  const resolverContaDissolucao = async (manterAtiva: boolean) => {
    const decisao = decisoesContaDissolucao[0];
    if (!decisao || processandoDissolucao) return;
    setProcessandoDissolucao(true);
    const { error } = await supabase.rpc("resolver_decisao_conta_dissolucao", {
      p_item_id: decisao.id,
      p_manter_ativa: manterAtiva,
    });
    setProcessandoDissolucao(false);
    if (error) {
      await carregarResumoDissolucao();
      Alert.alert("Não foi possível atualizar a conta", "A escolha não foi aplicada. Tente novamente.");
      return;
    }
    await carregarResumoDissolucao();
  };

  const carregarNotificacoesParceria = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setNotificacoesParceria([]);
      return;
    }
    if (buscandoNotificacoesParceria.current || notificacoesParceriaIndisponiveis.current) return;

    buscandoNotificacoesParceria.current = true;
    try {
      const { data, error } = await supabase
        .from("notificacoes_sistema")
        .select("id, tipo, referencia_id, titulo, mensagem, dados, criada_em")
        .in("tipo", ["convite_parceria", "parceria_aceita", "parceria_recusada"])
        .is("lida_em", null)
        .order("criada_em", { ascending: true })
        .order("id", { ascending: true })
        .limit(20);

      if (error) {
        // Durante o preview local a migration pode ainda nao ter sido aplicada.
        // Nesse caso o restante do app continua funcionando sem alertas ou logs
        // repetidos a cada ciclo de atualizacao.
        if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") {
          notificacoesParceriaIndisponiveis.current = true;
          setNotificacoesParceria([]);
          return;
        }
        console.log("Falha ao carregar avisos de parceria:", error.message);
        return;
      }

      const eventos = (data ?? []) as NotificacaoParceria[];
      setNotificacoesParceria(eventos);
      eventos.forEach((evento) => {
        void exibirEventoObrigatorioLocal(uid, evento.id, evento.titulo, evento.mensagem);
      });
    } finally {
      buscandoNotificacoesParceria.current = false;
    }
  }, [session?.user?.id]);

  useEffect(() => {
    notificacoesParceriaIndisponiveis.current = false;
    setNotificacoesParceria([]);
    if (!session?.user?.id) return;

    void carregarNotificacoesParceria();
    const intervalo = setInterval(() => {
      if (AppState.currentState === "active") void carregarNotificacoesParceria();
    }, 15000);
    const eventoApp = AppState.addEventListener("change", (estado) => {
      if (estado === "active") void carregarNotificacoesParceria();
    });

    return () => {
      clearInterval(intervalo);
      eventoApp.remove();
    };
  }, [carregarNotificacoesParceria, session?.user?.id]);

  const concluirNotificacaoParceria = async (abrirConvite: boolean) => {
    const notificacao = notificacoesParceria[0];
    if (!notificacao) return;

    const { error } = await supabase.rpc("marcar_notificacao_sistema_lida", {
      p_id: notificacao.id,
    });
    if (error) {
      // A fila nunca deve derrubar o app. Se a migration estiver incompleta, o
      // evento permanece persistente para uma nova tentativa.
      if (error.code !== "42883" && error.code !== "PGRST202") {
        showToast("Nao foi possivel confirmar este aviso", "error");
      }
      return;
    }

    setNotificacoesParceria((atuais) => atuais.filter((item) => item.id !== notificacao.id));
    if (abrirConvite) {
      router.push({
        pathname: "/(tabs)/configuracoes",
        params: { parceriaId: String(notificacao.referencia_id) },
      } as any);
    }
  };

  const resolverDecisaoCaixinha = async (manter: boolean) => {
    const decisao = decisoesCaixinha[0];
    if (!decisao || resolvendoCaixinha) return;

    let saldo: number | null = null;
    if (manter) {
      saldo = Number(saldoCaixinha.replace(",", "."));
      if (!Number.isFinite(saldo) || saldo < 0 || saldo > Number(decisao.saldo_disponivel)) {
        Alert.alert(
          "Saldo inválido",
          `Informe um valor entre R$ 0,00 e R$ ${Number(decisao.saldo_disponivel).toFixed(2).replace(".", ",")}.`,
        );
        return;
      }
    }

    setResolvendoCaixinha(true);
    const { error } = await supabase.rpc("resolver_decisao_caixinha", {
      p_decisao_id: decisao.id,
      p_manter: manter,
      p_saldo: saldo,
    });
    setResolvendoCaixinha(false);

    if (error) {
      await carregarDecisoesCaixinha();
      Alert.alert(
        "Não foi possível concluir",
        "O saldo disponível pode ter mudado. Confira o valor e tente novamente.",
      );
      return;
    }

    setDefinindoSaldoCaixinha(false);
    setSaldoCaixinha("");
    await carregarDecisoesCaixinha();
  };

  const refreshEntitlement = async () => {
    if (!session?.user?.id) return;
    const next = await fetchMyEntitlement();
    setEntitlement(next);
    setPlanoState(next.plan);
  };

  // Carrega direitos do servidor. O dispositivo nunca é a fonte oficial do plano.
  useEffect(() => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    fetchMyEntitlement().then((next) => {
      setEntitlement(next);
      setPlanoState(next.plan);
      if (next.limitsEnabled) {
        verificarCotaIA(uid, next.plan).then(({ usadas }) => setIaAcoesHoje(usadas));
      } else {
        setIaAcoesHoje(0);
      }
    });
  }, [session?.user?.id]);

  // Solicita permissão de notificação na primeira sessão do usuário neste dispositivo
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const chave = `@notificacoes_perguntado_${uid}`;
    AsyncStorage.getItem(chave).then((val) => {
      if (val !== null) return;
      setModalNotificacoes("pergunta");
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
  }, [session, isReady, isAuthReady, router, segments]);

  const setPlano = async (novoPlano: TipoPlano) => {
    // Compatibilidade temporária com telas antigas. O plano só pode mudar por
    // confirmação do backend/provedor; nunca por uma ação local do aplicativo.
    if (novoPlano !== plano) {
      console.warn("Alteração local de plano bloqueada. Use o fluxo seguro de assinatura.");
      return;
    }
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
  };

  const verificarLimite = (tipo: keyof LimitesPlano, qtdAtual: number): boolean => {
    if (!entitlement.limitsEnabled) return true;
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
    if (!entitlement.limitsEnabled) return true;
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

  const temaFinFlow = finFlowTheme(isDark);

  if (!isReady || !isAuthReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: isDark ? "#121212" : "#FFF" }}>
        <ActivityIndicator size="large" color="#2A9D8F" />
      </View>
    );
  }

  if (session && isBiometricEnabled && !isUnlocked) {
    return (
      <View style={[styles.lockScreen, { backgroundColor: temaFinFlow.background }]}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <View pointerEvents="none" style={[styles.lockGlowTop, { backgroundColor: temaFinFlow.header }]} />
        <View pointerEvents="none" style={[styles.lockGlowBottom, { backgroundColor: temaFinFlow.primarySoft }]} />

        <View style={styles.lockContent}>
          <View style={styles.lockBrand}>
            <View style={[styles.lockBrandIcon, { backgroundColor: temaFinFlow.primary }]}>
              <MaterialIcons name="account-balance-wallet" size={23} color="#FFF" />
            </View>
            <Text style={[styles.lockBrandText, { color: temaFinFlow.text }]}>FinFlow</Text>
          </View>

          <View style={[
            styles.lockCard,
            { backgroundColor: temaFinFlow.surfaceElevated, borderColor: temaFinFlow.border },
          ]}>
            <View style={[styles.lockIconHalo, { backgroundColor: temaFinFlow.primarySoft }]}>
              <View style={[styles.lockIconCircle, { backgroundColor: temaFinFlow.primary }]}>
                <MaterialIcons name="fingerprint" size={42} color="#FFF" />
              </View>
            </View>

            <Text style={[styles.lockTitle, { color: temaFinFlow.text }]}>FinFlow protegido</Text>
            <Text style={[styles.lockDescription, { color: temaFinFlow.textMuted }]}>
              {"Confirme sua identidade para acessar suas informa\u00e7\u00f5es financeiras."}
            </Text>

            <View style={[styles.lockMethod, { backgroundColor: temaFinFlow.surfaceMuted }]}>
              <MaterialIcons name="verified-user" size={17} color={temaFinFlow.primary} />
              <Text style={[styles.lockMethodText, { color: temaFinFlow.text }]}>Biometria ou senha do dispositivo</Text>
            </View>

            {!!erroDesbloqueio && (
              <View style={styles.lockError}>
                <MaterialIcons name="error-outline" size={18} color="#E76F51" />
                <Text style={styles.lockErrorText}>{erroDesbloqueio}</Text>
              </View>
            )}

            <TouchableOpacity
              disabled={autenticandoBiometria}
              style={[styles.lockButton, { backgroundColor: temaFinFlow.primary, opacity: autenticandoBiometria ? 0.72 : 1 }]}
              onPress={autenticar}
              accessibilityRole="button"
              accessibilityLabel="Desbloquear o FinFlow"
            >
              {autenticandoBiometria
                ? <ActivityIndicator size="small" color="#FFF" />
                : <MaterialIcons name="lock-open" size={20} color="#FFF" />}
              <Text style={styles.lockButtonText}>
                {autenticandoBiometria ? "Aguardando confirma\u00e7\u00e3o..." : "Desbloquear com seguran\u00e7a"}
              </Text>
            </TouchableOpacity>

            <View style={styles.lockPrivacyRow}>
              <MaterialIcons name="security" size={15} color={temaFinFlow.textMuted} />
              <Text style={[styles.lockPrivacyText, { color: temaFinFlow.textMuted }]}>
                {"A verifica\u00e7\u00e3o acontece no seu aparelho. O FinFlow n\u00e3o recebe sua biometria nem a senha do dispositivo."}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const toastCor = toastTipo === "error" ? "#E76F51" : toastTipo === "info" ? "#457B9D" : "#2A9D8F";
  const notificacaoParceriaAtual = notificacoesParceria[0];
  const notificacaoEhConvite = notificacaoParceriaAtual?.tipo === "convite_parceria";
  const notificacaoEhRecusa = notificacaoParceriaAtual?.tipo === "parceria_recusada";

  return (
    <View style={{ flex: 1 }}>
      <ErrorBoundary>
        <ThemeContext.Provider value={{
          isDark, toggleTheme, isBiometricEnabled, toggleBiometric, session, showToast,
          notificacoesAtivas, toggleNotificacoes,
          plano, setPlano,
          limites: entitlement.limitsEnabled ? LIMITES_PLANOS[plano] : LIMITES_DESENVOLVIMENTO,
          billingEnabled: entitlement.billingEnabled,
          limitsEnabled: entitlement.limitsEnabled,
          temCadastroPendente: pendenciasCadastro.length > 0,
          temPopupPrioritario:
            pendenciasCadastro.length > 0 ||
            tutorialBloqueando ||
            resumoDissolucao !== null ||
            decisoesContaDissolucao.length > 0 ||
            decisoesCaixinha.length > 0 ||
            modalAtualizacao !== null ||
            notificacoesParceria.length > 0 ||
            modalNotificacoes !== null,
          refreshEntitlement,
          verificarLimite, mostrarModalLimite,
          iaAcoesHoje, tentarAcaoIA,
        }}>
          <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="email-confirmed" />
              <Stack.Screen name="seguranca" />
              <Stack.Screen name="planos" />
            </Stack>
            <StatusBar style={isDark ? "light" : "dark"} />
          </ThemeProvider>
        </ThemeContext.Provider>
      </ErrorBoundary>

      <FinFlowAlertHost isDark={isDark} />

      {/* Toast global */}
      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { backgroundColor: toastCor, opacity: toastOpacity }]}
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(session?.user?.id) && pendenciasCadastro.length > 0}
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(42,157,143,0.14)" }]}>
              <MaterialIcons name="person-outline" size={34} color="#2A9D8F" />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              Complete seu cadastro
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
              Precisamos confirmar algumas informações obrigatórias antes de você continuar.
            </Text>

            {pendenciasCadastro.includes("data_nascimento") && (
              <View style={{ width: "100%", marginTop: 8 }}>
                <Text style={{ color: isDark ? "#DDD" : "#34404B", fontSize: 13, fontWeight: "600", marginBottom: 7 }}>
                  Data de nascimento
                </Text>
                <TextInput
                  style={{
                    width: "100%",
                    borderWidth: 1,
                    borderColor: isDark ? "#444" : "#D4E0DC",
                    backgroundColor: isDark ? "#292929" : "#F8FAF9",
                    color: isDark ? "#FFF" : "#17212B",
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                  }}
                  placeholder="DD/MM/AAAA"
                  placeholderTextColor={isDark ? "#888" : "#8A949E"}
                  keyboardType="number-pad"
                  value={nascimentoPendente}
                  onChangeText={(valor) => setNascimentoPendente(formatarDataNascimento(valor))}
                  maxLength={10}
                  editable={!salvandoCadastroPendente}
                />
                <Text style={{ color: isDark ? "#999" : "#75808A", fontSize: 11, marginTop: 6 }}>
                  O FinFlow é destinado a pessoas com 18 anos ou mais.
                </Text>
              </View>
            )}

            {pendenciasCadastro.includes("termos") && (
              <View style={{ width: "100%", marginTop: 18 }}>
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "flex-start" }}
                  onPress={() => setTermosPendentesAceitos((aceito) => !aceito)}
                  disabled={salvandoCadastroPendente}
                >
                  <MaterialIcons
                    name={termosPendentesAceitos ? "check-box" : "check-box-outline-blank"}
                    size={24}
                    color={termosPendentesAceitos ? "#2A9D8F" : (isDark ? "#888" : "#75808A")}
                  />
                  <Text style={{ flex: 1, color: isDark ? "#DDD" : "#34404B", fontSize: 13, lineHeight: 19, marginLeft: 9 }}>
                    Li e concordo com os Termos de Uso e a Política de Privacidade vigentes.
                  </Text>
                </TouchableOpacity>
                <View style={{ flexDirection: "row", marginTop: 10, marginLeft: 33 }}>
                  <TouchableOpacity onPress={() => Linking.openURL("https://finflowa.github.io/finflow-legal/#termos")}>
                    <Text style={{ color: "#2A9D8F", fontSize: 12, fontWeight: "700" }}>Ver termos</Text>
                  </TouchableOpacity>
                  <Text style={{ color: isDark ? "#666" : "#A0A7AE", marginHorizontal: 8 }}>•</Text>
                  <TouchableOpacity onPress={() => Linking.openURL("https://finflowa.github.io/finflow-legal/#privacidade")}>
                    <Text style={{ color: "#2A9D8F", fontSize: 12, fontWeight: "700" }}>Ver privacidade</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {erroCadastroPendente ? (
              <Text style={{ color: "#E76F51", fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 16 }}>
                {erroCadastroPendente}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 18 }]}
              onPress={concluirCadastroPendente}
              disabled={salvandoCadastroPendente}
            >
              {salvandoCadastroPendente
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.modalLimiteBtnText}>Salvar e continuar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <FinFlowOnboarding
        visible={
          Boolean(session?.user?.id) &&
          pendenciasCadastro.length === 0 &&
          tutorialVisivel
        }
        isDark={isDark}
        onSkip={concluirOuPularTutorial}
        onFinish={concluirOuPularTutorial}
      />

      <PartnershipDissolutionModals
        isDark={isDark}
        resumo={resumoDissolucao}
        decisaoConta={decisoesContaDissolucao[0] ?? null}
        mostrarResumo={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao !== null
        }
        mostrarDecisaoConta={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao === null &&
          decisoesContaDissolucao.length > 0
        }
        processando={processandoDissolucao}
        onConfirmarResumo={() => void confirmarResumoDissolucao()}
        onResolverConta={(manterAtiva) => void resolverContaDissolucao(manterAtiva)}
      />

      <Modal
        animationType="fade"
        transparent
        visible={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao === null &&
          decisoesContaDissolucao.length === 0 &&
          decisoesCaixinha.length === 0 &&
          modalAtualizacao === null &&
          Boolean(notificacaoParceriaAtual)
        }
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[
              styles.modalLimiteTopo,
              { backgroundColor: notificacaoEhRecusa ? "rgba(231,111,81,0.14)" : "rgba(42,157,143,0.14)" },
            ]}>
              <MaterialIcons
                name={notificacaoEhConvite ? "person-add-alt-1" : notificacaoEhRecusa ? "person-remove" : "favorite"}
                size={34}
                color={notificacaoEhRecusa ? "#E76F51" : "#2A9D8F"}
              />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              {notificacaoParceriaAtual?.titulo ?? "Aviso de parceria"}
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
              {notificacaoParceriaAtual?.mensagem ?? "Existe uma novidade sobre sua parceria."}
            </Text>
            <TouchableOpacity
              style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 4 }]}
              onPress={() => void concluirNotificacaoParceria(notificacaoEhConvite)}
            >
              <MaterialIcons name={notificacaoEhConvite ? "settings" : "check"} size={18} color="#FFF" />
              <Text style={styles.modalLimiteBtnText}>{notificacaoEhConvite ? "Ver convite em Ajustes" : "Entendi"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao === null &&
          decisoesContaDissolucao.length === 0 &&
          decisoesCaixinha.length > 0
        }
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(42,157,143,0.14)" }]}>
              <MaterialIcons name="savings" size={34} color="#2A9D8F" />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              Caixinha após a parceria
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
              {definindoSaldoCaixinha
                ? `Defina quanto do saldo de “${decisoesCaixinha[0]?.nome ?? ""}” ficará na sua caixinha individual.`
                : `A parceria foi encerrada. Deseja continuar com a caixinha “${decisoesCaixinha[0]?.nome ?? ""}”?`}
            </Text>

            <View style={[styles.updateList, { backgroundColor: isDark ? "#252B2A" : "#EEF7F5", borderColor: isDark ? "#334744" : "#D4EAE5" }]}>
              <Text style={{ color: isDark ? "#DDD" : "#34404B", fontSize: 13 }}>
                Saldo total na separação: R$ {Number(decisoesCaixinha[0]?.saldo_total ?? 0).toFixed(2).replace(".", ",")}
              </Text>
              <Text style={{ color: isDark ? "#DDD" : "#34404B", fontSize: 13, marginTop: 6 }}>
                Disponível para você: R$ {Number(decisoesCaixinha[0]?.saldo_disponivel ?? 0).toFixed(2).replace(".", ",")}
              </Text>
            </View>

            {definindoSaldoCaixinha ? (
              <>
                <TextInput
                  style={{
                    width: "100%",
                    marginTop: 14,
                    borderWidth: 1,
                    borderColor: isDark ? "#444" : "#D4E0DC",
                    backgroundColor: isDark ? "#292929" : "#F8FAF9",
                    color: isDark ? "#FFF" : "#17212B",
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                  }}
                  placeholder="Saldo que ficará com você"
                  placeholderTextColor={isDark ? "#888" : "#8A949E"}
                  keyboardType="decimal-pad"
                  value={saldoCaixinha}
                  onChangeText={setSaldoCaixinha}
                  editable={!resolvendoCaixinha}
                />
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 14 }]}
                  onPress={() => resolverDecisaoCaixinha(true)}
                  disabled={resolvendoCaixinha}
                >
                  {resolvendoCaixinha
                    ? <ActivityIndicator color="#FFF" />
                    : <Text style={styles.modalLimiteBtnText}>Confirmar saldo</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: isDark ? "#333" : "#E8ECEA", marginTop: 8 }]}
                  onPress={() => {
                    setDefinindoSaldoCaixinha(false);
                    setSaldoCaixinha("");
                  }}
                  disabled={resolvendoCaixinha}
                >
                  <Text style={[styles.modalLimiteBtnText, { color: isDark ? "#FFF" : "#34404B" }]}>Voltar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 18 }]}
                  onPress={() => {
                    setSaldoCaixinha(
                      Number(decisoesCaixinha[0]?.saldo_disponivel ?? 0).toFixed(2).replace(".", ","),
                    );
                    setDefinindoSaldoCaixinha(true);
                  }}
                >
                  <Text style={styles.modalLimiteBtnText}>Sim, continuar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#E76F51", marginTop: 8 }]}
                  onPress={() => resolverDecisaoCaixinha(false)}
                  disabled={resolvendoCaixinha}
                >
                  {resolvendoCaixinha
                    ? <ActivityIndicator color="#FFF" />
                    : <Text style={styles.modalLimiteBtnText}>Não, descartar</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao === null &&
          decisoesContaDissolucao.length === 0 &&
          decisoesCaixinha.length === 0 &&
          modalAtualizacao !== null
        }
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(42,157,143,0.14)" }]}>
              {modalAtualizacao === "baixando"
                ? <ActivityIndicator size="large" color="#2A9D8F" />
                : <MaterialIcons name="auto-awesome" size={34} color="#2A9D8F" />}
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              {modalAtualizacao === "baixando" ? "Preparando atualização" : modalAtualizacao === "pronta" ? "Atualização pronta" : "Novidades no FinFlow"}
            </Text>
            {modalAtualizacao === "baixando" ? (
              <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
                Estamos baixando melhorias para deixar sua experiência ainda melhor.
              </Text>
            ) : modalAtualizacao === "pronta" ? (
              <>
                <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
                  O download terminou. Reinicie o FinFlow para aplicar a nova versão.
                </Text>
                <TouchableOpacity style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F" }]} onPress={() => Updates.reloadAsync()}>
                  <MaterialIcons name="refresh" size={18} color="#FFF" />
                  <Text style={styles.modalLimiteBtnText}>Aplicar agora</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D", marginBottom: 14 }]}>
                  Veja o que mudou nesta versão:
                </Text>
                <View style={[styles.updateList, { backgroundColor: isDark ? "#252B2A" : "#EEF7F5", borderColor: isDark ? "#334744" : "#D4EAE5" }]}>
                  {RELEASE_NOTES.items.map((item) => (
                    <View key={item} style={styles.updateItem}>
                      <MaterialIcons name="check-circle" size={18} color="#2A9D8F" />
                      <Text style={{ flex: 1, color: isDark ? "#DDD" : "#34404B", fontSize: 13, lineHeight: 19 }}>{item}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 18 }]}
                  onPress={async () => {
                    await AsyncStorage.setItem("@finflow_ultimas_novidades_exibidas", RELEASE_NOTES.id);
                    setModalAtualizacao(null);
                  }}
                >
                  <MaterialIcons name="check" size={18} color="#FFF" />
                  <Text style={styles.modalLimiteBtnText}>Continuar</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={
          pendenciasCadastro.length === 0 &&
          !tutorialBloqueando &&
          resumoDissolucao === null &&
          decisoesContaDissolucao.length === 0 &&
          decisoesCaixinha.length === 0 &&
          modalAtualizacao === null &&
          notificacoesParceria.length === 0 &&
          modalNotificacoes !== null
        }
        onRequestClose={async () => {
          if (modalNotificacoes === "pergunta" && session?.user?.id) {
            await AsyncStorage.setItem(`@notificacoes_perguntado_${session.user.id}`, "true");
          }
          setModalNotificacoes(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalLimite, { backgroundColor: isDark ? "#1E1E1E" : "#FFF" }]}>
            <View style={[styles.modalLimiteTopo, { backgroundColor: "rgba(42,157,143,0.14)" }]}>
              <MaterialIcons
                name={modalNotificacoes === "ativado" ? "notifications-active" : "notifications-none"}
                size={34}
                color="#2A9D8F"
              />
            </View>
            <Text style={[styles.modalLimiteTitulo, { color: isDark ? "#FFF" : "#17212B" }]}>
              {modalNotificacoes === "ativado" ? "Notificações ativadas" : "Ativar notificações?"}
            </Text>
            <Text style={[styles.modalLimiteMensagem, { color: isDark ? "#AAA" : "#66717D" }]}>
              {modalNotificacoes === "ativado"
                ? "Você receberá lembretes importantes sobre seus lançamentos."
                : "Deseja receber lembretes de lançamentos próximos do vencimento e outros avisos financeiros?"}
            </Text>

            {modalNotificacoes === "pergunta" ? (
              <>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 14 }]}
                  onPress={async () => {
                    const uid = session?.user?.id;
                    if (!uid) return setModalNotificacoes(null);
                    const concedida = await pedirPermissaoNotificacoes();
                    await AsyncStorage.setItem(`@notificacoes_perguntado_${uid}`, "true");
                    if (!concedida) return setModalNotificacoes(null);
                    setNotificacoesAtivas(true);
                    await AsyncStorage.setItem(`@notificacoes_enabled_${uid}`, "true");
                    setModalNotificacoes("ativado");
                  }}
                >
                  <MaterialIcons name="notifications-active" size={18} color="#FFF" />
                  <Text style={styles.modalLimiteBtnText}>Sim, ativar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalLimiteBtnFechar, { backgroundColor: isDark ? "#2C2C2C" : "#F3F4F6", marginTop: 8 }]}
                  onPress={async () => {
                    if (session?.user?.id) {
                      await AsyncStorage.setItem(`@notificacoes_perguntado_${session.user.id}`, "true");
                    }
                    setModalNotificacoes(null);
                  }}
                >
                  <Text style={[styles.modalLimiteBtnFecharText, { color: isDark ? "#AAA" : "#6B7280" }]}>
                    Agora não
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.modalLimiteBtnUpgrade, { backgroundColor: "#2A9D8F", marginTop: 14 }]}
                onPress={() => setModalNotificacoes(null)}
              >
                <Text style={styles.modalLimiteBtnText}>Entendi</Text>
              </TouchableOpacity>
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
  lockScreen: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  lockGlowTop: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    top: -250,
    right: -150,
    opacity: 0.24,
  },
  lockGlowBottom: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    bottom: -245,
    left: -175,
    opacity: 0.48,
  },
  lockContent: { width: "100%", maxWidth: 460, paddingHorizontal: 24 },
  lockBrand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 22 },
  lockBrandIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  lockBrandText: { fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  lockCard: {
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: FinFlowRadius.large,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    ...FinFlowShadow,
  },
  lockIconHalo: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  lockIconCircle: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  lockDescription: { maxWidth: 320, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 },
  lockMethod: { width: "100%", minHeight: 44, borderRadius: FinFlowRadius.small, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 20, paddingHorizontal: 12 },
  lockMethodText: { fontSize: 12, fontWeight: "800", textAlign: "center" },
  lockError: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, borderRadius: FinFlowRadius.small, backgroundColor: "rgba(231,111,81,0.12)", padding: 12, marginTop: 12 },
  lockErrorText: { flex: 1, color: "#E76F51", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  lockButton: { width: "100%", minHeight: 54, borderRadius: FinFlowRadius.medium, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 16, paddingHorizontal: 18 },
  lockButtonText: { color: "#FFF", fontSize: 15, fontWeight: "900", textAlign: "center" },
  lockPrivacyRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 18, paddingHorizontal: 4 },
  lockPrivacyText: { flex: 1, fontSize: 10, lineHeight: 15, textAlign: "left" },
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
  updateList: { width: "100%", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1 },
  updateItem: { flexDirection: "row", alignItems: "center", gap: 9 },
});
