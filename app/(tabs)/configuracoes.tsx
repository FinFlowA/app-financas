import { MaterialIcons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Modal from "../../components/FinFlowScreen";
import FinFlowPopup from "../../components/FinFlowPopup";
import { SafeAreaView } from "react-native-safe-area-context";
import { IS_LOCAL_DEMO, supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { finFlowTheme, FinFlowTabHeader } from "../../constants/finflow-design";
import {
  cancelarNotificacoesOpcionais,
  limparNotificacoesAoSair,
  obterPreferenciasNotificacoes,
  PREFERENCIAS_NOTIFICACOES_PADRAO,
  salvarPreferenciasNotificacoes,
  type PreferenciasNotificacoes,
} from "../../lib/notifications";
import {
  limparFilaFinanceiraDoUsuario,
  OFFLINE_SYNC_COMPLETED_EVENT,
  obterResumoFilaFinanceiraOffline,
  removerItemFalhoDaFilaFinanceira,
  sincronizarFilaFinanceiraOffline,
  type OfflineQueuePanelItem,
  type OfflineQueuePanelSnapshot,
} from "../../lib/offline-sync";

// URLs das páginas legais (GitHub Pages — atualizar quando publicado)
const URL_PRIVACIDADE = "https://finflowa.github.io/finflow-legal/#privacidade";
const URL_TERMOS = "https://finflowa.github.io/finflow-legal/#termos";

const OPCOES_NOTIFICACOES: { key: keyof PreferenciasNotificacoes; titulo: string; descricao: string; icone: keyof typeof MaterialIcons.glyphMap; cor: string }[] = [
  { key: "transacoesVencidas", titulo: "Lançamentos vencidos", descricao: "Avisos de despesas e receitas que passaram do prazo.", icone: "warning-amber", cor: "#E76F51" },
  { key: "transacoesDoDia", titulo: "Vencimentos do dia", descricao: "Lembretes dos lançamentos previstos para hoje.", icone: "event", cor: "#457B9D" },
  { key: "fechamentoFatura", titulo: "Fechamento da fatura", descricao: "Avisos antes e no dia do fechamento do cartão.", icone: "lock-clock", cor: "#805AD5" },
  { key: "vencimentoFatura", titulo: "Vencimento da fatura", descricao: "Lembretes antes e no dia de pagar a fatura.", icone: "credit-card", cor: "#E76F51" },
  { key: "limiteCartao", titulo: "Limite do cartão", descricao: "Alerta quando o uso do limite ultrapassar 80%.", icone: "speed", cor: "#F4A261" },
  { key: "prazoObjetivos", titulo: "Prazos dos objetivos", descricao: "Lembretes quando uma meta estiver perto do prazo.", icone: "savings", cor: "#2A9D8F" },
];

const SETTINGS_HEADER_COLLAPSE_DISTANCE = FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight;

const EMPTY_OFFLINE_QUEUE_SNAPSHOT: OfflineQueuePanelSnapshot = {
  queued: 0,
  failed: 0,
  items: [],
};

function formatarDataItemOffline(createdAt: string): string {
  const data = new Date(createdAt);
  if (!Number.isFinite(data.getTime())) return "Data indisponível";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mensagemSeguraErroExclusao(error: unknown): string {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; details?: unknown }
    : {};
  const marker = [candidate.code, candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (marker.includes("AUTH_STEP_UP_REQUIRED")) {
    return "Sua confirmação de identidade expirou. Digite a senha novamente e repita a exclusão.";
  }
  if (marker.includes("ACCOUNT_PARTNERSHIP_PENDING")) {
    return "Encerre a parceria ou o convite pendente antes de excluir sua conta.";
  }
  if (marker.includes("ACCOUNT_DISSOLUTION_PENDING")) {
    return "Conclua as decisões da separação que aparecem no app antes de excluir sua conta.";
  }
  if (marker.includes("ACCOUNT_SUBSCRIPTION_ACTIVE")) {
    return "Cancele a assinatura e aguarde a confirmação de que não existe pagamento pendente antes de excluir sua conta.";
  }
  if (candidate.code === "23503" || marker.includes("foreign key")) {
    return "Ainda existem vínculos financeiros ligados à conta. Encerre a parceria ou as pendências informadas em Ajustes e tente novamente.";
  }
  return "Não foi possível remover sua conta agora. Nenhum dado foi apagado. Tente novamente ou contate o suporte.";
}

export default function ConfiguracoesScreen() {
  const { isDark, toggleTheme, isBiometricEnabled, toggleBiometric, session, showToast, notificacoesAtivas, toggleNotificacoes, plano, limitsEnabled } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ abrirNotificacoes?: string; parceriaId?: string }>();
  const novoTema = finFlowTheme(isDark);
  const scrollY = useRef(new Animated.Value(0)).current;
  const cabecalhoCompactoRef = useRef(false);
  const [cabecalhoCompacto, setCabecalhoCompacto] = useState(false);

  const meuEmail = session?.user?.email || "";
  const meuId = session?.user?.id;

  const Cores = {
    fundo: novoTema.background,
    texto: novoTema.text,
    secundario: novoTema.textMuted,
    card: novoTema.surface,
    borda: novoTema.border,
    input: novoTema.surfaceMuted,
    pillFundo: novoTema.surfaceMuted,
  };

  // Parceria
  const [parceria, setParceria] = useState<any>(null);
  const [emailConvite, setEmailConvite] = useState("");
  const [loadingParceria, setLoadingParceria] = useState(false);

  // Edição de perfil
  const [modalPerfilVisivel, setModalPerfilVisivel] = useState(false);
  const [nomeEdit, setNomeEdit] = useState("");
  const [loadingPerfil, setLoadingPerfil] = useState(false);

  const [modalConfirmarAcao, setModalConfirmarAcao] = useState<{
    titulo: string; mensagem: string; labelConfirm: string; cor?: string;
    onConfirm: () => void;
  } | null>(null);

  // Exclusão de conta: exige senha atual verificada no servidor logo antes da
  // chamada que apaga tudo — biometria sozinha só prova algo ao dispositivo,
  // não ao backend.
  const [modalSenhaExclusaoVisivel, setModalSenhaExclusaoVisivel] = useState(false);
  const [senhaExclusao, setSenhaExclusao] = useState("");
  const [verificandoExclusao, setVerificandoExclusao] = useState(false);

  const [modalInfo, setModalInfo] = useState<{ titulo: string; mensagem: string; cor?: string } | null>(null);

  // Feedback
  const [modalFeedbackVisivel, setModalFeedbackVisivel] = useState(false);
  const [tipoFeedback, setTipoFeedback] = useState<"problema" | "sugestao" | "reclamação">("sugestao");
  const [mensagemFeedback, setMensagemFeedback] = useState("");
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [modalPreferenciasNotificacoes, setModalPreferenciasNotificacoes] = useState(false);
  const [loadingPreferenciasNotificacoes, setLoadingPreferenciasNotificacoes] = useState(false);
  const [preferenciasNotificacoes, setPreferenciasNotificacoes] = useState<PreferenciasNotificacoes>(PREFERENCIAS_NOTIFICACOES_PADRAO);
  const [modalFilaOfflineVisivel, setModalFilaOfflineVisivel] = useState(false);
  const [resumoFilaOffline, setResumoFilaOffline] = useState<OfflineQueuePanelSnapshot>(EMPTY_OFFLINE_QUEUE_SNAPSHOT);
  const [loadingFilaOffline, setLoadingFilaOffline] = useState(false);
  const [sincronizandoFilaOffline, setSincronizandoFilaOffline] = useState(false);
  const [removendoItemOfflineId, setRemovendoItemOfflineId] = useState<string | null>(null);

  const carregarParceria = async () => {
    if (!meuId || !meuEmail) return;
    const { data } = await supabase
      .from("parcerias")
      .select("*")
      .or(`solicitante_id.eq.${meuId},convidado_id.eq.${meuId},convidado_email.eq.${meuEmail}`)
      .order("id", { ascending: false });

    if (!data || data.length === 0) { setParceria(null); return; }

    const parceriaSolicitada = params.parceriaId
      ? data.find((p) => String(p.id) === String(params.parceriaId))
      : null;
    if (parceriaSolicitada) {
      setParceria(parceriaSolicitada);
      return;
    }

    // Prioriza: convite aberto pela notificação > aceito > pendente mais recente
    const aceito = data.find((p) => p.status === "aceito");
    setParceria(aceito ?? data[0]);
  };

  const carregarResumoFilaOffline = useCallback(async (exibirLoading = false): Promise<OfflineQueuePanelSnapshot | null> => {
    if (!meuId) {
      setResumoFilaOffline(EMPTY_OFFLINE_QUEUE_SNAPSHOT);
      return EMPTY_OFFLINE_QUEUE_SNAPSHOT;
    }
    if (exibirLoading) setLoadingFilaOffline(true);
    try {
      const resumo = await obterResumoFilaFinanceiraOffline();
      setResumoFilaOffline(resumo);
      return resumo;
    } catch {
      return null;
    } finally {
      if (exibirLoading) setLoadingFilaOffline(false);
    }
  }, [meuId]);

  // Mantém o mesmo ciclo de montagem da última versão estável desta tela.
  // `session` é a fonte única dos dados de perfil durante o foco da aba.
  useFocusEffect(useCallback(() => {
    carregarParceria();
    const meta = session?.user?.user_metadata;
    setNomeEdit(typeof meta?.nome_usuario === "string"
      ? meta.nome_usuario
      : typeof meta?.full_name === "string" ? meta.full_name : "");
    if (meuId) {
      void obterPreferenciasNotificacoes(meuId).then(setPreferenciasNotificacoes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]));

  useFocusEffect(useCallback(() => {
    void carregarResumoFilaOffline();
  }, [carregarResumoFilaOffline]));

  React.useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(OFFLINE_SYNC_COMPLETED_EVENT, () => {
      void carregarResumoFilaOffline();
    });
    return () => subscription.remove();
  }, [carregarResumoFilaOffline]);

  const abrirPreferenciasNotificacoes = async () => {
    setModalPreferenciasNotificacoes(true);
    if (!meuId) return;
    setLoadingPreferenciasNotificacoes(true);
    try {
      setPreferenciasNotificacoes(await obterPreferenciasNotificacoes(meuId));
    } finally {
      setLoadingPreferenciasNotificacoes(false);
    }
  };

  const confirmarPreferenciasNotificacoes = async () => {
    if (!meuId) return;
    setLoadingPreferenciasNotificacoes(true);
    try {
      const atualizadas = await salvarPreferenciasNotificacoes(meuId, preferenciasNotificacoes);
      await cancelarNotificacoesOpcionais(meuId);
      setPreferenciasNotificacoes(atualizadas);
      DeviceEventEmitter.emit("finflow:notificacoes-alteradas", atualizadas);
      setModalPreferenciasNotificacoes(false);
      showToast("Preferências de notificação salvas", "success");
    } finally {
      setLoadingPreferenciasNotificacoes(false);
    }
  };

  const abrirFilaOffline = async () => {
    setModalFilaOfflineVisivel(true);
    const resumo = await carregarResumoFilaOffline(true);
    if (!resumo) showToast("Não foi possível consultar a fila deste dispositivo.", "error");
  };

  const sincronizarFilaOfflineAgora = async () => {
    if (sincronizandoFilaOffline || removendoItemOfflineId || IS_LOCAL_DEMO) return;
    setSincronizandoFilaOffline(true);
    try {
      const resultado = await sincronizarFilaFinanceiraOffline();
      const resumoAtualizado = await carregarResumoFilaOffline();
      if (resultado && (resultado.succeeded > 0 || resultado.failed > 0)) {
        DeviceEventEmitter.emit(OFFLINE_SYNC_COMPLETED_EVENT);
      }
      if (!resumoAtualizado) {
        showToast("Não foi possível atualizar o estado da sincronização.", "error");
      } else if (resultado === null && resumoAtualizado.items.length > 0) {
        showToast("Sem conexão. Os itens continuam protegidos neste dispositivo.", "info");
      } else if (resumoAtualizado.failed > 0) {
        showToast("Há itens que ainda não puderam ser sincronizados.", "error");
      } else if (resumoAtualizado.queued > 0) {
        showToast("A sincronização continuará quando a conexão estiver disponível.", "info");
      } else {
        showToast("Tudo sincronizado.", "success");
      }
    } catch {
      showToast("Não foi possível sincronizar agora. Seus itens continuam protegidos.", "error");
      await carregarResumoFilaOffline();
    } finally {
      setSincronizandoFilaOffline(false);
    }
  };

  const removerItemOfflineFalho = async (itemId: string) => {
    if (sincronizandoFilaOffline || removendoItemOfflineId) return;
    setModalConfirmarAcao(null);
    setRemovendoItemOfflineId(itemId);
    try {
      const removido = await removerItemFalhoDaFilaFinanceira(itemId);
      await carregarResumoFilaOffline();
      showToast(
        removido ? "Item falho removido deste dispositivo." : "Este item não está mais disponível para remoção.",
        removido ? "success" : "info",
      );
    } catch {
      showToast("Não foi possível remover este item. Tente novamente.", "error");
    } finally {
      setRemovendoItemOfflineId(null);
    }
  };

  const confirmarRemocaoItemOffline = (item: OfflineQueuePanelItem) => {
    if (item.status !== "failed" || sincronizandoFilaOffline || removendoItemOfflineId) return;
    setModalConfirmarAcao({
      titulo: "Remover item com falha?",
      mensagem: "Esta ação local será descartada e não chegará ao servidor. Somente este item será removido; as demais pendências continuarão protegidas.",
      labelConfirm: "Remover este item",
      cor: "#E76F51",
      onConfirm: () => void removerItemOfflineFalho(item.id),
    });
  };

  React.useEffect(() => {
    if (params.abrirNotificacoes !== "1") return;
    void abrirPreferenciasNotificacoes();
    router.setParams({ abrirNotificacoes: "" });
    // A função usa apenas o usuário atual; o parâmetro é consumido uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.abrirNotificacoes]);

  React.useEffect(() => {
    if (!params.parceriaId) return;
    void carregarParceria();
    // O id vem do aviso persistente e precisa selecionar exatamente o convite
    // correspondente, inclusive se Ajustes ja estiver aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.parceriaId]);

  const enviarConvite = async () => {
    const emailNormalizado = emailConvite.toLowerCase().trim();

    if (!emailNormalizado) return Alert.alert("Aviso", "Digite o e-mail do seu parceiro(a).");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNormalizado))
      return Alert.alert("E-mail inválido", "Digite um e-mail válido (ex: nome@gmail.com).");

    if (emailNormalizado === meuEmail.toLowerCase())
      return Alert.alert("Aviso", "Você não pode convidar a si mesmo!");

    setLoadingParceria(true);

    // Verifica se já enviou convite para este e-mail
    const { data: existente } = await supabase
      .from("parcerias")
      .select("id, status")
      .eq("solicitante_id", meuId)
      .eq("convidado_email", emailNormalizado);

    if (existente && existente.length > 0) {
      setLoadingParceria(false);
      const st = existente[0].status;
      if (st === "aceito") return Alert.alert("Aviso", "Você já tem uma parceria ativa com este e-mail.");
      if (st === "pendente") return Alert.alert("Aviso", "Já existe um convite pendente para este e-mail.");
    }

    const { error } = await supabase.from("parcerias").insert([{
      solicitante_id: meuId,
      convidado_email: emailNormalizado,
      status: "pendente",
    }]);
    setLoadingParceria(false);

    if (error) {
      const usuarioNaoEncontrado = error.code === "P0002"
        || error.message?.includes("finflow_invitee_not_found")
        || error.details?.includes("finflow_invitee_not_found");

      if (usuarioNaoEncontrado) {
        setModalInfo({
          titulo: "E-mail sem cadastro",
          mensagem: `Não encontramos uma conta FinFlow vinculada a ${emailNormalizado}. Peça para essa pessoa criar uma conta antes de enviar o convite.`,
          cor: "#E76F51",
        });
        return;
      }

      Alert.alert("Erro", "Não foi possível enviar o convite. Tente novamente.");
    }
    else {
      Alert.alert("Convite Enviado!", `Um convite foi enviado para ${emailNormalizado}.\n\nEle(a) verá o convite ao abrir o app.`);
      setEmailConvite("");
      carregarParceria();
    }
  };

  const aceitarConvite = async () => {
    setLoadingParceria(true);
    const { error } = await supabase.from("parcerias").update({ convidado_id: meuId, status: "aceito" }).eq("id", parceria.id);
    setLoadingParceria(false);
    if (error) Alert.alert("Erro", "Falha ao aceitar o convite.");
    else {
      setModalInfo({
        titulo: "Parceria formada!",
        mensagem: "O vínculo foi confirmado. Agora vocês podem usar os recursos compartilhados do FinFlow.",
        cor: "#2A9D8F",
      });
      carregarParceria();
    }
  };

  const executarDissolucaoVinculo = async () => {
    if (!parceria || !meuId) return;
    const { error } = await supabase.rpc("iniciar_dissolucao_parceria", {
      p_parceria_id: parceria.id,
    });
    if (error) throw error;
    setParceria(null);
    DeviceEventEmitter.emit("finflow:parceria-dissolvida");
  };

  const deletarParceria = async (
    mensagem: string,
    acao: "cancelar_convite" | "recusar_convite" | "desfazer_vinculo",
  ) => {
    const ehVinculoAtivo = parceria?.status === "aceito";
    setModalConfirmarAcao({
      titulo: "Atenção",
      mensagem,
      labelConfirm: acao === "recusar_convite"
        ? "Sim, recusar"
        : acao === "cancelar_convite" ? "Sim, cancelar" : "Sim, desvincular",
      cor: "#E76F51",
      onConfirm: async () => {
        setModalConfirmarAcao(null);
        setLoadingParceria(true);
        if (ehVinculoAtivo) {
          try {
            await executarDissolucaoVinculo();
          } catch {
            setModalInfo({
              titulo: "Não foi possível desfazer",
              mensagem: "Nenhuma alteração foi concluída. Tente novamente.",
              cor: "#E76F51",
            });
          }
        } else {
          // Convite pendente: apenas deletar, sem split de dados
          const { error } = await supabase.from("parcerias").delete().eq("id", parceria.id);
          if (error) {
            setModalInfo({
              titulo: "Não foi possível concluir",
              mensagem: "O convite continua ativo. Confira sua conexão e tente novamente.",
              cor: "#E76F51",
            });
          } else {
            setParceria(null);
            if (acao === "recusar_convite") {
              setModalInfo({
                titulo: "Convite recusado",
                mensagem: "O convite de parceria foi recusado com sucesso.",
                cor: "#E76F51",
              });
            }
          }
        }
        setLoadingParceria(false);
      },
    });
  };

  const handleBiometricToggle = async (novoValor: boolean) => {
    if (novoValor) {
      const temHardware = await LocalAuthentication.hasHardwareAsync();
      const temBiometria = await LocalAuthentication.isEnrolledAsync();
      if (!temHardware || !temBiometria) { Alert.alert("Aviso", "O seu celular não possui biometria configurada."); return; }
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirme a biometria" });
      if (result.success) { toggleBiometric(true); Alert.alert("Sucesso", "Proteção biométrica ativada!"); }
    } else {
      toggleBiometric(false);
    }
  };

  const handleLogout = async () => {
    setModalConfirmarAcao({
      titulo: "Sair da Conta",
      mensagem: "Tem certeza que deseja sair?",
      labelConfirm: "Sair",
      cor: "#E76F51",
      onConfirm: async () => {
        setModalConfirmarAcao(null);
        await limparNotificacoesAoSair(meuId);
        await supabase.auth.signOut({ scope: "local" });
      },
    });
  };

  const salvarPerfil = async () => {
    if (nomeEdit.trim() === "") return Alert.alert("Aviso", "O nome não pode ficar vazio.");
    setLoadingPerfil(true);
    const metadataAtual = session?.user?.user_metadata ?? {};
    const { error } = await supabase.auth.updateUser({
      data: { ...metadataAtual, nome_usuario: nomeEdit.trim() },
    });
    setLoadingPerfil(false);

    if (error) Alert.alert("Erro", "Não foi possível salvar as alterações.");
    else { showToast("Perfil atualizado ✓", "success"); setModalPerfilVisivel(false); }
  };

  const confirmarApagarConta = () => {
    setModalConfirmarAcao({
      titulo: "Apagar Conta",
      mensagem: "⚠️ Esta ação é irreversível!\n\nTodos os seus dados serão permanentemente apagados.\n\nTem certeza absoluta?",
      labelConfirm: "Sim, apagar tudo",
      cor: "#FF4444",
      onConfirm: async () => {
        setModalConfirmarAcao(null);
        // Tenta autenticar via biometria antes de excluir
        const temHardware = await LocalAuthentication.hasHardwareAsync();
        const temBiometria = await LocalAuthentication.isEnrolledAsync();

        if (temHardware && temBiometria) {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirme sua identidade para apagar a conta" });
          if (!result.success) {
            setModalInfo({
              titulo: "Exclusão cancelada",
              mensagem: "Sua conta e seus dados continuam seguros. Para excluir a conta, é necessário confirmar sua identidade.",
              cor: "#2A9D8F",
            });
            return;
          }
        }

        // Biometria (quando existe) só prova identidade ao aparelho. A senha
        // abaixo é verificada no servidor e é o que autoriza de fato a RPC de
        // exclusão — sem ela, um token roubado não conseguiria apagar a conta.
        setSenhaExclusao("");
        setModalSenhaExclusaoVisivel(true);
      },
    });
  };

  const confirmarSenhaEApagarConta = async () => {
    if (!meuId || !meuEmail) {
      setModalInfo({
        titulo: "Sessão inválida",
        mensagem: "Entre novamente antes de solicitar a exclusão da conta. Nenhum dado foi removido.",
        cor: "#FF4444",
      });
      return;
    }
    if (!senhaExclusao) {
      Alert.alert("Senha necessária", "Digite sua senha atual para confirmar a exclusão.");
      return;
    }

    setVerificandoExclusao(true);
    try {
      const { error: erroSenha } = await supabase.auth.signInWithPassword({
        email: meuEmail,
        password: senhaExclusao,
      });
      setSenhaExclusao("");

      if (erroSenha) {
        const muitasTentativas = erroSenha.code === "over_request_rate_limit";
        Alert.alert(
          muitasTentativas ? "Muitas tentativas" : "Senha incorreta",
          muitasTentativas
            ? "Aguarde alguns minutos antes de tentar novamente."
            : "A senha atual não confere. Nenhum dado foi removido.",
        );
        return;
      }

      const [parceriasAbertas, assinaturasAbertas, decisoesConta, decisoesCaixinha] = await Promise.all([
        supabase.from("parcerias").select("id").in("status", ["pendente", "aceito"]).limit(1),
        supabase.from("subscriptions").select("id").in("status", ["pending", "active", "past_due", "grace_period", "paused"]).limit(1),
        supabase.rpc("get_minhas_decisoes_conta_dissolucao"),
        supabase.rpc("get_minhas_decisoes_caixinha"),
      ]);
      if (parceriasAbertas.error || assinaturasAbertas.error || decisoesConta.error || decisoesCaixinha.error) {
        setModalInfo({
          titulo: "Não foi possível validar",
          mensagem: "Não conseguimos verificar todas as pendências da conta. Nenhum dado foi removido.",
          cor: "#FF4444",
        });
        return;
      }
      if ((parceriasAbertas.data?.length ?? 0) > 0) {
        setModalInfo({
          titulo: "Parceria pendente",
          mensagem: "Encerre a parceria ou o convite pendente antes de excluir sua conta.",
          cor: "#E76F51",
        });
        return;
      }
      if ((decisoesConta.data?.length ?? 0) > 0 || (decisoesCaixinha.data?.length ?? 0) > 0) {
        setModalInfo({
          titulo: "Separação pendente",
          mensagem: "Conclua as decisões da separação que aparecem no app antes de excluir sua conta.",
          cor: "#E76F51",
        });
        return;
      }
      if ((assinaturasAbertas.data?.length ?? 0) > 0) {
        setModalInfo({
          titulo: "Assinatura ativa",
          mensagem: "Cancele a assinatura e aguarde a confirmação de que não existe pagamento pendente antes de excluir sua conta.",
          cor: "#E76F51",
        });
        return;
      }

      // A RPC delete_user() apaga tudo em uma única transação no servidor e
      // exige, ela mesma, uma autenticação de senha recente (o login acima) —
      // não confiamos apenas na verificação que acabamos de fazer no cliente.
      const { error: erroDeletar } = await supabase.rpc("delete_user");
      if (erroDeletar) {
        setModalInfo({ titulo: "Não foi possível excluir", mensagem: mensagemSeguraErroExclusao(erroDeletar), cor: "#FF4444" });
        return;
      }

      setModalSenhaExclusaoVisivel(false);
      await Promise.allSettled([
        limparNotificacoesAoSair(meuId),
        limparFilaFinanceiraDoUsuario(meuId),
      ]);
      await supabase.auth.signOut();
      setModalInfo({ titulo: "Conta apagada", mensagem: "Sua conta e todos os dados foram removidos com sucesso.", cor: "#2A9D8F" });
    } catch (error) {
      if (__DEV__) console.error("Falha de rede ao excluir a conta", error);
      setModalInfo({
        titulo: "Não foi possível excluir",
        mensagem: "A conexão foi interrompida. Confira se a conta ainda aparece antes de tentar novamente.",
        cor: "#FF4444",
      });
    } finally {
      setVerificandoExclusao(false);
    }
  };

  const enviarFeedback = async () => {
    if (mensagemFeedback.trim().length < 10)
      return Alert.alert("Aviso", "Por favor, descreva melhor o seu feedback (mínimo 10 caracteres).");
    setLoadingFeedback(true);
    try {
      const { error } = await supabase.from("feedbacks").insert({
        user_id: meuId,
        tipo: tipoFeedback,
        mensagem: mensagemFeedback.trim(),
      });
      setLoadingFeedback(false);
      if (error) {
        Alert.alert("Erro", "Não foi possível enviar o feedback. Tente novamente.");
      } else {
        Alert.alert("Obrigado!", "Seu feedback foi enviado com sucesso. Vamos analisar e melhorar o FinFlow!");
        setMensagemFeedback("");
        setModalFeedbackVisivel(false);
      }
    } catch {
      setLoadingFeedback(false);
      Alert.alert("Erro", "Falha ao enviar feedback.");
    }
  };

  const nomeUsuario =
    (typeof session?.user?.user_metadata?.nome_usuario === "string"
      ? session.user.user_metadata.nome_usuario
      : "") ||
    (typeof session?.user?.user_metadata?.full_name === "string"
      ? session.user.user_metadata.full_name
      : "") ||
    session?.user?.email?.split("@")[0] ||
    "Usuário";

  const nomePlano = plano === "free" ? "Free" : plano === "smart" ? "Smart" : "Premium";
  const alturaCabecalho = scrollY.interpolate({
    inputRange: [0, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [FinFlowTabHeader.expandedHeight, FinFlowTabHeader.compactHeight],
    extrapolate: "clamp",
  });
  const raioCabecalho = scrollY.interpolate({
    inputRange: [0, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [FinFlowTabHeader.expandedRadius, FinFlowTabHeader.compactRadius],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, 20, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [1, 0.72, 0],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, -12],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoCompacto = scrollY.interpolate({
    inputRange: [12, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoCompacto = scrollY.interpolate({
    inputRange: [12, SETTINGS_HEADER_COLLAPSE_DISTANCE],
    outputRange: [7, 0],
    extrapolate: "clamp",
  });
  const onScrollAjustes = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const offset = Math.max(0, event.nativeEvent.contentOffset.y);
        let compacto = cabecalhoCompactoRef.current;
        if (!compacto && offset >= 34) compacto = true;
        if (compacto && offset <= 18) compacto = false;
        if (compacto !== cabecalhoCompactoRef.current) {
          cabecalhoCompactoRef.current = compacto;
          setCabecalhoCompacto(compacto);
        }
      },
    }
  ), [scrollY]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <View style={styles.screenContent}>
        <Animated.View
          style={[
            styles.header,
            {
              backgroundColor: novoTema.header,
              height: alturaCabecalho,
              borderBottomLeftRadius: raioCabecalho,
              borderBottomRightRadius: raioCabecalho,
            },
          ]}
        >
          <Animated.View
            pointerEvents={cabecalhoCompacto ? "none" : "auto"}
            style={[
              styles.headerExpandedContent,
              {
                opacity: opacidadeCabecalhoExpandido,
                transform: [{ translateY: deslocamentoCabecalhoExpandido }],
              },
            ]}
          >
            <Text style={[styles.title, { color: "#FFF" }]}>Configurações</Text>
            <TouchableOpacity
              style={[styles.ajudaBtn, { backgroundColor: "rgba(255,255,255,0.14)" }]}
              onPress={() => {
                setTipoFeedback("sugestao");
                setMensagemFeedback("");
                setModalFeedbackVisivel(true);
              }}
              accessibilityLabel="Ajuda e feedback"
            >
              <MaterialIcons name="help-outline" size={22} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            pointerEvents={cabecalhoCompacto ? "auto" : "none"}
            style={[
              styles.headerCompactContent,
              {
                opacity: opacidadeCabecalhoCompacto,
                transform: [{ translateY: deslocamentoCabecalhoCompacto }],
              },
            ]}
          >
            <View style={styles.compactProfileAvatar}>
              <Text style={styles.compactProfileAvatarText}>{nomeUsuario.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.compactProfileInfo}>
              <Text style={styles.compactHeaderTitle}>Configurações</Text>
              <Text style={styles.compactProfileSummary} numberOfLines={1}>
                {nomeUsuario} · Plano {nomePlano}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.compactHelpButton, { backgroundColor: "rgba(255,255,255,0.14)" }]}
              onPress={() => {
                setTipoFeedback("sugestao");
                setMensagemFeedback("");
                setModalFeedbackVisivel(true);
              }}
              accessibilityLabel="Ajuda e feedback"
            >
              <MaterialIcons name="help-outline" size={19} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        <Animated.ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainScrollContent}
          onScroll={onScrollAjustes}
          scrollEventThrottle={32}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

        <View style={styles.content}>

          {/* PERFIL DO USUÁRIO */}
          <TouchableOpacity
            style={[styles.perfilCard, { backgroundColor: Cores.card, borderColor: Cores.borda }]}
            onPress={() => {
              const meta = session?.user?.user_metadata;
              setNomeEdit(typeof meta?.nome_usuario === "string"
                ? meta.nome_usuario
                : typeof meta?.full_name === "string" ? meta.full_name : "");
              setModalPerfilVisivel(true);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.perfilAvatar}>
              <Text style={styles.perfilAvatarLetra}>{nomeUsuario.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.perfilNome, { color: Cores.texto }]}>{nomeUsuario}</Text>
              <Text style={[styles.perfilEmail, { color: Cores.secundario }]}>{meuEmail}</Text>
              <View style={styles.perfilPlanBadge}>
                <MaterialIcons name="workspace-premium" size={11} color="#E9C46A" />
                <Text style={styles.perfilPlanText}>Plano {plano === "free" ? "Free" : plano === "smart" ? "Smart" : "Premium"}</Text>
              </View>
            </View>
            <View style={[styles.editProfileButton, { borderColor: Cores.borda }]}>
              <MaterialIcons name="edit" size={14} color={Cores.secundario} />
              <Text style={[styles.editProfileText, { color: Cores.secundario }]}>Editar perfil</Text>
            </View>
          </TouchableOpacity>

          {/* PREFERÊNCIAS */}
          <Text style={[styles.sectionTitle, { color: Cores.secundario, marginTop: 20 }]}>PREFERÊNCIAS</Text>
          <View style={[styles.configGroup, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
            <TouchableOpacity
              style={[styles.configRow, { borderBottomWidth: 1, borderBottomColor: Cores.borda }]}
              onPress={() => router.push("/seguranca" as any)}
              activeOpacity={0.75}
            >
              <View style={styles.configLeft}>
                <MaterialIcons name="manage-accounts" size={24} color="#2A9D8F" />
                <View>
                  <Text style={[styles.configText, { color: Cores.texto }]}>Dados de acesso</Text>
                  <Text style={[styles.configSubtext, { color: Cores.secundario }]}>E-mail, telefone opcional e senha</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />
            </TouchableOpacity>
            <View style={[styles.configRow, { borderBottomWidth: 1, borderBottomColor: Cores.borda }]}>
              <View style={styles.configLeft}>
                <MaterialIcons name={isDark ? "dark-mode" : "light-mode"} size={24} color={isDark ? "#E9C46A" : "#F4A261"} />
                <Text style={[styles.configText, { color: Cores.texto }]}>Modo Escuro</Text>
              </View>
              <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: "#767577", true: "#2A9D8F" }} />
            </View>
            <View style={[styles.configRow, { borderBottomWidth: 1, borderBottomColor: Cores.borda }]}>
              <View style={styles.configLeft}>
                <MaterialIcons name={isBiometricEnabled ? "lock" : "lock-open"} size={24} color={isBiometricEnabled ? "#457B9D" : "#999"} />
                <View>
                  <Text style={[styles.configText, { color: Cores.texto }]}>Bloqueio do app</Text>
                  <Text style={[styles.configSubtext, { color: Cores.secundario }]}>Biometria ao abrir o FinFlow</Text>
                </View>
              </View>
              <Switch value={isBiometricEnabled} onValueChange={handleBiometricToggle} trackColor={{ false: "#767577", true: "#457B9D" }} />
            </View>
            <TouchableOpacity style={styles.configRow} onPress={() => void abrirPreferenciasNotificacoes()} activeOpacity={0.75}>
              <View style={styles.configLeft}>
                <MaterialIcons name={notificacoesAtivas ? "notifications-active" : "notifications-off"} size={24} color={notificacoesAtivas ? "#2A9D8F" : "#999"} />
                <View>
                  <Text style={[styles.configText, { color: Cores.texto }]}>Notificações</Text>
                  <Text style={[styles.configSubtext, { color: Cores.secundario }]}>{notificacoesAtivas ? "Escolha quais deseja receber" : "Desativadas · toque para configurar"}</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />
            </TouchableOpacity>
          </View>

          {/* SINCRONIZAÇÃO OFFLINE */}
          <Text style={[styles.sectionTitle, { color: Cores.secundario, marginTop: 25 }]}>SINCRONIZAÇÃO</Text>
          <View style={[styles.configGroup, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
            <TouchableOpacity
              style={styles.configRow}
              onPress={() => void abrirFilaOffline()}
              activeOpacity={0.75}
              accessibilityLabel="Abrir dados aguardando sincronização"
            >
              <View style={[styles.configLeft, { flex: 1, minWidth: 0 }]}>
                <View style={[styles.offlineSettingsIcon, { backgroundColor: novoTema.primarySoft }]}>
                  <MaterialIcons name="cloud-sync" size={22} color="#2A9D8F" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.configText, styles.offlineSettingsText, { color: Cores.texto }]}>Dados aguardando sincronização</Text>
                  <Text style={[styles.configSubtext, styles.offlineSettingsSubtext, { color: Cores.secundario }]}>
                    {loadingFilaOffline
                      ? "Atualizando…"
                      : resumoFilaOffline.items.length === 0
                        ? "Tudo sincronizado"
                        : `${resumoFilaOffline.queued} aguardando · ${resumoFilaOffline.failed} com falha`}
                  </Text>
                </View>
              </View>
              {loadingFilaOffline
                ? <ActivityIndicator size="small" color="#2A9D8F" />
                : <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />}
            </TouchableOpacity>
          </View>

          {/* CONTA CONJUNTA */}
          <Text style={[styles.sectionTitle, { color: Cores.secundario, marginTop: 25 }]}>CONTA CONJUNTA (PARCEIRO)</Text>
          <View style={[styles.configGroup, { backgroundColor: Cores.card, borderColor: Cores.borda, padding: 15 }]}>
            {loadingParceria ? (
              <ActivityIndicator size="small" color="#2A9D8F" style={{ padding: 20 }} />
            ) : !parceria ? (
              <>
                <Text style={[styles.helpText, { color: Cores.secundario }]}>
                  Vincule a conta do seu cônjuge/parceiro para partilharem despesas. O parceiro deve ter uma conta cadastrada no FinFlow.
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                  placeholder="E-mail cadastrado no FinFlow"
                  placeholderTextColor={Cores.secundario}
                  value={emailConvite}
                  onChangeText={(v) => setEmailConvite(v.toLowerCase().trim())}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
                <TouchableOpacity
                  style={[styles.actionBtn, loadingParceria && { opacity: 0.6 }]}
                  onPress={enviarConvite}
                  disabled={loadingParceria}
                >
                  {loadingParceria
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.actionBtnText}>Enviar Convite</Text>
                  }
                </TouchableOpacity>
              </>
            ) : parceria.status === "pendente" ? (
              parceria.solicitante_id === meuId ? (
                <View style={styles.centerBox}>
                  <MaterialIcons name="hourglass-empty" size={30} color="#F4A261" />
                  <Text style={[styles.statusText, { color: Cores.texto }]}>Aguardando aceitação de:</Text>
                  <Text style={[styles.emailText, { color: Cores.texto }]}>{parceria.convidado_email}</Text>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#E76F51", marginTop: 15 }]} onPress={() => deletarParceria("Deseja cancelar este convite?", "cancelar_convite")}>
                    <Text style={styles.actionBtnText}>Cancelar Convite</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.centerBox}>
                  <MaterialIcons name="mail" size={30} color="#2A9D8F" />
                  <Text style={[styles.statusText, { color: Cores.texto }]}>Você recebeu um convite para Conta Conjunta!</Text>
                  <View style={styles.rowBtns}>
                    <TouchableOpacity style={[styles.actionBtn, { flex: 1, backgroundColor: "#E76F51", marginRight: 10 }]} onPress={() => deletarParceria("Deseja recusar o convite?", "recusar_convite")}>
                      <Text style={styles.actionBtnText}>Recusar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={aceitarConvite}>
                      <Text style={styles.actionBtnText}>Aceitar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            ) : (
              <View style={styles.centerBox}>
                <MaterialIcons name="favorite" size={40} color="#E76F51" />
                <Text style={[styles.statusText, { color: Cores.texto, marginTop: 10 }]}>Contas vinculadas com sucesso!</Text>
                <Text style={[styles.helpText, { color: Cores.secundario, textAlign: "center", marginTop: 5 }]}>
                  {"Agora você verá a opção “Compartilhar” ao criar uma Conta Nova."}
                </Text>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#E76F51", marginTop: 20 }]} onPress={() => deletarParceria("Tem certeza que deseja desfazer o vínculo com seu parceiro(a)?", "desfazer_vinculo")}>
                  <Text style={[styles.actionBtnText, { color: "#E76F51" }]}>Desfazer Vínculo</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* PLANO ATUAL */}
          <Text style={[styles.sectionTitle, { color: Cores.secundario, marginTop: 25 }]}>MEU PLANO</Text>
          <TouchableOpacity
            style={[styles.configGroup, { backgroundColor: Cores.card, borderColor: Cores.borda, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            onPress={() => router.push("/planos" as any)}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: plano === "premium" ? "rgba(244,162,97,0.2)" : plano === "smart" ? "rgba(42,157,143,0.2)" : "rgba(150,150,150,0.2)", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons
                  name="workspace-premium"
                  size={22}
                  color={plano === "premium" ? "#F4A261" : plano === "smart" ? "#2A9D8F" : "#999"}
                />
              </View>
              <View>
                <Text style={[{ color: Cores.texto, fontWeight: "bold", fontSize: 16 }]}>
                  Plano {plano === "free" ? "Free" : plano === "smart" ? "Smart" : "Premium"}
                </Text>
                <Text style={[{ color: Cores.secundario, fontSize: 12 }]}>
                  {!limitsEnabled ? "Todas as funções liberadas durante o desenvolvimento" : plano === "free" ? "Gratuito · Toque para fazer upgrade" : plano === "smart" ? "R$ 9,90/mês · Smart" : "R$ 19,90/mês · Premium"}
                </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={Cores.secundario} />
          </TouchableOpacity>

          {/* LINKS LEGAIS */}
          <Text style={[styles.sectionTitle, { color: Cores.secundario, marginTop: 25 }]}>LEGAL</Text>
          <View style={[styles.configGroup, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
            <TouchableOpacity
              style={[styles.configRow, { borderBottomWidth: 1, borderBottomColor: Cores.borda }]}
              onPress={() => WebBrowser.openBrowserAsync(URL_PRIVACIDADE)}
            >
              <View style={styles.configLeft}>
                <MaterialIcons name="privacy-tip" size={22} color="#457B9D" />
                <Text style={[styles.configText, { color: Cores.texto }]}>Política de Privacidade</Text>
              </View>
              <MaterialIcons name="open-in-new" size={18} color={Cores.secundario} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.configRow}
              onPress={() => WebBrowser.openBrowserAsync(URL_TERMOS)}
            >
              <View style={styles.configLeft}>
                <MaterialIcons name="description" size={22} color="#457B9D" />
                <Text style={[styles.configText, { color: Cores.texto }]}>Termos de Uso</Text>
              </View>
              <MaterialIcons name="open-in-new" size={18} color={Cores.secundario} />
            </TouchableOpacity>
          </View>

          {/* VERSÃO */}
          <Text style={[{ color: Cores.secundario, fontSize: 12, textAlign: "center", marginTop: 16 }]}>
            FinFlow v2.0.0
          </Text>

          {/* SAIR */}
          <TouchableOpacity style={[styles.logoutButton, { borderColor: Cores.borda, marginTop: 20 }]} onPress={handleLogout}>
            <MaterialIcons name="logout" size={24} color="#E76F51" />
            <Text style={styles.logoutText}>Sair da Conta</Text>
          </TouchableOpacity>

          {/* APAGAR CONTA */}
          <TouchableOpacity style={styles.apagarContaBtn} onPress={confirmarApagarConta}>
            <MaterialIcons name="delete-forever" size={20} color="#FF4444" />
            <Text style={styles.apagarContaText}>Apagar Minha Conta</Text>
          </TouchableOpacity>

          <Text style={[styles.apagarContaAviso, { color: Cores.secundario }]}>
            A exclusão remove permanentemente todos os seus dados do servidor.
          </Text>

        </View>
        </Animated.ScrollView>
      </View>

      {modalFilaOfflineVisivel && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalFilaOfflineVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.offlineQueueModal, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
            <View style={styles.notificationPreferencesHeader}>
              <View style={[styles.notificationPreferencesIcon, { backgroundColor: novoTema.primarySoft }]}>
                <MaterialIcons name="cloud-sync" size={24} color="#2A9D8F" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.notificationPreferencesTitle, { color: Cores.texto }]}>Sincronização offline</Text>
                <Text style={[styles.notificationPreferencesSubtitle, { color: Cores.secundario }]}>Acompanhe apenas o estado das ações salvas neste dispositivo.</Text>
              </View>
              <TouchableOpacity
                style={styles.notificationPreferencesClose}
                onPress={() => setModalFilaOfflineVisivel(false)}
                disabled={sincronizandoFilaOffline || Boolean(removendoItemOfflineId)}
                accessibilityLabel="Fechar sincronização offline"
              >
                <MaterialIcons name="close" size={22} color={Cores.secundario} />
              </TouchableOpacity>
            </View>

            <View style={styles.offlineQueueMetrics}>
              <View style={[styles.offlineQueueMetric, { backgroundColor: Cores.input, borderColor: Cores.borda }]}>
                <View style={[styles.offlineQueueMetricIcon, { backgroundColor: "rgba(69,123,157,0.14)" }]}>
                  <MaterialIcons name="schedule" size={19} color="#457B9D" />
                </View>
                <Text style={[styles.offlineQueueMetricValue, { color: Cores.texto }]}>{resumoFilaOffline.queued}</Text>
                <Text style={[styles.offlineQueueMetricLabel, { color: Cores.secundario }]}>Aguardando</Text>
              </View>
              <View style={[styles.offlineQueueMetric, { backgroundColor: Cores.input, borderColor: Cores.borda }]}>
                <View style={[styles.offlineQueueMetricIcon, { backgroundColor: "rgba(231,111,81,0.14)" }]}>
                  <MaterialIcons name="error-outline" size={19} color="#E76F51" />
                </View>
                <Text style={[styles.offlineQueueMetricValue, { color: Cores.texto }]}>{resumoFilaOffline.failed}</Text>
                <Text style={[styles.offlineQueueMetricLabel, { color: Cores.secundario }]}>Com falha</Text>
              </View>
            </View>

            <View style={[styles.offlineQueueNotice, { backgroundColor: Cores.input, borderColor: Cores.borda }]}>
              <MaterialIcons name="privacy-tip" size={17} color="#2A9D8F" />
              <Text style={[styles.offlineQueueNoticeText, { color: Cores.secundario }]}>Valores, descrições e referências financeiras não são exibidos aqui.</Text>
            </View>

            {IS_LOCAL_DEMO && (
              <View style={styles.offlineQueueLocalNotice}>
                <MaterialIcons name="memory" size={17} color="#F4A261" />
                <Text style={styles.offlineQueueLocalNoticeText}>No modo local da web, a fila fica somente na memória desta sessão e não envia dados ao banco.</Text>
              </View>
            )}

            <ScrollView style={styles.offlineQueueList} contentContainerStyle={resumoFilaOffline.items.length === 0 ? styles.offlineQueueEmptyList : undefined} showsVerticalScrollIndicator={false}>
              {loadingFilaOffline ? (
                <ActivityIndicator size="small" color="#2A9D8F" style={{ marginVertical: 30 }} />
              ) : resumoFilaOffline.items.length === 0 ? (
                <View style={styles.offlineQueueEmpty}>
                  <View style={[styles.offlineQueueEmptyIcon, { backgroundColor: novoTema.primarySoft }]}>
                    <MaterialIcons name="cloud-done" size={28} color="#2A9D8F" />
                  </View>
                  <Text style={[styles.offlineQueueEmptyTitle, { color: Cores.texto }]}>Tudo sincronizado</Text>
                  <Text style={[styles.offlineQueueEmptyText, { color: Cores.secundario }]}>Nenhuma ação financeira está aguardando neste dispositivo.</Text>
                </View>
              ) : resumoFilaOffline.items.map((item) => {
                const itemComFalha = item.status === "failed";
                const removendoEsteItem = removendoItemOfflineId === item.id;
                return (
                  <View key={item.id} style={[styles.offlineQueueItem, { borderBottomColor: Cores.borda }]}>
                    <View style={[styles.offlineQueueItemIcon, { backgroundColor: itemComFalha ? "rgba(231,111,81,0.14)" : "rgba(69,123,157,0.14)" }]}>
                      <MaterialIcons name={itemComFalha ? "error-outline" : "schedule"} size={19} color={itemComFalha ? "#E76F51" : "#457B9D"} />
                    </View>
                    <View style={styles.offlineQueueItemContent}>
                      <Text style={[styles.offlineQueueItemTitle, { color: Cores.texto }]}>{item.actionLabel}</Text>
                      <Text style={[styles.offlineQueueItemMeta, { color: Cores.secundario }]}>
                        {formatarDataItemOffline(item.createdAt)} · {item.attempts} {item.attempts === 1 ? "tentativa" : "tentativas"}
                      </Text>
                      <Text style={[styles.offlineQueueItemStatus, { color: itemComFalha ? "#E76F51" : "#457B9D" }]}>
                        {itemComFalha ? item.failureMessage : "Aguardando conexão"}
                      </Text>
                    </View>
                    {itemComFalha && (
                      <TouchableOpacity
                        style={[styles.offlineQueueRemoveButton, { borderColor: "rgba(231,111,81,0.35)" }, (sincronizandoFilaOffline || removendoItemOfflineId) && { opacity: 0.45 }]}
                        onPress={() => confirmarRemocaoItemOffline(item)}
                        disabled={sincronizandoFilaOffline || Boolean(removendoItemOfflineId)}
                        accessibilityLabel={`Remover ${item.actionLabel.toLowerCase()} com falha`}
                      >
                        {removendoEsteItem
                          ? <ActivityIndicator size="small" color="#E76F51" />
                          : <MaterialIcons name="delete-outline" size={20} color="#E76F51" />}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.offlineQueueSyncButton, (IS_LOCAL_DEMO || sincronizandoFilaOffline || loadingFilaOffline || removendoItemOfflineId) && { opacity: 0.5 }]}
              onPress={() => void sincronizarFilaOfflineAgora()}
              disabled={IS_LOCAL_DEMO || sincronizandoFilaOffline || loadingFilaOffline || Boolean(removendoItemOfflineId)}
            >
              {sincronizandoFilaOffline
                ? <ActivityIndicator size="small" color="#FFF" />
                : <MaterialIcons name="sync" size={20} color="#FFF" />}
              <Text style={styles.offlineQueueSyncText}>Sincronizar agora</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {modalPreferenciasNotificacoes && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalPreferenciasNotificacoes(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.notificationPreferencesModal, { backgroundColor: Cores.card, borderColor: Cores.borda }]}>
            <View style={styles.notificationPreferencesHeader}>
              <View style={[styles.notificationPreferencesIcon, { backgroundColor: novoTema.primarySoft }]}>
                <MaterialIcons name="notifications-active" size={24} color="#2A9D8F" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.notificationPreferencesTitle, { color: Cores.texto }]}>Notificações</Text>
                <Text style={[styles.notificationPreferencesSubtitle, { color: Cores.secundario }]}>Escolha os avisos que fazem sentido para você.</Text>
              </View>
              <TouchableOpacity style={styles.notificationPreferencesClose} onPress={() => setModalPreferenciasNotificacoes(false)}>
                <MaterialIcons name="close" size={22} color={Cores.secundario} />
              </TouchableOpacity>
            </View>

            <View style={[styles.notificationMasterRow, { backgroundColor: Cores.input, borderColor: Cores.borda }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.notificationMasterTitle, { color: Cores.texto }]}>Permitir notificações</Text>
                <Text style={[styles.notificationMasterText, { color: Cores.secundario }]}>Controle geral deste dispositivo</Text>
              </View>
              <Switch value={notificacoesAtivas} onValueChange={(value) => void toggleNotificacoes(value)} trackColor={{ false: "#767577", true: "#2A9D8F" }} />
            </View>

            {!notificacoesAtivas && (
              <View style={styles.notificationDisabledNotice}>
                <MaterialIcons name="info-outline" size={16} color="#F4A261" />
                <Text style={styles.notificationDisabledText}>Suas escolhas serão salvas, mas os avisos só serão enviados quando a permissão geral estiver ativa.</Text>
              </View>
            )}

            <ScrollView style={styles.notificationOptionsList} showsVerticalScrollIndicator={false}>
              {OPCOES_NOTIFICACOES.map((opcao) => (
                <View key={opcao.key} style={[styles.notificationOptionRow, { borderBottomColor: Cores.borda }]}>
                  <View style={[styles.notificationOptionIcon, { backgroundColor: `${opcao.cor}1F` }]}>
                    <MaterialIcons name={opcao.icone} size={19} color={opcao.cor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.notificationOptionTitle, { color: Cores.texto }]}>{opcao.titulo}</Text>
                    <Text style={[styles.notificationOptionText, { color: Cores.secundario }]}>{opcao.descricao}</Text>
                  </View>
                  <Switch
                    value={preferenciasNotificacoes[opcao.key]}
                    onValueChange={(value) => setPreferenciasNotificacoes((atuais) => ({ ...atuais, [opcao.key]: value }))}
                    trackColor={{ false: "#767577", true: "#2A9D8F" }}
                  />
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={[styles.notificationSaveButton, loadingPreferenciasNotificacoes && { opacity: 0.6 }]} onPress={() => void confirmarPreferenciasNotificacoes()} disabled={loadingPreferenciasNotificacoes}>
              {loadingPreferenciasNotificacoes ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.notificationSaveText}>Salvar preferências</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL FEEDBACK */}
      {modalFeedbackVisivel && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.card }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
              <Text style={[styles.modalTitle, { color: Cores.texto, marginBottom: 0 }]}>Fale Conosco</Text>
              <TouchableOpacity onPress={() => setModalFeedbackVisivel(false)}>
                <MaterialIcons name="close" size={24} color={Cores.secundario} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Tipo:</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 15 }}>
              {([
                { key: "sugestao", label: "Sugestão", cor: "#2A9D8F" },
                { key: "problema", label: "Problema", cor: "#E76F51" },
                { key: "reclamação", label: "Reclamação", cor: "#F4A261" },
              ] as const).map((op) => (
                <TouchableOpacity
                  key={op.key}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: tipoFeedback === op.key ? op.cor : Cores.pillFundo }}
                  onPress={() => setTipoFeedback(op.key)}
                >
                  <Text style={{ color: tipoFeedback === op.key ? "#FFF" : Cores.secundario, fontWeight: "600", fontSize: 12 }}>{op.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Mensagem:</Text>
            <TextInput
              style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto, minHeight: 100, textAlignVertical: "top" }]}
              placeholder="Descreva sua sugestão, problema ou reclamação..."
              placeholderTextColor={Cores.secundario}
              value={mensagemFeedback}
              onChangeText={setMensagemFeedback}
              multiline
              numberOfLines={4}
            />
            {loadingFeedback ? (
              <ActivityIndicator size="small" color="#2A9D8F" style={{ marginTop: 10 }} />
            ) : (
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalFeedbackVisivel(false)}>
                  <Text style={[styles.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: "#2A9D8F" }]} onPress={enviarFeedback}>
                  <Text style={[styles.modalBtnText, { color: "#FFF" }]}>Enviar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {/* MODAL INFO/AVISO */}
      {modalInfo && (
        <FinFlowPopup animationType="fade" transparent visible onRequestClose={() => setModalInfo(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", backgroundColor: Cores.card, borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: modalInfo.cor ?? "#2A9D8F" }}>
              <Text style={{ color: Cores.texto, fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>{modalInfo.titulo}</Text>
              <Text style={{ color: Cores.secundario, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 }}>{modalInfo.mensagem}</Text>
              <TouchableOpacity
                style={{ backgroundColor: modalInfo.cor ?? "#2A9D8F", paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
                onPress={() => setModalInfo(null)}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FinFlowPopup>
      )}

      {/* MODAL CONFIRMAÇÃO */}
      {modalConfirmarAcao && (
        <FinFlowPopup animationType="fade" transparent visible onRequestClose={() => setModalConfirmarAcao(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", backgroundColor: Cores.card, borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: modalConfirmarAcao.cor ?? "#2A9D8F" }}>
              <Text style={{ color: Cores.texto, fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>
                {modalConfirmarAcao.titulo}
              </Text>
              <Text style={{ color: Cores.secundario, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 }}>
                {modalConfirmarAcao.mensagem}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: modalConfirmarAcao.cor ?? "#2A9D8F", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginBottom: 10 }}
                onPress={modalConfirmarAcao.onConfirm}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>{modalConfirmarAcao.labelConfirm}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: Cores.pillFundo, paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
                onPress={() => setModalConfirmarAcao(null)}
              >
                <Text style={{ color: Cores.secundario, fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FinFlowPopup>
      )}

      {/* MODAL SENHA PARA EXCLUSÃO DE CONTA */}
      {modalSenhaExclusaoVisivel && (
        <Modal
          animationType="fade"
          transparent
          visible
          onRequestClose={() => { if (!verificandoExclusao) setModalSenhaExclusaoVisivel(false); }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={{ width: "100%", backgroundColor: Cores.card, borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: "#FF4444" }}>
              <Text style={{ color: Cores.texto, fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>
                Confirme sua senha
              </Text>
              <Text style={{ color: Cores.secundario, fontSize: 14, textAlign: "center", marginBottom: 20, lineHeight: 20 }}>
                Por segurança, digite sua senha atual para apagar permanentemente sua conta e todos os seus dados.
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto, marginBottom: 20 }]}
                placeholder="Senha atual"
                placeholderTextColor={Cores.secundario}
                secureTextEntry
                autoFocus
                editable={!verificandoExclusao}
                value={senhaExclusao}
                onChangeText={setSenhaExclusao}
                onSubmitEditing={confirmarSenhaEApagarConta}
              />
              <TouchableOpacity
                style={{ backgroundColor: "#FF4444", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginBottom: 10, opacity: verificandoExclusao ? 0.6 : 1 }}
                onPress={confirmarSenhaEApagarConta}
                disabled={verificandoExclusao}
              >
                {verificandoExclusao ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Apagar minha conta</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: Cores.pillFundo, paddingVertical: 14, borderRadius: 10, alignItems: "center", opacity: verificandoExclusao ? 0.6 : 1 }}
                onPress={() => setModalSenhaExclusaoVisivel(false)}
                disabled={verificandoExclusao}
              >
                <Text style={{ color: Cores.secundario, fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* MODAL DE EDIÇÃO DE PERFIL */}
      {modalPerfilVisivel && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.card }]}>
            <Text style={[styles.modalTitle, { color: Cores.texto }]}>Editar Perfil</Text>
            <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Nome</Text>
            <TextInput
              style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
              placeholder="Seu nome"
              placeholderTextColor={Cores.secundario}
              value={nomeEdit}
              onChangeText={setNomeEdit}
              autoCapitalize="words"
            />
            <Text style={{ color: Cores.secundario, fontSize: 11, lineHeight: 16, marginBottom: 14 }}>
              E-mail, telefone opcional e senha ficam protegidos na área Dados de acesso.
            </Text>
            {loadingPerfil ? (
              <ActivityIndicator size="small" color="#2A9D8F" style={{ marginTop: 10 }} />
            ) : (
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPerfilVisivel(false)}>
                  <Text style={[styles.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: "#2A9D8F" }]} onPress={salvarPerfil}>
                  <Text style={[styles.modalBtnText, { color: "#FFF" }]}>Salvar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenContent: { flex: 1, position: "relative" },
  mainScroll: { flex: 1 },
  mainScrollContent: { paddingTop: FinFlowTabHeader.expandedHeight, paddingBottom: 104 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 12,
    overflow: "hidden",
    shadowColor: "#001E1A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  headerExpandedContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: FinFlowTabHeader.expandedHeight,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCompactContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: FinFlowTabHeader.compactHeight,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  title: { fontSize: 24, fontWeight: "bold" },
  ajudaBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  compactProfileAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", marginRight: 10 },
  compactProfileAvatarText: { color: "#FFF", fontSize: 17, fontWeight: "900" },
  compactProfileInfo: { flex: 1, minWidth: 0, justifyContent: "center" },
  compactHeaderTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", lineHeight: 19 },
  compactProfileSummary: { color: "rgba(255,255,255,0.76)", fontSize: 10, fontWeight: "600", marginTop: 1 },
  compactHelpButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  content: { padding: 16, marginTop: -8 },

  perfilCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 20, borderWidth: 1, marginBottom: 5, elevation: 5 },
  perfilAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#2A9D8F", alignItems: "center", justifyContent: "center", marginRight: 14 },
  perfilAvatarLetra: { color: "#FFF", fontSize: 22, fontWeight: "bold" },
  perfilNome: { fontSize: 17, fontWeight: "bold" },
  perfilEmail: { fontSize: 13, marginTop: 2 },
  perfilPlanBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: "rgba(233,196,106,0.14)" },
  perfilPlanText: { color: "#C9A83B", fontSize: 9, fontWeight: "800" },
  editProfileButton: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 },
  editProfileText: { fontSize: 9, fontWeight: "700" },

  sectionTitle: { fontSize: 13, fontWeight: "bold", marginBottom: 10, marginLeft: 5, letterSpacing: 1 },
  configGroup: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  configRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  configLeft: { flexDirection: "row", alignItems: "center" },
  configText: { fontSize: 16, fontWeight: "600", marginLeft: 15 },
  configSubtext: { fontSize: 10, marginLeft: 15, marginTop: 2 },
  offlineSettingsIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginRight: 12 },
  offlineSettingsText: { marginLeft: 0, fontSize: 14 },
  offlineSettingsSubtext: { marginLeft: 0, fontSize: 10, marginTop: 3 },

  logoutButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 18, marginTop: 30, borderRadius: 12, borderWidth: 1, backgroundColor: "rgba(231, 111, 81, 0.1)" },
  logoutText: { color: "#E76F51", fontSize: 16, fontWeight: "bold", marginLeft: 10 },

  apagarContaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: "#FF444433", backgroundColor: "rgba(255, 68, 68, 0.05)" },
  apagarContaText: { color: "#FF4444", fontSize: 15, fontWeight: "bold", marginLeft: 8 },
  apagarContaAviso: { fontSize: 11, textAlign: "center", marginTop: 6, marginBottom: 30 },

  helpText: { fontSize: 14, marginBottom: 15, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 15 },
  actionBtn: { backgroundColor: "#2A9D8F", padding: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  actionBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 15 },
  centerBox: { alignItems: "center", paddingVertical: 10 },
  statusText: { fontSize: 15, marginTop: 10, textAlign: "center" },
  emailText: { fontSize: 16, fontWeight: "bold", marginTop: 5, marginBottom: 15 },
  rowBtns: { flexDirection: "row", width: "100%" },

  modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(2,12,15,0.78)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { width: "100%", maxWidth: 520, padding: 24, borderRadius: 22, elevation: 10 },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  notificationPreferencesModal: { width: "100%", maxWidth: 520, maxHeight: "90%", borderRadius: 24, borderWidth: 1, padding: 20, elevation: 12 },
  notificationPreferencesHeader: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 16 },
  notificationPreferencesIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  notificationPreferencesTitle: { fontSize: 19, fontWeight: "900" },
  notificationPreferencesSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  notificationPreferencesClose: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  notificationMasterRow: { minHeight: 68, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", marginBottom: 10 },
  notificationMasterTitle: { fontSize: 14, fontWeight: "800" },
  notificationMasterText: { fontSize: 10, marginTop: 3 },
  notificationDisabledNotice: { flexDirection: "row", alignItems: "flex-start", gap: 7, borderRadius: 12, padding: 10, backgroundColor: "rgba(244,162,97,0.12)", marginBottom: 7 },
  notificationDisabledText: { flex: 1, color: "#C47C2B", fontSize: 10, lineHeight: 15 },
  notificationOptionsList: { flex: 1, minHeight: 0 },
  notificationOptionRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 70, borderBottomWidth: 1, paddingVertical: 9 },
  notificationOptionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  notificationOptionTitle: { fontSize: 13, fontWeight: "800" },
  notificationOptionText: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  notificationSaveButton: { minHeight: 50, borderRadius: 15, backgroundColor: "#2A9D8F", alignItems: "center", justifyContent: "center", marginTop: 16 },
  notificationSaveText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  offlineQueueModal: { width: "100%", maxWidth: 520, maxHeight: "90%", borderRadius: 24, borderWidth: 1, padding: 20, elevation: 12 },
  offlineQueueMetrics: { flexDirection: "row", gap: 10, marginBottom: 10 },
  offlineQueueMetric: { flex: 1, minHeight: 92, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", padding: 10 },
  offlineQueueMetricIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  offlineQueueMetricValue: { fontSize: 20, fontWeight: "900", lineHeight: 23 },
  offlineQueueMetricLabel: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  offlineQueueNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 8 },
  offlineQueueNoticeText: { flex: 1, fontSize: 10, lineHeight: 15 },
  offlineQueueLocalNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, padding: 10, backgroundColor: "rgba(244,162,97,0.12)", marginBottom: 8 },
  offlineQueueLocalNoticeText: { flex: 1, color: "#C47C2B", fontSize: 10, lineHeight: 15 },
  offlineQueueList: { flex: 1, minHeight: 0 },
  offlineQueueEmptyList: { minHeight: 165, justifyContent: "center" },
  offlineQueueEmpty: { alignItems: "center", paddingHorizontal: 20, paddingVertical: 22 },
  offlineQueueEmptyIcon: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", marginBottom: 9 },
  offlineQueueEmptyTitle: { fontSize: 14, fontWeight: "900" },
  offlineQueueEmptyText: { fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 4 },
  offlineQueueItem: { flexDirection: "row", alignItems: "center", minHeight: 82, borderBottomWidth: 1, paddingVertical: 10 },
  offlineQueueItemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginRight: 10 },
  offlineQueueItemContent: { flex: 1, minWidth: 0 },
  offlineQueueItemTitle: { fontSize: 13, fontWeight: "800" },
  offlineQueueItemMeta: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  offlineQueueItemStatus: { fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 2 },
  offlineQueueRemoveButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 9 },
  offlineQueueSyncButton: { minHeight: 50, borderRadius: 15, backgroundColor: "#2A9D8F", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 16 },
  offlineQueueSyncText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  abaSelector: { flexDirection: "row", borderRadius: 10, padding: 3, marginBottom: 20 },
  abaBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  abaBtnText: { fontWeight: "600", fontSize: 14 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginLeft: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 5 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnText: { fontWeight: "bold", fontSize: 15 },
});
