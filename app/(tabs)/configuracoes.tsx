import { MaterialIcons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../_layout";
import { finFlowTheme } from "../../constants/finflow-design";
import { formatarTelefone } from "../../lib/legal";
import {
  obterPreferenciasNotificacoes,
  PREFERENCIAS_NOTIFICACOES_PADRAO,
  salvarPreferenciasNotificacoes,
  type PreferenciasNotificacoes,
} from "../../lib/notifications";

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

export default function ConfiguracoesScreen() {
  const { isDark, toggleTheme, isBiometricEnabled, toggleBiometric, session, showToast, notificacoesAtivas, toggleNotificacoes, plano, limitsEnabled } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ abrirNotificacoes?: string; parceriaId?: string }>();
  const novoTema = finFlowTheme(isDark);

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
  const [emailEdit, setEmailEdit] = useState("");
  const [telefoneEdit, setTelefoneEdit] = useState("");
  const [loadingPerfil, setLoadingPerfil] = useState(false);
  const [abaPerfilAtiva, setAbaPerfilAtiva] = useState<"dados" | "senha">("dados");

  // Senha
  const [novaSenha, setNovaSenha] = useState("");
  const [novaSenhaConfirm, setNovaSenhaConfirm] = useState("");
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false);
  const [mostrarConfirmSenha, setMostrarConfirmSenha] = useState(false);

  const [modalConfirmarAcao, setModalConfirmarAcao] = useState<{
    titulo: string; mensagem: string; labelConfirm: string; cor?: string;
    onConfirm: () => void;
  } | null>(null);

  const [modalInfo, setModalInfo] = useState<{ titulo: string; mensagem: string; cor?: string } | null>(null);

  // Feedback
  const [modalFeedbackVisivel, setModalFeedbackVisivel] = useState(false);
  const [tipoFeedback, setTipoFeedback] = useState<"problema" | "sugestao" | "reclamação">("sugestao");
  const [mensagemFeedback, setMensagemFeedback] = useState("");
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [modalPreferenciasNotificacoes, setModalPreferenciasNotificacoes] = useState(false);
  const [loadingPreferenciasNotificacoes, setLoadingPreferenciasNotificacoes] = useState(false);
  const [preferenciasNotificacoes, setPreferenciasNotificacoes] = useState<PreferenciasNotificacoes>(PREFERENCIAS_NOTIFICACOES_PADRAO);

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

  // Mantém o mesmo ciclo de montagem da última versão estável desta tela.
  // `session` é a fonte única dos dados de perfil durante o foco da aba.
  useFocusEffect(useCallback(() => {
    carregarParceria();
    const meta = session?.user?.user_metadata;
    setNomeEdit(typeof meta?.nome_usuario === "string"
      ? meta.nome_usuario
      : typeof meta?.full_name === "string" ? meta.full_name : "");
    setTelefoneEdit(typeof meta?.telefone === "string" ? formatarTelefone(meta.telefone) : "");
    setEmailEdit(meuEmail);
    if (meuId) {
      void obterPreferenciasNotificacoes(meuId).then(setPreferenciasNotificacoes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]));

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
      setPreferenciasNotificacoes(atualizadas);
      DeviceEventEmitter.emit("finflow:notificacoes-alteradas", atualizadas);
      setModalPreferenciasNotificacoes(false);
      showToast("Preferências de notificação salvas", "success");
    } finally {
      setLoadingPreferenciasNotificacoes(false);
    }
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
      onConfirm: () => { setModalConfirmarAcao(null); supabase.auth.signOut(); },
    });
  };

  const salvarPerfil = async () => {
    if (nomeEdit.trim() === "") return Alert.alert("Aviso", "O nome não pode ficar vazio.");
    setLoadingPerfil(true);

    const updates: any = { data: { nome_usuario: nomeEdit.trim(), telefone: telefoneEdit.trim() } };

    if (emailEdit.trim().toLowerCase() !== meuEmail.toLowerCase() && emailEdit.trim() !== "") {
      Alert.alert(
        "Confirmação de E-mail",
        `Um link de confirmação será enviado para "${emailEdit.trim()}". Verifique sua caixa de entrada para confirmar a alteração.`,
        [{ text: "OK" }]
      );
      const { error: emailError } = await supabase.auth.updateUser({ email: emailEdit.trim().toLowerCase() });
      if (emailError) {
        setLoadingPerfil(false);
        return Alert.alert("Erro", "Não foi possível atualizar o e-mail. " + emailError.message);
      }
    }

    const { error } = await supabase.auth.updateUser(updates);
    setLoadingPerfil(false);

    if (error) Alert.alert("Erro", "Não foi possível salvar as alterações.");
    else { showToast("Perfil atualizado ✓", "success"); setModalPerfilVisivel(false); }
  };

  const alterarSenha = async () => {
    if (novaSenha.length < 6) return Alert.alert("Aviso", "A nova senha deve ter pelo menos 6 caracteres.");
    if (novaSenha !== novaSenhaConfirm) return Alert.alert("Aviso", "As senhas não conferem. Verifique e tente novamente.");

    setLoadingPerfil(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setLoadingPerfil(false);
    if (error) Alert.alert("Erro", "Não foi possível alterar a senha. " + error.message);
    else {
      showToast("Senha alterada com sucesso ✓", "success");
      setNovaSenha(""); setNovaSenhaConfirm("");
      setModalPerfilVisivel(false);
    }
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
        } else {
          // Sem biometria, confirmar por alerta adicional
          Alert.alert(
            "Confirmação Final",
            "Confirme que deseja apagar permanentemente todos os seus dados.",
            [
              { text: "Cancelar", style: "cancel" },
              { text: "Confirmar exclusão", style: "destructive", onPress: apagarContaCompleta },
            ]
          );
          return;
        }

        await apagarContaCompleta();
      },
    });
  };

  const apagarContaCompleta = async () => {
    if (!meuId) return;
    try {
      // Sequencial para garantir integridade (foreign keys)
      await supabase.from("transacoes").delete().eq("user_id", meuId);
      await supabase.from("caixinhas").delete().eq("user_id", meuId);
      await supabase.from("contas").delete().eq("user_id", meuId);
      await supabase.from("categorias").delete().eq("user_id", meuId);
      await supabase.from("parcerias").delete().or(`solicitante_id.eq.${meuId},convidado_id.eq.${meuId}`);
      // Cartões e itens de fatura
      await supabase.from("fatura_itens").delete().eq("user_id", meuId);
      await supabase.from("cartoes").delete().eq("user_id", meuId);
      // Histórico de IA e feedback
      await supabase.from("chat_historico").delete().eq("user_id", meuId);
      await supabase.from("feedbacks").delete().eq("user_id", meuId);

      const { error: erroDeletar } = await supabase.rpc("delete_user");
      if (erroDeletar) {
        setModalInfo({ titulo: "Erro", mensagem: "Não foi possível remover o login. Tente novamente ou contate o suporte.", cor: "#FF4444" });
        return;
      }

      await supabase.auth.signOut();
      setModalInfo({ titulo: "Conta apagada", mensagem: "Sua conta e todos os dados foram removidos com sucesso.", cor: "#2A9D8F" });
    } catch {
      setModalInfo({ titulo: "Erro", mensagem: "Não foi possível apagar todos os dados. Tente novamente.", cor: "#FF4444" });
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView>
        <View style={[styles.header, { backgroundColor: novoTema.header }]}>
          <Text style={[styles.title, { color: "#FFF" }]}>Configurações</Text>
          <TouchableOpacity
            style={[styles.ajudaBtn, { backgroundColor: "rgba(255,255,255,0.14)" }]}
            onPress={() => {
              setTipoFeedback("sugestao");
              setMensagemFeedback("");
              setModalFeedbackVisivel(true);
            }}
          >
            <MaterialIcons name="help-outline" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>

          {/* PERFIL DO USUÁRIO */}
          <TouchableOpacity
            style={[styles.perfilCard, { backgroundColor: Cores.card, borderColor: Cores.borda }]}
            onPress={() => {
              const meta = session?.user?.user_metadata;
              setNomeEdit(typeof meta?.nome_usuario === "string"
                ? meta.nome_usuario
                : typeof meta?.full_name === "string" ? meta.full_name : "");
              setTelefoneEdit(typeof meta?.telefone === "string" ? formatarTelefone(meta.telefone) : "");
              setEmailEdit(meuEmail);
              setNovaSenha(""); setNovaSenhaConfirm("");
              setMostrarNovaSenha(false); setMostrarConfirmSenha(false);
              setAbaPerfilAtiva("dados");
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
                <Text style={[styles.configText, { color: Cores.texto }]}>Segurança (Biometria)</Text>
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
            FinFlow v1.0.0
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
      </ScrollView>

      <Modal animationType="fade" transparent visible={modalPreferenciasNotificacoes} onRequestClose={() => setModalPreferenciasNotificacoes(false)}>
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
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalInfo(null)}>
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
        </Modal>
      )}

      {/* MODAL CONFIRMAÇÃO */}
      {modalConfirmarAcao && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalConfirmarAcao(null)}>
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
        </Modal>
      )}

      {/* MODAL DE EDIÇÃO DE PERFIL */}
      {modalPerfilVisivel && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.card }]}>
            <Text style={[styles.modalTitle, { color: Cores.texto }]}>Editar Perfil</Text>

            <View style={[styles.abaSelector, { backgroundColor: Cores.pillFundo }]}>
              <TouchableOpacity
                style={[styles.abaBtn, abaPerfilAtiva === "dados" && { backgroundColor: Cores.card }]}
                onPress={() => setAbaPerfilAtiva("dados")}
              >
                <Text style={[styles.abaBtnText, { color: abaPerfilAtiva === "dados" ? Cores.texto : Cores.secundario }]}>Dados</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.abaBtn, abaPerfilAtiva === "senha" && { backgroundColor: Cores.card }]}
                onPress={() => setAbaPerfilAtiva("senha")}
              >
                <Text style={[styles.abaBtnText, { color: abaPerfilAtiva === "senha" ? Cores.texto : Cores.secundario }]}>Senha</Text>
              </TouchableOpacity>
            </View>

            {abaPerfilAtiva === "dados" ? (
              <>
                <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Nome</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                  placeholder="Seu nome"
                  placeholderTextColor={Cores.secundario}
                  value={nomeEdit}
                  onChangeText={setNomeEdit}
                />
                <Text style={[styles.inputLabel, { color: Cores.secundario }]}>E-mail</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                  placeholder="Seu e-mail"
                  placeholderTextColor={Cores.secundario}
                  value={emailEdit}
                  onChangeText={setEmailEdit}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {emailEdit.trim().toLowerCase() !== meuEmail.toLowerCase() && (
                  <Text style={{ color: "#F4A261", fontSize: 11, marginTop: -10, marginBottom: 12 }}>
                    Um link de confirmação será enviado ao novo e-mail.
                  </Text>
                )}
                <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Telefone</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto }]}
                  placeholder="(00) 00000-0000"
                  placeholderTextColor={Cores.secundario}
                  value={telefoneEdit}
                  onChangeText={(valor) => setTelefoneEdit(formatarTelefone(valor))}
                  keyboardType="phone-pad"
                  maxLength={15}
                />
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
              </>
            ) : (
              <>
                <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Nova Senha</Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 15 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: Cores.input, borderColor: Cores.borda, color: Cores.texto, marginBottom: 0 }]}
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={Cores.secundario}
                    value={novaSenha}
                    onChangeText={setNovaSenha}
                    secureTextEntry={!mostrarNovaSenha}
                  />
                  <TouchableOpacity onPress={() => setMostrarNovaSenha((v) => !v)} style={{ padding: 12 }}>
                    <MaterialIcons name={mostrarNovaSenha ? "visibility-off" : "visibility"} size={20} color={Cores.secundario} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.inputLabel, { color: Cores.secundario }]}>Confirmar Nova Senha</Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 5 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: Cores.input, borderColor: novaSenhaConfirm.length > 0 && novaSenha !== novaSenhaConfirm ? "#E76F51" : Cores.borda, color: Cores.texto, marginBottom: 0 }]}
                    placeholder="Repita a nova senha"
                    placeholderTextColor={Cores.secundario}
                    value={novaSenhaConfirm}
                    onChangeText={setNovaSenhaConfirm}
                    secureTextEntry={!mostrarConfirmSenha}
                  />
                  <TouchableOpacity onPress={() => setMostrarConfirmSenha((v) => !v)} style={{ padding: 12 }}>
                    <MaterialIcons name={mostrarConfirmSenha ? "visibility-off" : "visibility"} size={20} color={Cores.secundario} />
                  </TouchableOpacity>
                </View>
                {novaSenhaConfirm.length > 0 && novaSenha !== novaSenhaConfirm && (
                  <Text style={{ color: "#E76F51", fontSize: 12, marginBottom: 10 }}>As senhas não conferem</Text>
                )}
                {novaSenhaConfirm.length > 0 && novaSenha === novaSenhaConfirm && (
                  <Text style={{ color: "#2A9D8F", fontSize: 12, marginBottom: 10 }}>Senhas conferem ✓</Text>
                )}
                <Text style={[{ color: Cores.secundario, fontSize: 12, marginBottom: 15 }]}>
                  Um link de confirmação pode ser enviado para o seu e-mail.
                </Text>
                {loadingPerfil ? (
                  <ActivityIndicator size="small" color="#2A9D8F" style={{ marginTop: 10 }} />
                ) : (
                  <View style={styles.modalButtons}>
                    <TouchableOpacity style={[styles.modalBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalPerfilVisivel(false)}>
                      <Text style={[styles.modalBtnText, { color: Cores.texto }]}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalBtn, { backgroundColor: "#457B9D" }]} onPress={alterarSenha}>
                      <Text style={[styles.modalBtnText, { color: "#FFF" }]}>Alterar</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { padding: 20, paddingTop: 26, paddingBottom: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  title: { fontSize: 24, fontWeight: "bold" },
  ajudaBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, marginTop: -28 },

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
  notificationOptionsList: { maxHeight: 390 },
  notificationOptionRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 70, borderBottomWidth: 1, paddingVertical: 9 },
  notificationOptionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  notificationOptionTitle: { fontSize: 13, fontWeight: "800" },
  notificationOptionText: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  notificationSaveButton: { minHeight: 50, borderRadius: 15, backgroundColor: "#2A9D8F", alignItems: "center", justifyContent: "center", marginTop: 16 },
  notificationSaveText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  abaSelector: { flexDirection: "row", borderRadius: 10, padding: 3, marginBottom: 20 },
  abaBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  abaBtnText: { fontWeight: "600", fontSize: 14 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginLeft: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 5 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnText: { fontWeight: "bold", fontSize: 15 },
});
