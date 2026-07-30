import { MaterialIcons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

// URLs das páginas legais (GitHub Pages — atualizar quando publicado)
const URL_PRIVACIDADE = "https://finflowa.github.io/finflow-legal/#privacidade";
const URL_TERMOS = "https://finflowa.github.io/finflow-legal/#termos";

export default function ConfiguracoesScreen() {
  const { isDark, toggleTheme, isBiometricEnabled, toggleBiometric, session, showToast, notificacoesAtivas, toggleNotificacoes, plano, setPlano } = useAppTheme();
  const router = useRouter();

  const meuEmail = session?.user?.email || "";
  const meuId = session?.user?.id;

  const Cores = {
    fundo: isDark ? "#121212" : "#F5F2EC",
    texto: isDark ? "#ffffff" : "#27313A",
    secundario: isDark ? "#AAAAAA" : "#68727D",
    card: isDark ? "#1E1E1E" : "#FFFDF9",
    borda: isDark ? "#333" : "#E5DED3",
    input: isDark ? "#2C2C2C" : "#FAF8F4",
    pillFundo: isDark ? "#2C2C2C" : "#EEEAE3",
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

  const carregarParceria = async () => {
    if (!meuId || !meuEmail) return;
    const { data } = await supabase
      .from("parcerias")
      .select("*")
      .or(`solicitante_id.eq.${meuId},convidado_id.eq.${meuId},convidado_email.eq.${meuEmail}`)
      .order("id", { ascending: false });

    if (!data || data.length === 0) { setParceria(null); return; }

    // Prioriza: aceito > pendente mais recente
    const aceito = data.find((p) => p.status === "aceito");
    setParceria(aceito ?? data[0]);
  };

  useFocusEffect(useCallback(() => {
    carregarParceria();
    const meta = session?.user?.user_metadata;
    setNomeEdit(meta?.nome_usuario || meta?.full_name || "");
    setTelefoneEdit(meta?.telefone || "");
    setEmailEdit(meuEmail);
  }, [session]));

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

    if (error) Alert.alert("Erro", "Não foi possível enviar o convite. Tente novamente.");
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
    else { Alert.alert("Parceria Formada!", "Agora vocês podem criar Contas Conjuntas!"); carregarParceria(); }
  };

  const executarDissolucaoVinculo = async () => {
    if (!parceria || !meuId) return;
    const parceiroUserId = parceria.solicitante_id === meuId
      ? parceria.convidado_id
      : parceria.solicitante_id;

    // 1. Objetivos conjuntos: separar saldo por contribuição de cada usuário
    const [{ data: caixinhasShared }, { data: minhasTransacoes }] = await Promise.all([
      supabase.from("caixinhas").select("*").eq("compartilhado", true),
      supabase.from("transacoes").select("descricao, valor").eq("user_id", meuId).eq("status", "paga"),
    ]);
    const transMap = minhasTransacoes ?? [];

    for (const caixa of (caixinhasShared ?? [])) {
      const nomeGuardar = `Guardar em: ${caixa.nome}`;
      const nomeResgate = `Resgate de: ${caixa.nome}`;
      const meusGuardados = transMap.filter(t => t.descricao === nomeGuardar).reduce((s, t) => s + Number(t.valor), 0);
      const meusResgatados = transMap.filter(t => t.descricao === nomeResgate).reduce((s, t) => s + Number(t.valor), 0);
      const minhaContrib = Math.max(0, meusGuardados - meusResgatados);
      const saldoParceiro = Math.max(0, Number(caixa.saldo_atual) - minhaContrib);

      if (caixa.user_id === meuId) {
        // Meu objetivo: atualizo com minha contribuição
        await supabase.from("caixinhas")
          .update({ saldo_atual: minhaContrib, compartilhado: false })
          .eq("id", caixa.id);
        // Tentativa de criar cópia para o parceiro (pode falhar por RLS)
        if (parceiroUserId) {
          await supabase.from("caixinhas").insert([{
            nome: caixa.nome, meta_valor: caixa.meta_valor,
            saldo_atual: saldoParceiro, cor: caixa.cor, icone: caixa.icone,
            user_id: parceiroUserId, compartilhado: false, data_prazo: caixa.data_prazo ?? null,
          }]);
        }
      } else {
        // Objetivo do parceiro: crio minha cópia com minha contribuição
        await supabase.from("caixinhas").insert([{
          nome: caixa.nome, meta_valor: caixa.meta_valor,
          saldo_atual: minhaContrib, cor: caixa.cor, icone: caixa.icone,
          user_id: meuId, compartilhado: false, data_prazo: caixa.data_prazo ?? null,
        }]);
        // Tenta atualizar saldo do objetivo do parceiro (pode falhar por RLS)
        await supabase.from("caixinhas")
          .update({ saldo_atual: saldoParceiro, compartilhado: false })
          .eq("id", caixa.id);
      }
    }

    // 2. Contas compartilhadas próprias: remover compartilhamento
    await supabase.from("contas")
      .update({ compartilhado: false })
      .eq("user_id", meuId)
      .eq("compartilhado", true);

    // 3. Deletar a parceria
    await supabase.from("parcerias").delete().eq("id", parceria.id);
    setParceria(null);
  };

  const deletarParceria = async (mensagem: string) => {
    const ehVinculoAtivo = parceria?.status === "aceito";
    setModalConfirmarAcao({
      titulo: "Atenção",
      mensagem,
      labelConfirm: "Sim, desvincular",
      cor: "#E76F51",
      onConfirm: async () => {
        setModalConfirmarAcao(null);
        setLoadingParceria(true);
        if (ehVinculoAtivo) {
          await executarDissolucaoVinculo();
        } else {
          // Convite pendente: apenas deletar, sem split de dados
          await supabase.from("parcerias").delete().eq("id", parceria.id);
          setParceria(null);
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
            Alert.alert("Cancelado", "Autenticação necessária para apagar a conta.");
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
    } catch (error) {
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
    } catch (e) {
      setLoadingFeedback(false);
      Alert.alert("Erro", "Falha ao enviar feedback.");
    }
  };

  const nomeUsuario = session?.user?.user_metadata?.nome_usuario || session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Usuário";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: Cores.fundo }]}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={[styles.title, { color: Cores.texto }]}>Configurações</Text>
          <TouchableOpacity
            style={[styles.ajudaBtn, { backgroundColor: Cores.pillFundo }]}
            onPress={() => {
              setTipoFeedback("sugestao");
              setMensagemFeedback("");
              setModalFeedbackVisivel(true);
            }}
          >
            <MaterialIcons name="help-outline" size={22} color={Cores.secundario} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>

          {/* PERFIL DO USUÁRIO */}
          <TouchableOpacity
            style={[styles.perfilCard, { backgroundColor: Cores.card, borderColor: Cores.borda }]}
            onPress={() => {
              const meta = session?.user?.user_metadata;
              setNomeEdit(meta?.nome_usuario || meta?.full_name || "");
              setTelefoneEdit(meta?.telefone || "");
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
            </View>
            <MaterialIcons name="edit" size={20} color={Cores.secundario} />
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
            <View style={styles.configRow}>
              <View style={styles.configLeft}>
                <MaterialIcons name={notificacoesAtivas ? "notifications-active" : "notifications-off"} size={24} color={notificacoesAtivas ? "#2A9D8F" : "#999"} />
                <Text style={[styles.configText, { color: Cores.texto }]}>Notificações</Text>
              </View>
              <Switch value={notificacoesAtivas} onValueChange={toggleNotificacoes} trackColor={{ false: "#767577", true: "#2A9D8F" }} />
            </View>
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
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#E76F51", marginTop: 15 }]} onPress={() => deletarParceria("Deseja cancelar este convite?")}>
                    <Text style={styles.actionBtnText}>Cancelar Convite</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.centerBox}>
                  <MaterialIcons name="mail" size={30} color="#2A9D8F" />
                  <Text style={[styles.statusText, { color: Cores.texto }]}>Você recebeu um convite para Conta Conjunta!</Text>
                  <View style={styles.rowBtns}>
                    <TouchableOpacity style={[styles.actionBtn, { flex: 1, backgroundColor: "#E76F51", marginRight: 10 }]} onPress={() => deletarParceria("Deseja recusar o convite?")}>
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
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "transparent", borderWidth: 1, borderColor: "#E76F51", marginTop: 20 }]} onPress={() => deletarParceria("Tem certeza que deseja desfazer o vínculo com seu parceiro(a)?")}>
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
                  {plano === "free" ? "Gratuito · Toque para fazer upgrade" : plano === "smart" ? "R$ 9,90/mês · Smart" : "R$ 19,90/mês · Premium"}
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
                  onChangeText={setTelefoneEdit}
                  keyboardType="phone-pad"
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
  header: { padding: 20, paddingTop: 30, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 28, fontWeight: "bold" },
  ajudaBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { padding: 20 },

  perfilCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 5 },
  perfilAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#2A9D8F", alignItems: "center", justifyContent: "center", marginRight: 14 },
  perfilAvatarLetra: { color: "#FFF", fontSize: 22, fontWeight: "bold" },
  perfilNome: { fontSize: 17, fontWeight: "bold" },
  perfilEmail: { fontSize: 13, marginTop: 2 },

  sectionTitle: { fontSize: 13, fontWeight: "bold", marginBottom: 10, marginLeft: 5, letterSpacing: 1 },
  configGroup: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  configRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18 },
  configLeft: { flexDirection: "row", alignItems: "center" },
  configText: { fontSize: 16, fontWeight: "600", marginLeft: 15 },

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

  modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "92%", padding: 24, borderRadius: 16, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  abaSelector: { flexDirection: "row", borderRadius: 10, padding: 3, marginBottom: 20 },
  abaBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  abaBtnText: { fontWeight: "600", fontSize: 14 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginLeft: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 5 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  modalBtnText: { fontWeight: "bold", fontSize: 15 },
});
