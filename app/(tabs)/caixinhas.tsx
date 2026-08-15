import { MaterialIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { IS_LOCAL_DEMO, supabase } from "../../lib/supabase";
import { agendarNotificacoesDoApp } from "../../lib/notifications";
import {
  descricaoTransferenciaObjetivo,
  getMovimentoObjetivo,
  type OperacaoObjetivo,
} from "../../lib/transacoes";
import { fmtReais } from "../../lib/utils";
import { FinFlowTabHeader, finFlowTheme } from "../../constants/finflow-design";
import Button from "../../components/FinFlowButton";
import { useAppTheme } from "../_layout";
import {
  dispositivoSemConexao,
  mensagemFalhaEdicaoOffline,
  OFFLINE_EDIT_SAVED_MESSAGE,
  OFFLINE_SAVED_MESSAGE,
  OFFLINE_SYNC_COMPLETED_EVENT,
  salvarCriacaoFinanceira,
  salvarEdicaoFinanceira,
} from "../../lib/offline-sync";

interface Caixinha {
  id: number;
  user_id?: string;
  nome: string;
  meta_valor: number;
  saldo_atual: number;
  cor: string;
  icone: string;
  compartilhado?: boolean;
  data_prazo?: string | null;
  bloqueado_plano?: boolean;
  version?: number;
}

const formatarReais = (valor: number): string => {
  const cents = Math.round((valor % 1) * 100);
  if (cents === 0) {
    return `R$ ${Math.floor(valor).toLocaleString("pt-BR")}`;
  }
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const diasAteData = (dataStr: string): number => {
  const p = dataStr.split("-");
  const alvo = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  alvo.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
};

const corPrazo = (dias: number): string => {
  if (dias < 0) return "#CC092F";
  if (dias <= 3) return "#E76F51";
  if (dias <= 7) return "#F4A261";
  if (dias <= 30) return "#E9C46A";
  return "#8AB17D";
};

interface Conta {
  id: number;
  nome: string;
  saldo_inicial: number;
}

interface MovimentoCaixinha {
  id: number;
  tipo: string;
  valor: number;
  data_vencimento: string;
  descricao: string;
  conta_id: number;
  user_id: string;
}

interface AgendamentoObjetivo {
  id: number;
  tipo: string;
  valor: number;
  status: string;
  data_vencimento: string;
  descricao: string;
}

interface SerieAgendamentosObjetivo {
  datas: string[];
  totaisAcumulados: number[];
}

const criarSerieAgendamentos = (
  itens: { data: string; valor: number }[],
): SerieAgendamentosObjetivo => {
  const ordenados = [...itens].sort((a, b) => a.data.localeCompare(b.data));
  let total = 0;
  return {
    datas: ordenados.map((item) => item.data),
    totaisAcumulados: ordenados.map((item) => {
      total += item.valor;
      return total;
    }),
  };
};

const totalDaSerieAte = (
  serie: SerieAgendamentosObjetivo | undefined,
  dataLimite: string,
): number => {
  if (!serie || serie.datas.length === 0) return 0;

  let inicio = 0;
  let fim = serie.datas.length;
  while (inicio < fim) {
    const meio = Math.floor((inicio + fim) / 2);
    const dataDoMeio = serie.datas.at(meio);
    if (dataDoMeio !== undefined && dataDoMeio <= dataLimite) inicio = meio + 1;
    else fim = meio;
  }

  return inicio === 0 ? 0 : (serie.totaisAcumulados.at(inicio - 1) ?? 0);
};

const normalizarNomeObjetivo = (nome: string): string =>
  nome.trim().toLocaleLowerCase("pt-BR");

const movimentoPertenceAoObjetivo = (
  descricao: string,
  caixa: Pick<Caixinha, "id" | "nome">,
  operacao?: OperacaoObjetivo,
): boolean => {
  const movimento = getMovimentoObjetivo(descricao);
  if (!movimento || (operacao && movimento.operacao !== operacao)) return false;

  if (movimento.objetivoId !== null) {
    return movimento.objetivoId === caixa.id;
  }

  return movimento.nomeLegado !== undefined
    && normalizarNomeObjetivo(movimento.nomeLegado) === normalizarNomeObjetivo(caixa.nome);
};

const PALETA_CORES = [
  "#2A9D8F","#E9C46A","#F4A261","#E76F51",
  "#264653","#8AB17D","#8A05BE","#EC7000",
  "#457B9D","#CC092F","#005CA9","#1D3557",
  "#E63946","#6D597A","#B56576","#3A86FF",
  "#8338EC","#FF006E","#3A5A40","#D97706",
];

const LISTA_ICONES = [
  "savings","flight","home","directions-car","school",
  "fitness-center","local-hospital","shopping-cart","pets",
  "beach-access","sports-esports","music-note","restaurant",
  "local-movies","card-giftcard","smartphone","laptop-mac",
  "favorite","work","celebration","coffee","local-gas-station",
  "child-care","spa","book","camera-alt","palette","two-wheeler",
  "electrical-services","water-drop","wifi","checkroom","bakery-dining",
  "medical-services","payments","trending-up","volunteer-activism",
];

export default function CaixinhasScreen() {
  const { isDark, session, showToast, verificarLimite } = useAppTheme();
  const insets = useSafeAreaInsets();
  const novoTema = finFlowTheme(isDark);

  const Cores = {
    fundo: novoTema.background,
    textoPrincipal: novoTema.text,
    textoSecundario: novoTema.textMuted,
    cardFundo: novoTema.surface,
    borda: novoTema.border,
    inputFundo: novoTema.surfaceMuted,
    barraFundo: novoTema.border,
    pillFundo: novoTema.surfaceMuted,
  };

  const [caixinhas, setCaixinhas] = useState<Caixinha[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [agendamentosObjetivos, setAgendamentosObjetivos] = useState<AgendamentoObjetivo[]>([]);
  const [temParceiro, setTemParceiro] = useState(false);
  const [parceiraNome, setParceiraNome] = useState("Parceiro(a)");
  const [parceiroId, setParceiroId] = useState<string | null>(null);

  // Modal nova caixinha
  const [modalNovaVisivel, setModalNovaVisivel] = useState(false);
  const [nomeCaixinha, setNomeCaixinha] = useState("");
  const [metaValor, setMetaValor] = useState("");
  const [saldoInicialCaixinha, setSaldoInicialCaixinha] = useState("");
  const [corSelecionada, setCorSelecionada] = useState(PALETA_CORES[0]);
  const [iconeSelecionado, setIconeSelecionado] = useState("savings");
  const [caixinhaCompartilhada, setCaixinhaCompartilhada] = useState(false);
  const [dataPrazoCriacao, setDataPrazoCriacao] = useState<Date | null>(null);
  const [mostrarPickerCriacao, setMostrarPickerCriacao] = useState(false);

  // Modal opções (click no card)
  const [modalOpcoesVisivel, setModalOpcoesVisivel] = useState(false);
  const [caixaOpcoes, setCaixaOpcoes] = useState<Caixinha | null>(null);

  // Modal editar caixinha
  const [modalEditarVisivel, setModalEditarVisivel] = useState(false);
  const [nomeEditCaixa, setNomeEditCaixa] = useState("");
  const [metaEditCaixa, setMetaEditCaixa] = useState("");
  const [corEditCaixa, setCorEditCaixa] = useState(PALETA_CORES[0]);
  const [iconeEditCaixa, setIconeEditCaixa] = useState("savings");
  const [compartilhadoEditCaixa, setCompartilhadoEditCaixa] = useState(false);
  const [dataPrazoEdit, setDataPrazoEdit] = useState<Date | null>(null);
  const [mostrarPickerEdit, setMostrarPickerEdit] = useState(false);

  // Modais de aviso e confirmação de deleção
  const [modalAvisoCaixinha, setModalAvisoCaixinha] = useState<{ titulo: string; mensagem: string } | null>(null);
  const [modalConfirmarDeletar, setModalConfirmarDeletar] = useState<Caixinha | null>(null);

  // Modal movimento
  const [modalMovimentoVisivel, setModalMovimentoVisivel] = useState(false);
  const [caixaSelecionada, setCaixaSelecionada] = useState<Caixinha | null>(null);
  const [valorMovimento, setValorMovimento] = useState("");
  const [tipoMovimento, setTipoMovimento] = useState<"guardar" | "resgatar">("guardar");
  const [contaMovimentoId, setContaMovimentoId] = useState<number | null>(null);
  const [loadingMovimento, setLoadingMovimento] = useState(false);

  // Modal histórico
  const [modalHistoricoVisivel, setModalHistoricoVisivel] = useState(false);
  const [historicoMovimentos, setHistoricoMovimentos] = useState<MovimentoCaixinha[]>([]);
  const [caixaHistorico, setCaixaHistorico] = useState<Caixinha | null>(null);
  const [filtroUsuarioHistorico, setFiltroUsuarioHistorico] = useState<string>("");
  const [acaoRapidaPendente, setAcaoRapidaPendente] = useState<"guardar" | "resgatar" | "historico" | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const cabecalhoCompactoRef = useRef(false);
  const [cabecalhoCompacto, setCabecalhoCompacto] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const [resCaixinhas, resContas, resParceria, resAgendamentos] = await Promise.all([
        supabase.from("caixinhas").select("*"),  // RLS retorna próprias + compartilhadas do parceiro
        supabase.from("contas").select("*"),      // RLS retorna próprias + compartilhadas do parceiro
        supabase.from("parcerias").select("id, solicitante_id, convidado_id").eq("status", "aceito").or(
          `solicitante_id.eq.${session.user.id},convidado_id.eq.${session.user.id}`
        ),
        supabase
          .from("transacoes")
          .select("id, tipo, valor, status, data_vencimento, descricao")
          .eq("status", "pendente")
          // Marcadores atuais e descrições legadas de aportes contêm
          // "guardar". O filtro fixo reduz os dados sem interpolar entrada do
          // usuário; a validação estrutural continua sendo feita no cliente.
          .ilike("descricao", "%guardar%"),
      ]);
      if (resCaixinhas.data) setCaixinhas(resCaixinhas.data.map((c: Caixinha) => ({ ...c, cor: PALETA_CORES.includes(c.cor) ? c.cor : PALETA_CORES[0] })));
      if (resContas.data) setContas(resContas.data);
      setAgendamentosObjetivos((resAgendamentos.data ?? [])
        .filter((agendamento) => getMovimentoObjetivo(agendamento.descricao) !== null)
        .map((agendamento) => ({
          ...agendamento,
          valor: Number(agendamento.valor),
        })));
      const parceria = resParceria.data?.[0];
      setTemParceiro(!!parceria);
      if (parceria) {
        const pid = parceria.solicitante_id === session.user.id
          ? parceria.convidado_id
          : parceria.solicitante_id;
        if (pid) {
          setParceiroId(pid);
          const { data: nomeData } = await supabase.rpc("get_user_name", { user_id: pid });
          if (nomeData) setParceiraNome(nomeData);
        }
      }
      // Agenda notificações de prazo dos objetivos
      if (resCaixinhas.data) {
        agendarNotificacoesDoApp([], session.user.id, resCaixinhas.data.map((c: any) => ({
          nome: c.nome,
          meta_valor: Number(c.meta_valor),
          saldo_atual: Number(c.saldo_atual),
          data_prazo: c.data_prazo ?? undefined,
        })));
      }
    } catch (error) {
      console.error(error);
    }
  }, [session?.user?.id]);

  useFocusEffect(useCallback(() => { carregarDados(); }, [carregarDados]));

  React.useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(OFFLINE_SYNC_COMPLETED_EVENT, () => {
      void carregarDados();
    });
    return () => subscription.remove();
  }, [carregarDados]);

  const anoAtual = new Date().getFullYear();
  const fimDoAnoAtual = `${anoAtual}-12-31`;

  const {
    totalGuardado,
    previsaoFimDoAno,
    previsaoPorObjetivo,
  } = useMemo(() => {
    const objetivosPorId = new Map(caixinhas.map((caixa) => [caixa.id, caixa]));
    const primeiroObjetivoPorNome = new Map<string, number>();
    for (const caixa of caixinhas) {
      const nome = normalizarNomeObjetivo(caixa.nome);
      if (!primeiroObjetivoPorNome.has(nome)) primeiroObjetivoPorNome.set(nome, caixa.id);
    }
    const itensPorId = new Map<number, { data: string; valor: number }[]>();
    let agendadoAteFimDoAno = 0;

    for (const agendamento of agendamentosObjetivos) {
      const movimento = getMovimentoObjetivo(agendamento.descricao);
      const data = (agendamento.data_vencimento ?? "").slice(0, 10);
      if (
        agendamento.status !== "pendente"
        || movimento?.operacao !== "guardar"
        || !data
      ) continue;

      const item = { data, valor: Number(agendamento.valor) };
      const objetivoId = movimento.objetivoId !== null
        ? movimento.objetivoId
        : movimento.nomeLegado
          ? primeiroObjetivoPorNome.get(normalizarNomeObjetivo(movimento.nomeLegado))
          : undefined;
      if (objetivoId === undefined || !objetivosPorId.has(objetivoId)) continue;
      const itens = itensPorId.get(objetivoId) ?? [];
      itens.push(item);
      itensPorId.set(objetivoId, itens);

      if (data <= fimDoAnoAtual) agendadoAteFimDoAno += item.valor;
    }

    const seriesPorId = new Map<number, SerieAgendamentosObjetivo>();
    itensPorId.forEach((itens, id) => seriesPorId.set(id, criarSerieAgendamentos(itens)));

    const previsoes = new Map<number, number | null>();
    for (const caixa of caixinhas) {
      if (!caixa.data_prazo || diasAteData(caixa.data_prazo) < 0) {
        previsoes.set(caixa.id, null);
        continue;
      }

      const totalAgendado = totalDaSerieAte(seriesPorId.get(caixa.id), caixa.data_prazo);
      previsoes.set(
        caixa.id,
        totalAgendado > 0 ? Number(caixa.saldo_atual) + totalAgendado : null,
      );
    }

    const guardado = caixinhas.reduce(
      (total, caixa) => total + Number(caixa.saldo_atual),
      0,
    );
    return {
      totalGuardado: guardado,
      previsaoFimDoAno: guardado + agendadoAteFimDoAno,
      previsaoPorObjetivo: previsoes,
    };
  }, [agendamentosObjetivos, caixinhas, fimDoAnoAtual]);

  const calcularPrevisaoObjetivo = (caixa: Caixinha): number | null =>
    previsaoPorObjetivo.get(caixa.id) ?? null;

  const formatarDataPrazo = (dataStr: string): string => {
    const [ano, mes, dia] = dataStr.split("-");
    return `${dia}/${mes}/${ano}`;
  };

  const criarCaixinha = async () => {
    if (nomeCaixinha.trim() === "" || metaValor.trim() === "")
      return Alert.alert("Aviso", "Preenche o nome e a meta.");
    // Verificar limite de caixinhas do plano
    const caixinhasAtivas = caixinhas.filter((c) => !(c as any).arquivado).length;
    if (!verificarLimite("caixinhas", caixinhasAtivas)) return;
    const valorNum = parseFloat(metaValor.replace(",", "."));
    if (isNaN(valorNum) || valorNum < 1) return Alert.alert("Aviso", "A meta deve ser maior que R$ 1,00.");

    const saldoInicial = saldoInicialCaixinha.trim()
      ? parseFloat(saldoInicialCaixinha.replace(",", "."))
      : 0;
    if (isNaN(saldoInicial) || saldoInicial < 0)
      return Alert.alert("Aviso", "Saldo inicial inválido.");
    if (saldoInicial > valorNum)
      return Alert.alert("Aviso", "O saldo inicial não pode ser maior que a meta.");

    const prazoStr = dataPrazoCriacao
      ? `${dataPrazoCriacao.getFullYear()}-${String(dataPrazoCriacao.getMonth() + 1).padStart(2, "0")}-${String(dataPrazoCriacao.getDate()).padStart(2, "0")}`
      : null;

    if (!IS_LOCAL_DEMO && !caixinhaCompartilhada) {
      const payload: Record<string, unknown> = {
        name: nomeCaixinha.trim(),
        target_amount: valorNum,
        initial_balance: saldoInicial,
        color: corSelecionada,
        icon: iconeSelecionado,
      };
      if (prazoStr) payload.target_date = prazoStr;
      try {
        const resultado = await salvarCriacaoFinanceira("create_goal", payload);
        if (resultado.state === "rejected") {
          return Alert.alert("Não foi possível salvar", "O objetivo foi recusado pelo servidor. Revise os dados e tente novamente.");
        }
        if (resultado.state === "uncertain") {
          return Alert.alert("Sessão alterada", "Não foi possível confirmar o objetivo. Entre novamente e confira seus dados antes de reenviar.");
        }
        setNomeCaixinha(""); setMetaValor(""); setSaldoInicialCaixinha("");
        setIconeSelecionado("savings"); setCaixinhaCompartilhada(false); setDataPrazoCriacao(null);
        setModalNovaVisivel(false);
        if (resultado.state === "queued") showToast(OFFLINE_SAVED_MESSAGE, "info");
        else void carregarDados();
        return;
      } catch {
        return Alert.alert("Não foi possível salvar", "O objetivo não pôde ser salvo no dispositivo. Tente novamente.");
      }
    }

    if (!IS_LOCAL_DEMO && caixinhaCompartilhada && await dispositivoSemConexao()) {
      return Alert.alert(
        "Conexão necessária",
        "Objetivos compartilhados ainda não podem ser salvos offline. Reconecte e tente novamente.",
      );
    }

    const { error } = await supabase.from("caixinhas").insert([{
      nome: nomeCaixinha, meta_valor: valorNum, saldo_atual: saldoInicial,
      cor: corSelecionada, icone: iconeSelecionado, user_id: session.user.id,
      compartilhado: caixinhaCompartilhada, data_prazo: prazoStr,
    }]);

    if (error) { Alert.alert("Erro", "Não foi possível criar a caixinha."); }
    else {
      setNomeCaixinha(""); setMetaValor(""); setSaldoInicialCaixinha("");
      setIconeSelecionado("savings"); setCaixinhaCompartilhada(false); setDataPrazoCriacao(null);
      setModalNovaVisivel(false); carregarDados();
    }
  };

  const abrirOpcoes = (caixa: Caixinha) => {
    setCaixaOpcoes(caixa);
    setModalOpcoesVisivel(true);
  };

  const abrirEditar = (caixa: Caixinha) => {
    setModalOpcoesVisivel(false);
    setNomeEditCaixa(caixa.nome);
    setMetaEditCaixa(Number(caixa.meta_valor).toFixed(2).replace(".", ","));
    setCorEditCaixa(PALETA_CORES.includes(caixa.cor) ? caixa.cor : PALETA_CORES[0]);
    setIconeEditCaixa(caixa.icone);
    setCompartilhadoEditCaixa(caixa.compartilhado ?? false);
    if (caixa.data_prazo) {
      const p = caixa.data_prazo.split("-");
      setDataPrazoEdit(new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])));
    } else {
      setDataPrazoEdit(null);
    }
    setCaixaOpcoes(caixa);
    setModalEditarVisivel(true);
  };

  const salvarEdicaoCaixinha = async () => {
    if (!caixaOpcoes) return;
    const valorNum = parseFloat(metaEditCaixa.replace(",", "."));
    if (nomeEditCaixa.trim() === "" || isNaN(valorNum) || valorNum <= 0)
      return Alert.alert("Aviso", "Nome e meta são obrigatórios.");

    const prazoStr = dataPrazoEdit
      ? `${dataPrazoEdit.getFullYear()}-${String(dataPrazoEdit.getMonth() + 1).padStart(2, "0")}-${String(dataPrazoEdit.getDate()).padStart(2, "0")}`
      : null;

    if (!IS_LOCAL_DEMO) {
      const objetivoDoUsuarioAtual = caixaOpcoes.user_id === session.user.id;
      const compartilhamentoAlterado = compartilhadoEditCaixa !== (caixaOpcoes.compartilhado ?? false);
      if (objetivoDoUsuarioAtual && !compartilhamentoAlterado) {
        const changes: Record<string, unknown> = {};
        if (nomeEditCaixa.trim() !== caixaOpcoes.nome) changes.name = nomeEditCaixa.trim();
        if (valorNum !== Number(caixaOpcoes.meta_valor)) changes.target_amount = valorNum;
        if (corEditCaixa !== caixaOpcoes.cor) changes.color = corEditCaixa;
        if (iconeEditCaixa !== caixaOpcoes.icone) changes.icon = iconeEditCaixa;
        if (prazoStr !== (caixaOpcoes.data_prazo ?? null)) changes.target_date = prazoStr;
        if (Object.keys(changes).length === 0) {
          setModalEditarVisivel(false);
          setCaixaOpcoes(null);
          return;
        }
        try {
          const resultado = await salvarEdicaoFinanceira(
            "update_goal",
            caixaOpcoes.id,
            Number(caixaOpcoes.version),
            changes,
          );
          if (resultado.state === "rejected") {
            return Alert.alert("Não foi possível salvar", mensagemFalhaEdicaoOffline(resultado.errorCode));
          }
          if (resultado.state === "uncertain") {
            return Alert.alert("Sessão alterada", "Não foi possível confirmar a edição. Entre novamente e confira os dados antes de reenviar.");
          }
          setModalEditarVisivel(false);
          setCaixaOpcoes(null);
          if (resultado.state === "queued") showToast(OFFLINE_EDIT_SAVED_MESSAGE, "info");
          else void carregarDados();
          return;
        } catch {
          return Alert.alert("Não foi possível salvar", "A edição não pôde ser protegida neste dispositivo. Tente novamente.");
        }
      }

      if (await dispositivoSemConexao()) {
        return Alert.alert(
          "Conexão necessária",
          compartilhamentoAlterado
            ? "Alterar o compartilhamento do objetivo exige conexão para revalidar as permissões."
            : "Este objetivo compartilhado pertence a outro usuário e só pode ser editado com conexão.",
        );
      }
    }

    const { error } = await supabase.from("caixinhas").update({
      nome: nomeEditCaixa, meta_valor: valorNum, cor: corEditCaixa, icone: iconeEditCaixa,
      compartilhado: compartilhadoEditCaixa, data_prazo: prazoStr,
    }).eq("id", caixaOpcoes.id);

    if (error) Alert.alert("Erro", "Não foi possível salvar.");
    else { setModalEditarVisivel(false); setCaixaOpcoes(null); carregarDados(); }
  };

  const deletarCaixinha = (caixa: Caixinha) => {
    setModalOpcoesVisivel(false);
    if (Number(caixa.saldo_atual) > 0) {
      return setModalAvisoCaixinha({
        titulo: "Ação não permitida",
        mensagem: `O objetivo "${caixa.nome}" ainda possui ${fmtReais(Number(caixa.saldo_atual))} guardados.\n\nPara excluir, primeiro resgate todo o saldo para uma conta.`,
      });
    }
    setModalConfirmarDeletar(caixa);
  };

  const abrirMovimento = (caixa: Caixinha, tipo: "guardar" | "resgatar" = "guardar") => {
    setModalOpcoesVisivel(false);
    setCaixaSelecionada(caixa);
    setValorMovimento(""); setTipoMovimento(tipo); setContaMovimentoId(null);
    setModalMovimentoVisivel(true);
  };

  const abrirHistorico = async (caixa: Caixinha) => {
    setModalOpcoesVisivel(false);
    setCaixaHistorico(caixa);
    setFiltroUsuarioHistorico("");

    const { data } = await supabase
      .from("transacoes")
      .select("id, tipo, valor, data_vencimento, descricao, conta_id, user_id")
      .eq("status", "paga")
      .eq("user_id", session?.user?.id)
      .order("data_vencimento", { ascending: false });

    const dataFiltrada = (data ?? []).filter(
      (t) => movimentoPertenceAoObjetivo(t.descricao, caixa)
    );

    setHistoricoMovimentos(dataFiltrada);
    setModalHistoricoVisivel(true);
  };

  const executarAcaoRapida = (acao: "guardar" | "resgatar" | "historico") => {
    const disponiveis = caixinhas.filter((caixa) => !caixa.bloqueado_plano);
    if (disponiveis.length === 0) {
      setModalNovaVisivel(true);
      return;
    }
    setAcaoRapidaPendente(acao);
  };

  const selecionarObjetivoDaAcao = (caixa: Caixinha) => {
    const acao = acaoRapidaPendente;
    setAcaoRapidaPendente(null);
    if (acao === "historico") void abrirHistorico(caixa);
    else if (acao) abrirMovimento(caixa, acao);
  };

  const executarMovimento = async (valorNum: number, novoSaldo: number) => {
    if (!caixaSelecionada) return;
    setLoadingMovimento(true);

    const descricao = descricaoTransferenciaObjetivo(
      "",
      caixaSelecionada.nome,
      caixaSelecionada.id,
      tipoMovimento,
    );

    // Atômico: primeiro insere a transação, só depois atualiza saldo
    const { error: errorTrans } = await supabase.from("transacoes").insert([{
      tipo: tipoMovimento === "guardar" ? "despesa" : "receita",
      valor: valorNum, descricao,
      data_vencimento: new Date().toISOString().split("T")[0],
      data_realizacao: new Date().toISOString().split("T")[0],
      conta_id: contaMovimentoId, categoria_id: null,
      status: "paga", user_id: session.user.id,
    }]);
    if (errorTrans) {
      setLoadingMovimento(false);
      return Alert.alert("Erro", "Não foi possível registrar a movimentação.");
    }

    const { error: errorCaixinha } = await supabase.from("caixinhas").update({ saldo_atual: novoSaldo }).eq("id", caixaSelecionada.id);
    if (errorCaixinha) {
      setLoadingMovimento(false);
      return Alert.alert("Erro", "Transação registrada mas saldo da caixinha não foi atualizado. Contacte o suporte.");
    }

    setLoadingMovimento(false);
    setModalMovimentoVisivel(false); setCaixaSelecionada(null); setContaMovimentoId(null);
    carregarDados();
    showToast(tipoMovimento === "guardar" ? "Valor guardado ✓" : "Resgate realizado ✓", "success");
  };

  const confirmarMovimento = async () => {
    if (!caixaSelecionada) return;
    const valorNum = parseFloat(valorMovimento.replace(",", "."));
    if (isNaN(valorNum) || valorNum <= 0) return Alert.alert("Aviso", "Valor inválido.");
    if (!contaMovimentoId) return Alert.alert("Aviso", "Seleciona uma conta para continuar.");

    let novoSaldoCaixinha = Number(caixaSelecionada.saldo_atual);

    if (tipoMovimento === "guardar") {
      novoSaldoCaixinha += valorNum;
      const conta = contas.find((c) => c.id === contaMovimentoId);
      const { data: transacoesConta } = await supabase.from("transacoes").select("tipo, valor, status").eq("conta_id", contaMovimentoId).eq("status", "paga");
      const rec = (transacoesConta ?? []).filter((t) => t.tipo === "receita").reduce((acc, t) => acc + Number(t.valor), 0);
      const desp = (transacoesConta ?? []).filter((t) => t.tipo === "despesa").reduce((acc, t) => acc + Number(t.valor), 0);
      const saldoReal = Number(conta?.saldo_inicial ?? 0) + rec - desp;

      if (valorNum > saldoReal) {
        return Alert.alert("Saldo insuficiente", `Você não tem saldo suficiente nesta conta (${fmtReais(saldoReal)}). Deseja continuar mesmo assim?`, [
          { text: "Cancelar", style: "cancel" },
          { text: "Sim, continuar", style: "destructive", onPress: () => executarMovimento(valorNum, novoSaldoCaixinha) },
        ]);
      }
    } else {
      if (valorNum > novoSaldoCaixinha) return Alert.alert("Aviso", "Não podes resgatar mais do que tens guardado!");
      novoSaldoCaixinha -= valorNum;
    }

    executarMovimento(valorNum, novoSaldoCaixinha);
  };

  const movimentosFiltrados = historicoMovimentos.filter((m) => {
    if (!filtroUsuarioHistorico) return true;
    return m.user_id === filtroUsuarioHistorico;
  });

  const totalGuardadoHist = movimentosFiltrados
    .filter((movimento) => getMovimentoObjetivo(movimento.descricao)?.operacao === "guardar")
    .reduce((total, movimento) => total + Number(movimento.valor), 0);
  const totalResgatadoHist = movimentosFiltrados
    .filter((movimento) => getMovimentoObjetivo(movimento.descricao)?.operacao === "resgatar")
    .reduce((total, movimento) => total + Number(movimento.valor), 0);
  const objetivosAlcancados = caixinhas.filter(
    (caixa) => Number(caixa.saldo_atual) >= Number(caixa.meta_valor)
  ).length;
  const resumoProgresso = `${objetivosAlcancados} de ${caixinhas.length} objetivos alcançados`;

  const alturaCabecalho = scrollY.interpolate({
    inputRange: [0, FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight],
    outputRange: [FinFlowTabHeader.expandedHeight, FinFlowTabHeader.compactHeight],
    extrapolate: "clamp",
  });
  const raioCabecalho = scrollY.interpolate({
    inputRange: [0, FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight],
    outputRange: [FinFlowTabHeader.expandedRadius, FinFlowTabHeader.compactRadius],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, 18, 36],
    outputRange: [1, 0.65, 0],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoExpandido = scrollY.interpolate({
    inputRange: [0, FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight],
    outputRange: [0, -10],
    extrapolate: "clamp",
  });
  const opacidadeCabecalhoCompacto = scrollY.interpolate({
    inputRange: [20, FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const deslocamentoCabecalhoCompacto = scrollY.interpolate({
    inputRange: [20, FinFlowTabHeader.expandedHeight - FinFlowTabHeader.compactHeight],
    outputRange: [7, 0],
    extrapolate: "clamp",
  });
  const onScrollObjetivos = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        const offset = Math.max(0, event.nativeEvent.contentOffset.y);
        let compacto = cabecalhoCompactoRef.current;
        if (!compacto && offset >= 32) compacto = true;
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
          <Text style={styles.title}>Objetivos</Text>
          <Text style={styles.subtitle}>Transforme planos em conquistas</Text>

          <View style={styles.headerSummary}>
            <View>
              <Text style={styles.totalCardTitle}>Total guardado</Text>
              <Text style={styles.totalCardAmount}>{fmtReais(totalGuardado)}</Text>
            </View>
            <View style={styles.headerForecast}>
              <Text style={styles.forecastLabel}>Previsto até dez. {anoAtual}</Text>
              <Text style={styles.forecastAmount}>{fmtReais(previsaoFimDoAno)}</Text>
              <Text style={styles.totalCardProgress}>{resumoProgresso}</Text>
            </View>
          </View>
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
          <View style={styles.compactHeaderTopRow}>
            <Text style={styles.compactHeaderTitle}>Objetivos</Text>
            <Text
              style={styles.compactHeaderAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {fmtReais(totalGuardado)}
            </Text>
          </View>
          <Text style={styles.compactHeaderForecast} numberOfLines={1}>
            Previsto até dez. {anoAtual}: {fmtReais(previsaoFimDoAno)}
          </Text>
          <Text style={styles.compactHeaderProgress} numberOfLines={1}>
            {resumoProgresso}
          </Text>
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: 112 + Math.max(insets.bottom, 8) }]}
        onScroll={onScrollObjetivos}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.quickActions, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
          {[
            { label: "Nova meta", icon: "add-circle-outline", action: () => setModalNovaVisivel(true) },
            { label: "Guardar", icon: "arrow-downward", action: () => executarAcaoRapida("guardar") },
            { label: "Resgatar", icon: "arrow-upward", action: () => executarAcaoRapida("resgatar") },
            { label: "Histórico", icon: "history", action: () => executarAcaoRapida("historico") },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.quickAction} onPress={item.action}>
              <View style={[styles.quickActionIcon, { borderColor: "#2A9D8F" }]}>
                <MaterialIcons name={item.icon as any} size={20} color="#2A9D8F" />
              </View>
              <Text style={[styles.quickActionLabel, { color: Cores.textoPrincipal }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionHeading, { color: Cores.textoPrincipal }]}>Seus objetivos</Text>

        {caixinhas.length === 0 ? (
          <TouchableOpacity
            onPress={() => setModalNovaVisivel(true)}
            style={{ alignItems: "center", paddingVertical: 36, borderRadius: 16, borderWidth: 2, borderColor: Cores.borda, borderStyle: "dashed", marginTop: 8 }}
          >
            <MaterialIcons name="savings" size={48} color={Cores.borda} />
            <Text style={{ color: Cores.textoPrincipal, marginTop: 12, fontWeight: "700", fontSize: 16 }}>
              Nenhum objetivo criado
            </Text>
            <Text style={{ color: Cores.textoSecundario, fontSize: 13, marginTop: 6, textAlign: "center", paddingHorizontal: 20 }}>
              Crie um objetivo e comece a poupar para os seus sonhos
            </Text>
            <View style={{ marginTop: 16, backgroundColor: "#2A9D8F", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 }}>
              <Text style={{ color: "#FFF", fontWeight: "bold" }}>+ Criar primeiro objetivo</Text>
            </View>
          </TouchableOpacity>
        ) : (
          caixinhas.map((caixa) => {
            const bloqueado = !!caixa.bloqueado_plano;
            const metaSegura = Math.max(Number(caixa.meta_valor), 0.01);
            const porcentagem = Math.min((Number(caixa.saldo_atual) / metaSegura) * 100, 100);
            const isCompleto = porcentagem === 100;
            const previsaoAtePrazo = calcularPrevisaoObjetivo(caixa);
            const previsaoAbaixoDaMeta = previsaoAtePrazo !== null
              && previsaoAtePrazo < Number(caixa.meta_valor);
            const corPrevisao = previsaoAbaixoDaMeta ? "#E76F51" : Cores.textoSecundario;
            return (
              <TouchableOpacity
                key={caixa.id}
                style={[styles.card, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda, opacity: bloqueado ? 0.55 : 1 }]}
                onPress={() => !bloqueado && abrirOpcoes(caixa)}
                activeOpacity={bloqueado ? 1 : 0.8}
                accessibilityRole="button"
                accessibilityState={{ disabled: bloqueado }}
                accessibilityLabel={`${caixa.nome}. Guardado: ${formatarReais(Number(caixa.saldo_atual))}. Meta: ${formatarReais(Number(caixa.meta_valor))}.${caixa.data_prazo && previsaoAtePrazo !== null ? ` Previsão na data-meta: ${formatarReais(previsaoAtePrazo)}${previsaoAbaixoDaMeta ? ", abaixo da meta" : ""}.` : ""}`}
                accessibilityHint={bloqueado ? "Objetivo indisponível no plano atual" : "Abre as ações deste objetivo"}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.titleRow}>
                    <View style={[styles.iconBox, { backgroundColor: caixa.cor }]}>
                      <MaterialIcons name={caixa.icone as any} size={20} color="#FFF" />
                    </View>
                    <Text style={[styles.caixaName, { color: Cores.textoPrincipal }]}>{caixa.nome}</Text>
                    {bloqueado && <MaterialIcons name="lock" size={14} color={Cores.textoSecundario} style={{ marginLeft: 6 }} />}
                  </View>
                  {bloqueado ? (
                    <Text style={{ fontSize: 10, color: Cores.textoSecundario, fontWeight: "600" }}>Bloqueado</Text>
                  ) : (
                    <Text style={[styles.caixaPercent, { color: Cores.textoSecundario }, isCompleto && { color: "#2A9D8F" }]}>
                      {isCompleto ? "100% 🎉" : `${porcentagem.toFixed(0)}%`}
                    </Text>
                  )}
                </View>

                <View style={styles.valuesRow}>
                  <Text style={[styles.currentValue, { color: Cores.textoPrincipal }]}>
                    {formatarReais(Number(caixa.saldo_atual))}
                  </Text>
                  <Text style={[styles.targetValue, { color: Cores.textoSecundario }]}>
                    de {formatarReais(Number(caixa.meta_valor))}
                  </Text>
                </View>

                <View style={[styles.progressBarBackground, { backgroundColor: Cores.barraFundo }]}>
                  <View style={[styles.progressBarFill, { backgroundColor: isCompleto ? "#2A9D8F" : caixa.cor, width: `${porcentagem}%` }]} />
                </View>

                {caixa.data_prazo && previsaoAtePrazo !== null && (
                  <View
                    style={[styles.forecastRow, { backgroundColor: previsaoAbaixoDaMeta ? "#E76F5118" : `${caixa.cor}14` }]}
                    accessible
                    accessibilityLabel={`Previsão até ${formatarDataPrazo(caixa.data_prazo)}: ${formatarReais(previsaoAtePrazo)}${previsaoAbaixoDaMeta ? ", abaixo da meta" : ""}`}
                  >
                    <MaterialIcons name="trending-up" size={13} color={previsaoAbaixoDaMeta ? "#E76F51" : caixa.cor} />
                    <Text style={[styles.forecastText, { color: Cores.textoSecundario }]} numberOfLines={1}>
                      Previsto até {formatarDataPrazo(caixa.data_prazo)}:{" "}
                      <Text style={{ color: corPrevisao, fontWeight: "800" }}>{formatarReais(previsaoAtePrazo)}</Text>
                      {previsaoAbaixoDaMeta && <Text style={{ color: corPrevisao }}> · abaixo da meta</Text>}
                    </Text>
                  </View>
                )}

                {caixa.data_prazo && !isCompleto && (() => {
                  const dias = diasAteData(caixa.data_prazo);
                  const cor = corPrazo(dias);
                  const label = dias < 0 ? "Prazo vencido" : dias === 0 ? "Prazo hoje!" : `${dias} dia${dias === 1 ? "" : "s"} restantes`;
                  return (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                      <MaterialIcons name="event" size={12} color={cor} style={{ marginRight: 4 }} />
                      <Text style={{ color: cor, fontSize: 11, fontWeight: "600" }}>{label}</Text>
                    </View>
                  );
                })()}
              </TouchableOpacity>
            );
          })
        )}
      </Animated.ScrollView>
      </View>

      {acaoRapidaPendente !== null && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setAcaoRapidaPendente(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.goalPicker, { backgroundColor: Cores.cardFundo, borderColor: Cores.borda }]}>
            <View style={styles.goalPickerHeader}>
              <View style={[styles.goalPickerActionIcon, { backgroundColor: acaoRapidaPendente === "resgatar" ? "#E76F5122" : "#2A9D8F22" }]}>
                <MaterialIcons
                  name={acaoRapidaPendente === "historico" ? "history" : acaoRapidaPendente === "resgatar" ? "arrow-upward" : "arrow-downward"}
                  size={23}
                  color={acaoRapidaPendente === "resgatar" ? "#E76F51" : "#2A9D8F"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.goalPickerTitle, { color: Cores.textoPrincipal }]}>Escolha o objetivo</Text>
                <Text style={[styles.goalPickerSubtitle, { color: Cores.textoSecundario }]}>Selecione em qual caixinha deseja {acaoRapidaPendente === "historico" ? "ver o histórico" : acaoRapidaPendente}.</Text>
              </View>
              <TouchableOpacity style={styles.goalPickerClose} onPress={() => setAcaoRapidaPendente(null)}>
                <MaterialIcons name="close" size={22} color={Cores.textoSecundario} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.goalPickerList} showsVerticalScrollIndicator={false}>
              {caixinhas.filter((caixa) => !caixa.bloqueado_plano).map((caixa) => {
                const meta = Math.max(Number(caixa.meta_valor), 0.01);
                const percentual = Math.min(100, (Number(caixa.saldo_atual) / meta) * 100);
                return (
                  <TouchableOpacity key={caixa.id} style={[styles.goalPickerItem, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda }]} onPress={() => selecionarObjetivoDaAcao(caixa)}>
                    <View style={[styles.goalPickerIcon, { backgroundColor: `${caixa.cor}22` }]}>
                      <MaterialIcons name={caixa.icone as any} size={21} color={caixa.cor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.goalPickerName, { color: Cores.textoPrincipal }]}>{caixa.nome}</Text>
                      <Text style={[styles.goalPickerBalance, { color: Cores.textoSecundario }]}>{fmtReais(Number(caixa.saldo_atual))} de {fmtReais(Number(caixa.meta_valor))}</Text>
                      <View style={[styles.goalPickerProgress, { backgroundColor: Cores.barraFundo }]}><View style={{ width: `${percentual}%`, height: "100%", borderRadius: 2, backgroundColor: caixa.cor }} /></View>
                    </View>
                    <MaterialIcons name="chevron-right" size={22} color={Cores.textoSecundario} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL OPÇÕES */}
      {modalOpcoesVisivel && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalOpcoesVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            {caixaOpcoes && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                <View style={[styles.iconBox, { backgroundColor: caixaOpcoes.cor, marginRight: 10 }]}>
                  <MaterialIcons name={caixaOpcoes.icone as any} size={20} color="#FFF" />
                </View>
                <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 0 }]}>{caixaOpcoes.nome}</Text>
              </View>
            )}

            {caixaOpcoes && (
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 13 }}>Saldo atual</Text>
                <Text style={{ color: caixaOpcoes.cor, fontWeight: "bold", fontSize: 22 }}>
                  {fmtReais(Number(caixaOpcoes.saldo_atual))}
                </Text>
              </View>
            )}

            <TouchableOpacity style={[styles.opcaoBtn, { backgroundColor: "#2A9D8F" }]} onPress={() => caixaOpcoes && abrirMovimento(caixaOpcoes)}>
              <MaterialIcons name="savings" size={20} color="#FFF" />
              <Text style={styles.opcaoBtnText}>Movimentar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.opcaoBtn, { backgroundColor: "#457B9D" }]} onPress={() => caixaOpcoes && abrirHistorico(caixaOpcoes)}>
              <MaterialIcons name="history" size={20} color="#FFF" />
              <Text style={styles.opcaoBtnText}>Histórico</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.opcaoBtn, { backgroundColor: "#8AB17D" }]} onPress={() => caixaOpcoes && abrirEditar(caixaOpcoes)}>
              <MaterialIcons name="edit" size={20} color="#FFF" />
              <Text style={styles.opcaoBtnText}>Editar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.opcaoBtn, { backgroundColor: "#E76F51" }]} onPress={() => caixaOpcoes && deletarCaixinha(caixaOpcoes)}>
              <MaterialIcons name="delete-outline" size={20} color="#FFF" />
              <Text style={styles.opcaoBtnText}>Excluir</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.opcaoBtn, { backgroundColor: Cores.pillFundo }]} onPress={() => setModalOpcoesVisivel(false)}>
              <Text style={[styles.opcaoBtnText, { color: Cores.textoSecundario }]}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL AVISO CAIXINHA */}
      {modalAvisoCaixinha && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalAvisoCaixinha(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", backgroundColor: Cores.cardFundo, borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: "#E76F51" }}>
              <Text style={{ color: Cores.textoPrincipal, fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>{modalAvisoCaixinha.titulo}</Text>
              <Text style={{ color: Cores.textoSecundario, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 }}>{modalAvisoCaixinha.mensagem}</Text>
              <TouchableOpacity
                style={{ backgroundColor: "#E76F51", paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
                onPress={() => setModalAvisoCaixinha(null)}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Entendi</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL CONFIRMAR DELETAR CAIXINHA */}
      {modalConfirmarDeletar && (
        <Modal animationType="fade" transparent visible onRequestClose={() => setModalConfirmarDeletar(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", backgroundColor: Cores.cardFundo, borderRadius: 16, padding: 25, borderTopWidth: 4, borderTopColor: "#FF4444" }}>
              <Text style={{ color: Cores.textoPrincipal, fontSize: 18, fontWeight: "bold", marginBottom: 12, textAlign: "center" }}>Apagar Objetivo</Text>
              <Text style={{ color: Cores.textoSecundario, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 }}>
                {`Tem certeza que quer apagar “${modalConfirmarDeletar.nome}”?`}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: "#FF4444", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginBottom: 10 }}
                onPress={async () => {
                  const caixa = modalConfirmarDeletar;
                  setModalConfirmarDeletar(null);
                  // Renomeia transações para não aparecerem em novo objetivo de mesmo nome
                  await supabase.from("transacoes")
                    .update({ descricao: `Guardar em: ${caixa.nome} (excluído)` })
                    .eq("descricao", `Guardar em: ${caixa.nome}`);
                  await supabase.from("transacoes")
                    .update({ descricao: `Resgate de: ${caixa.nome} (excluído)` })
                    .eq("descricao", `Resgate de: ${caixa.nome}`);
                  await supabase.from("caixinhas").delete().eq("id", caixa.id);
                  carregarDados();
                }}
              >
                <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 15 }}>Apagar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: Cores.pillFundo, paddingVertical: 14, borderRadius: 10, alignItems: "center" }}
                onPress={() => setModalConfirmarDeletar(null)}
              >
                <Text style={{ color: Cores.textoSecundario, fontWeight: "bold" }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* MODAL EDITAR CAIXINHA */}
      {modalEditarVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalEditarVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Editar Objetivo</Text>
              <TextInput
                style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
                placeholderTextColor={Cores.textoSecundario}
                placeholder="Nome do objetivo"
                value={nomeEditCaixa}
                onChangeText={setNomeEditCaixa}
              />
              <View style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 16, marginRight: 4 }}>R$</Text>
                <TextInput
                  style={{ flex: 1, color: Cores.textoPrincipal, fontSize: 16 }}
                  placeholderTextColor={Cores.textoSecundario}
                  placeholder="0,00"
                  value={metaEditCaixa}
                  onChangeText={setMetaEditCaixa}
                  keyboardType="decimal-pad"
                />
              </View>

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Data prazo (opcional):</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: dataPrazoEdit ? "#2A9D8F" : Cores.borda, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                onPress={() => setMostrarPickerEdit(true)}
              >
                <Text style={{ color: dataPrazoEdit ? Cores.textoPrincipal : Cores.textoSecundario, fontSize: 15 }}>
                  {dataPrazoEdit
                    ? `${String(dataPrazoEdit.getDate()).padStart(2, "0")}/${String(dataPrazoEdit.getMonth() + 1).padStart(2, "0")}/${dataPrazoEdit.getFullYear()}`
                    : "Sem prazo definido"}
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {dataPrazoEdit && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setDataPrazoEdit(null); }}>
                      <MaterialIcons name="close" size={18} color={Cores.textoSecundario} />
                    </TouchableOpacity>
                  )}
                  <MaterialIcons name="event" size={18} color="#2A9D8F" />
                </View>
              </TouchableOpacity>
              {mostrarPickerEdit && (
                <DateTimePicker
                  value={dataPrazoEdit ?? new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_e: any, date?: Date) => {
                    setMostrarPickerEdit(false);
                    if (date) setDataPrazoEdit(date);
                  }}
                />
              )}

              {temParceiro && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: 12, backgroundColor: Cores.pillFundo, borderRadius: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialIcons name="people" size={20} color="#E76F51" style={{ marginRight: 8 }} />
                    <Text style={{ color: Cores.textoPrincipal, fontWeight: "500" }}>Objetivo Conjunto?</Text>
                  </View>
                  <Switch
                    value={compartilhadoEditCaixa}
                    onValueChange={setCompartilhadoEditCaixa}
                    trackColor={{ false: "#767577", true: "#E76F51" }}
                  />
                </View>
              )}
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor:</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
                {PALETA_CORES.map((cor) => (
                  <TouchableOpacity
                    key={cor}
                    style={[styles.colorOption, { backgroundColor: cor }, corEditCaixa === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]}
                    onPress={() => setCorEditCaixa(cor)}
                  />
                ))}
              </ScrollView>
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Ícone:</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {LISTA_ICONES.map((icone) => (
                  <TouchableOpacity
                    key={icone}
                    style={[styles.iconeOpcao, { backgroundColor: iconeEditCaixa === icone ? corEditCaixa : Cores.pillFundo }]}
                    onPress={() => setIconeEditCaixa(icone)}
                  >
                    <MaterialIcons name={icone as any} size={22} color={iconeEditCaixa === icone ? "#FFF" : Cores.textoSecundario} />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modalButtons}>
                <Button title="Cancelar" color="#999" onPress={() => setModalEditarVisivel(false)} />
                <Button title="Salvar" color="#2A9D8F" onPress={salvarEdicaoCaixinha} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL CRIAR CAIXINHA */}
      {modalNovaVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalNovaVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "90%" }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal }]}>Novo Objetivo</Text>

              {temParceiro && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: 12, backgroundColor: Cores.pillFundo, borderRadius: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <MaterialIcons name="people" size={20} color="#E76F51" style={{ marginRight: 8 }} />
                    <Text style={{ color: Cores.textoPrincipal, fontWeight: "500" }}>Objetivo Conjunto?</Text>
                  </View>
                  <Switch
                    value={caixinhaCompartilhada}
                    onValueChange={setCaixinhaCompartilhada}
                    trackColor={{ false: "#767577", true: "#E76F51" }}
                  />
                </View>
              )}

              <TextInput
                style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, color: Cores.textoPrincipal }]}
                placeholderTextColor={Cores.textoSecundario}
                placeholder="Nome (Ex: Viagem, PC Novo)"
                value={nomeCaixinha}
                onChangeText={setNomeCaixinha}
              />
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Valor da meta (quanto quer guardar):</Text>
              <View style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 16, marginRight: 4 }}>R$</Text>
                <TextInput
                  style={{ flex: 1, color: Cores.textoPrincipal, fontSize: 16 }}
                  placeholderTextColor={Cores.textoSecundario}
                  placeholder="0,00"
                  value={metaValor}
                  onChangeText={setMetaValor}
                  keyboardType="decimal-pad"
                />
              </View>
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Saldo inicial (já guardado, opcional):</Text>
              <View style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 16, marginRight: 4 }}>R$</Text>
                <TextInput
                  style={{ flex: 1, color: Cores.textoPrincipal, fontSize: 16 }}
                  placeholderTextColor={Cores.textoSecundario}
                  placeholder="0,00"
                  value={saldoInicialCaixinha}
                  onChangeText={setSaldoInicialCaixinha}
                  keyboardType="decimal-pad"
                />
              </View>

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Data prazo (opcional):</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: dataPrazoCriacao ? "#2A9D8F" : Cores.borda, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                onPress={() => setMostrarPickerCriacao(true)}
              >
                <Text style={{ color: dataPrazoCriacao ? Cores.textoPrincipal : Cores.textoSecundario, fontSize: 15 }}>
                  {dataPrazoCriacao
                    ? `${String(dataPrazoCriacao.getDate()).padStart(2, "0")}/${String(dataPrazoCriacao.getMonth() + 1).padStart(2, "0")}/${dataPrazoCriacao.getFullYear()}`
                    : "Sem prazo definido"}
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {dataPrazoCriacao && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setDataPrazoCriacao(null); }}>
                      <MaterialIcons name="close" size={18} color={Cores.textoSecundario} />
                    </TouchableOpacity>
                  )}
                  <MaterialIcons name="event" size={18} color="#2A9D8F" />
                </View>
              </TouchableOpacity>
              {mostrarPickerCriacao && (
                <DateTimePicker
                  value={dataPrazoCriacao ?? new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  minimumDate={new Date()}
                  onChange={(_e: any, date?: Date) => {
                    setMostrarPickerCriacao(false);
                    if (date) setDataPrazoCriacao(date);
                  }}
                />
              )}

              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Cor:</Text>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={{ maxWidth: "100%" }} contentContainerStyle={styles.colorPalette}>
                {PALETA_CORES.map((cor) => (
                  <TouchableOpacity
                    key={cor}
                    style={[styles.colorOption, { backgroundColor: cor }, corSelecionada === cor && { borderWidth: 3, borderColor: Cores.textoPrincipal }]}
                    onPress={() => setCorSelecionada(cor)}
                  />
                ))}
              </ScrollView>
              <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>Ícone:</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {LISTA_ICONES.map((icone) => (
                  <TouchableOpacity
                    key={icone}
                    style={[styles.iconeOpcao, { backgroundColor: iconeSelecionado === icone ? corSelecionada : Cores.pillFundo }]}
                    onPress={() => setIconeSelecionado(icone)}
                  >
                    <MaterialIcons name={icone as any} size={22} color={iconeSelecionado === icone ? "#FFF" : Cores.textoSecundario} />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modalButtons}>
                <Button title="Cancelar" color="#999" onPress={() => setModalNovaVisivel(false)} />
                <Button title="Criar" color="#2A9D8F" onPress={criarCaixinha} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL MOVIMENTAR */}
      {modalMovimentoVisivel && (
      <Modal animationType="fade" transparent visible onRequestClose={() => setModalMovimentoVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              {caixaSelecionada && (
                <View style={[styles.iconBox, { backgroundColor: caixaSelecionada.cor, marginRight: 10 }]}>
                  <MaterialIcons name={caixaSelecionada.icone as any} size={20} color="#FFF" />
                </View>
              )}
              <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 0 }]}>{caixaSelecionada?.nome}</Text>
            </View>

            {caixaSelecionada && (
              <View style={{ alignItems: "center", marginBottom: 15 }}>
                <Text style={{ color: Cores.textoSecundario, fontSize: 13 }}>Guardado atualmente</Text>
                <Text style={{ color: caixaSelecionada.cor, fontWeight: "bold", fontSize: 20 }}>
                  {fmtReais(Number(caixaSelecionada.saldo_atual))}
                </Text>
              </View>
            )}

            <View style={[styles.typeSelector, { borderColor: Cores.borda }]}>
              <TouchableOpacity style={[styles.typeButton, { backgroundColor: Cores.inputFundo }, tipoMovimento === "guardar" && { backgroundColor: "#2A9D8F" }]} onPress={() => setTipoMovimento("guardar")}>
                <Text style={[styles.typeButtonText, { color: Cores.textoSecundario }, tipoMovimento === "guardar" && { color: "#FFF" }]}>Guardar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeButton, { backgroundColor: Cores.inputFundo }, tipoMovimento === "resgatar" && { backgroundColor: "#E76F51" }]} onPress={() => setTipoMovimento("resgatar")}>
                <Text style={[styles.typeButtonText, { color: Cores.textoSecundario }, tipoMovimento === "resgatar" && { color: "#FFF" }]}>Resgatar</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.input, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda, flexDirection: "row", alignItems: "center" }]}>
              <Text style={{ color: Cores.textoSecundario, fontSize: 16, marginRight: 4 }}>R$</Text>
              <TextInput
                style={{ flex: 1, color: Cores.textoPrincipal, fontSize: 16 }}
                placeholderTextColor={Cores.textoSecundario}
                placeholder="0,00"
                value={valorMovimento}
                onChangeText={setValorMovimento}
                keyboardType="decimal-pad"
              />
            </View>

            <Text style={[styles.colorLabel, { color: Cores.textoSecundario }]}>
              {tipoMovimento === "guardar" ? "Saiu de qual conta?" : "Vai entrar em qual conta?"}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.contaScroll}>
              {contas.map((conta) => (
                <TouchableOpacity
                  key={conta.id}
                  style={[styles.contaPill, { backgroundColor: Cores.inputFundo, borderColor: Cores.borda }, contaMovimentoId === conta.id && { borderColor: tipoMovimento === "guardar" ? "#2A9D8F" : "#E76F51", borderWidth: 2 }]}
                  onPress={() => setContaMovimentoId(conta.id)}
                >
                  <MaterialIcons name="account-balance-wallet" size={14} color={contaMovimentoId === conta.id ? (tipoMovimento === "guardar" ? "#2A9D8F" : "#E76F51") : Cores.textoSecundario} style={{ marginRight: 6 }} />
                  <Text style={[styles.contaPillText, { color: contaMovimentoId === conta.id ? Cores.textoPrincipal : Cores.textoSecundario }]}>{conta.nome}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <Button title="Cancelar" color="#999" onPress={() => setModalMovimentoVisivel(false)} />
              <Button title={loadingMovimento ? "Aguarde..." : "Confirmar"} color="#2A9D8F" onPress={confirmarMovimento} disabled={loadingMovimento} />
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* MODAL HISTÓRICO */}
      {modalHistoricoVisivel && (
      <Modal animationType="slide" transparent visible onRequestClose={() => setModalHistoricoVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: Cores.cardFundo, width: "95%", maxHeight: "85%" }]}>
            {caixaHistorico && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 15 }}>
                <View style={[styles.iconBox, { backgroundColor: caixaHistorico.cor, marginRight: 10 }]}>
                  <MaterialIcons name={caixaHistorico.icone as any} size={18} color="#FFF" />
                </View>
                <Text style={[styles.modalTitle, { color: Cores.textoPrincipal, marginBottom: 0 }]}>Histórico</Text>
              </View>
            )}

            {caixaHistorico?.compartilhado && temParceiro && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  style={[styles.mesFiltro, { backgroundColor: filtroUsuarioHistorico === "" ? Cores.textoPrincipal : Cores.pillFundo }]}
                  onPress={() => setFiltroUsuarioHistorico("")}
                >
                  <Text style={{ color: filtroUsuarioHistorico === "" ? Cores.fundo : Cores.textoSecundario, fontSize: 12, fontWeight: "600" }}>Todos</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mesFiltro, { backgroundColor: filtroUsuarioHistorico === session?.user?.id ? Cores.textoPrincipal : Cores.pillFundo }]}
                  onPress={() => setFiltroUsuarioHistorico(session?.user?.id ?? "")}
                >
                  <Text style={{ color: filtroUsuarioHistorico === session?.user?.id ? Cores.fundo : Cores.textoSecundario, fontSize: 12, fontWeight: "600" }}>
                    {session?.user?.user_metadata?.nome_usuario || "Eu"}
                  </Text>
                </TouchableOpacity>
                {parceiroId && (
                  <TouchableOpacity
                    style={[styles.mesFiltro, { backgroundColor: filtroUsuarioHistorico === parceiroId ? Cores.textoPrincipal : Cores.pillFundo }]}
                    onPress={() => setFiltroUsuarioHistorico(parceiroId)}
                  >
                    <Text style={{ color: filtroUsuarioHistorico === parceiroId ? Cores.fundo : Cores.textoSecundario, fontSize: 12, fontWeight: "600" }}>
                      {parceiraNome}
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}

            {movimentosFiltrados.length > 0 && (
              <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 12, padding: 10, backgroundColor: Cores.pillFundo, borderRadius: 10 }}>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 11 }}>Guardado</Text>
                  <Text style={{ color: "#2A9D8F", fontWeight: "bold", fontSize: 14 }}>{fmtReais(totalGuardadoHist)}</Text>
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: Cores.textoSecundario, fontSize: 11 }}>Resgatado</Text>
                  <Text style={{ color: "#E76F51", fontWeight: "bold", fontSize: 14 }}>{fmtReais(totalResgatadoHist)}</Text>
                </View>
              </View>
            )}

            <ScrollView showsVerticalScrollIndicator={false}>
              {movimentosFiltrados.length === 0 ? (
                <Text style={{ color: Cores.textoSecundario, textAlign: "center", fontStyle: "italic", paddingVertical: 20 }}>
                  Nenhum movimento registrado.
                </Text>
              ) : (
                movimentosFiltrados.map((mov) => {
                  const isGuardar = getMovimentoObjetivo(mov.descricao)?.operacao === "guardar";
                  const conta = contas.find((c) => c.id === mov.conta_id);
                  const partes = (mov.data_vencimento || "0000-00-00").split("-");
                  const isEu = mov.user_id === session?.user?.id;
                  const meuNome = session?.user?.user_metadata?.nome_usuario || "Você";
                  const nomeAutor = isEu ? meuNome : parceiraNome;
                  return (
                    <View key={mov.id} style={[styles.movRow, { backgroundColor: Cores.pillFundo }]}>
                      <View style={[styles.movIcone, { backgroundColor: isGuardar ? "#2A9D8F22" : "#E76F5122" }]}>
                        <MaterialIcons name={isGuardar ? "arrow-downward" : "arrow-upward"} size={16} color={isGuardar ? "#2A9D8F" : "#E76F51"} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: Cores.textoPrincipal, fontWeight: "600", fontSize: 13 }}>
                          {isGuardar ? "Guardado" : "Resgatado"}
                        </Text>
                        <Text style={{ color: Cores.textoSecundario, fontSize: 11 }}>
                          {nomeAutor}{conta ? ` · ${conta.nome}` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: isGuardar ? "#2A9D8F" : "#E76F51", fontWeight: "bold", fontSize: 14 }}>
                          {isGuardar ? "+" : "-"} {fmtReais(Number(mov.valor))}
                        </Text>
                        <Text style={{ color: Cores.textoSecundario, fontSize: 11 }}>
                          {partes[2]}/{partes[1]}/{partes[0]}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={{ marginTop: 15 }}>
              <Button title="Fechar" color="#999" onPress={() => setModalHistoricoVisivel(false)} />
            </View>
          </View>
        </View>
      </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenContent: { flex: 1, position: "relative" },
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
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 6,
  },
  headerCompactContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: FinFlowTabHeader.compactHeight,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  title: { color: "#FFF", fontSize: 20, lineHeight: 23, fontWeight: "bold" },
  subtitle: { color: "rgba(255,255,255,0.72)", fontSize: 11, lineHeight: 13 },
  headerSummary: {
    marginTop: 5,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  content: { flex: 1 },
  contentContainer: {
    flexGrow: 1,
    paddingTop: FinFlowTabHeader.expandedHeight + 14,
    paddingHorizontal: 16,
  },
  totalCardTitle: { color: "rgba(255,255,255,0.72)", fontSize: 10, lineHeight: 12, fontWeight: "600" },
  totalCardAmount: { color: "#FFF", fontSize: 23, lineHeight: 27, fontWeight: "900" },
  headerForecast: { alignItems: "flex-end", flexShrink: 1, maxWidth: "54%" },
  forecastLabel: { color: "rgba(255,255,255,0.72)", fontSize: 9, lineHeight: 11, fontWeight: "600" },
  forecastAmount: { color: "#FFF", fontSize: 15, lineHeight: 18, fontWeight: "800", textAlign: "right" },
  totalCardProgress: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "600",
    textAlign: "right",
  },
  compactHeaderTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  compactHeaderTitle: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  compactHeaderAmount: { color: "#FFF", fontSize: 20, fontWeight: "900", flexShrink: 1, textAlign: "right" },
  compactHeaderForecast: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
    textAlign: "right",
  },
  compactHeaderProgress: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontWeight: "600",
    marginTop: 0,
    textAlign: "right",
  },
  addButton: { backgroundColor: "rgba(255,255,255,0.16)", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  addButtonText: { color: "#FFF", fontWeight: "bold" },
  quickActions: { flexDirection: "row", borderWidth: 1, borderRadius: 18, marginBottom: 20, paddingVertical: 13, paddingHorizontal: 4, elevation: 2 },
  quickAction: { flex: 1, alignItems: "center", gap: 6 },
  quickActionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  quickActionLabel: { fontSize: 10, fontWeight: "700" },
  sectionHeading: { fontSize: 15, fontWeight: "800", marginBottom: 12 },
  goalPicker: { width: "92%", maxWidth: 520, maxHeight: "76%", borderRadius: 24, borderWidth: 1, padding: 20, elevation: 12 },
  goalPickerHeader: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 16 },
  goalPickerActionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  goalPickerTitle: { fontSize: 18, fontWeight: "900" },
  goalPickerSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  goalPickerClose: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  goalPickerList: { maxHeight: 430 },
  goalPickerItem: { flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 9 },
  goalPickerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  goalPickerName: { fontSize: 14, fontWeight: "800" },
  goalPickerBalance: { fontSize: 10, marginTop: 2 },
  goalPickerProgress: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 7 },
  emptyText: { fontStyle: "italic", textAlign: "center", marginTop: 20 },
  card: { padding: 17, borderRadius: 18, borderWidth: 1, marginBottom: 12, elevation: 1 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 },
  titleRow: { flexDirection: "row", alignItems: "center" },
  iconBox: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginRight: 10 },
  caixaName: { fontSize: 18, fontWeight: "bold" },
  caixaPercent: { fontSize: 14, fontWeight: "bold" },
  valuesRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 8 },
  currentValue: { fontSize: 20, fontWeight: "bold", marginRight: 5 },
  targetValue: { fontSize: 14, fontWeight: "500" },
  progressBarBackground: { height: 10, borderRadius: 5, overflow: "hidden" },
  progressBarFill: { height: "100%", borderRadius: 5 },
  forecastRow: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: 9, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  forecastText: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(2, 12, 15, 0.78)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { width: "100%", maxWidth: 520, padding: 24, borderRadius: 22, elevation: 10 },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 20 },
  colorLabel: { fontSize: 14, fontWeight: "500", marginBottom: 10 },
  colorPalette: { flexDirection: "row", gap: 8, paddingRight: 12, marginBottom: 20 },
  colorOption: { width: 35, height: 35, borderRadius: 17.5 },
  iconeOpcao: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modalButtons: { flexDirection: "row", justifyContent: "space-around" },
  typeSelector: { flexDirection: "row", marginBottom: 20, borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  typeButton: { flex: 1, padding: 12, alignItems: "center" },
  typeButtonText: { fontWeight: "bold" },
  contaScroll: { flexDirection: "row", marginBottom: 20 },
  contaPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginRight: 10, borderWidth: 1 },
  contaPillText: { fontSize: 14, fontWeight: "500" },
  mesFiltro: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8 },
  movRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, marginBottom: 8, gap: 10 },
  movIcone: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  opcaoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 10, marginBottom: 10, gap: 8 },
  opcaoBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 15 },
  pillFundo: {},
});
