import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import React, { useCallback, useState } from "react";
import {
    Alert,
    Button,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Modal from "../../components/FinFlowScreen";
import FinFlowPopup from "../../components/FinFlowPopup";
import { SafeAreaView } from "react-native-safe-area-context";

interface Categoria {
  id: number;
  nome: string;
  cor: string;
  icone: string;
  tipo: string;
  ativa: number;
}
interface Transacao {
  id: number;
  tipo: string;
  valor: number;
  data_vencimento: string;
  descricao: string;
  categoria_id: number | null;
  conta_id: number;
  status: string;
}
interface Meta {
  categoria_id: number;
  valor: number;
}

const getNomeMes = (mes: string) => {
  const meses = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return meses[parseInt(mes, 10) - 1];
};

const formatarMesAno = (yyyymm: string) => {
  if (!yyyymm) return "";
  const [ano, mes] = yyyymm.split("-");
  return `${getNomeMes(mes)} ${ano}`;
};

export default function RankingScreen() {
  const db = useSQLiteContext();

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);

  const hoje = new Date();
  const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  // No Ranking, é melhor começar já filtrado no mês atual para fazer sentido
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(
    mesAtualStr,
  );
  const [modalMesVisivel, setModalMesVisivel] = useState(false);

  const [modalMetaVisivel, setModalMetaVisivel] = useState(false);
  const [catSelecionada, setCatSelecionada] = useState<Categoria | null>(null);
  const [valorMetaInput, setValorMetaInput] = useState("");

  const carregarDados = useCallback(async () => {
    try {
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS metas (categoria_id INTEGER PRIMARY KEY, valor REAL);`,
      );
      setCategorias(
        await db.getAllAsync<Categoria>("SELECT * FROM categorias"),
      );
      setTransacoes(
        await db.getAllAsync<Transacao>("SELECT * FROM transacoes"),
      );
      setMetas(await db.getAllAsync<Meta>("SELECT * FROM metas"));
    } catch (error) {
      console.error(error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      carregarDados();
    }, [carregarDados]),
  );

  const anoAtual = new Date().getFullYear();
  const mesesDoAno = Array.from(
    { length: 12 },
    (_, i) => `${anoAtual}-${String(i + 1).padStart(2, "0")}`,
  );

  // Filtra as despesas baseadas no mês selecionado (ou todas se for Visão Anual)
  const despesasFiltradas = transacoes.filter((t) => {
    const mesDaTransacao = (t.data_vencimento || "").substring(0, 7);
    const passaMes =
      mesSelecionado === null || mesSelecionado === mesDaTransacao;
    return (
      passaMes &&
      t.tipo === "despesa" &&
      !t.descricao.includes("[Transf.]") &&
      t.categoria_id !== null &&
      t.status === "paga"
    );
  });

  const totalDespesas = despesasFiltradas.reduce(
    (acc, curr) => acc + curr.valor,
    0,
  );

  const dadosCategorias = categorias
    .filter((c) => c.tipo === "despesa" || !c.tipo)
    .map((cat) => {
      const totalCat = despesasFiltradas
        .filter((t) => t.categoria_id === cat.id)
        .reduce((acc, curr) => acc + curr.valor, 0);
      const porcentagemGeral =
        totalDespesas > 0 ? (totalCat / totalDespesas) * 100 : 0;

      const meta = metas.find((m) => m.categoria_id === cat.id)?.valor || 0;
      const porcentagemMeta = meta > 0 ? (totalCat / meta) * 100 : 0;

      let corBarra = cat.cor;
      let statusTexto = "";
      if (meta > 0) {
        if (porcentagemMeta >= 100) {
          corBarra = "#E76F51";
          statusTexto = "Estourou a Meta!";
        } else if (porcentagemMeta >= 80) {
          corBarra = "#F4A261";
          statusTexto = "Atenção!";
        } else {
          corBarra = "#2A9D8F";
          statusTexto = "Dentro da Meta";
        }
      }

      return {
        ...cat,
        totalCat,
        porcentagemGeral,
        meta,
        porcentagemMeta,
        corBarra,
        statusTexto,
      };
    })
    .filter((cat) => cat.totalCat > 0 || cat.meta > 0)
    .sort((a, b) => b.totalCat - a.totalCat);

  const salvarMeta = async () => {
    if (!catSelecionada) return;
    const valorNum = parseFloat(valorMetaInput.replace(",", "."));
    if (isNaN(valorNum) || valorNum < 0)
      return Alert.alert("Aviso", "Valor inválido.");
    try {
      if (valorNum === 0)
        await db.runAsync("DELETE FROM metas WHERE categoria_id = ?;", [
          catSelecionada.id,
        ]);
      else
        await db.runAsync(
          "REPLACE INTO metas (categoria_id, valor) VALUES (?, ?);",
          [catSelecionada.id, valorNum],
        );
      setModalMetaVisivel(false);
      setValorMetaInput("");
      setCatSelecionada(null);
      carregarDados();
    } catch {
      Alert.alert("Erro", "Não foi possível guardar a meta.");
    }
  };

  const abrirModalMeta = (categoria: (typeof dadosCategorias)[0]) => {
    setCatSelecionada(categoria);
    setValorMetaInput(categoria.meta > 0 ? categoria.meta.toString() : "");
    setModalMetaVisivel(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Orçamentos</Text>
        <Text style={styles.subtitle}>
          Clica numa categoria para definir um limite
        </Text>
      </View>

      <View style={styles.filterSection}>
        <TouchableOpacity
          style={styles.monthButton}
          onPress={() => setModalMesVisivel(true)}
        >
          <MaterialIcons name="calendar-month" size={20} color="#E76F51" />
          <Text style={styles.monthButtonText}>
            {mesSelecionado
              ? formatarMesAno(mesSelecionado)
              : `Visão Anual (${anoAtual})`}
          </Text>
          <MaterialIcons name="arrow-drop-down" size={24} color="#666" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <Text style={styles.totalCardTitle}>Total Gasto</Text>
          <Text style={styles.totalCardAmount}>
            R$ {totalDespesas.toFixed(2)}
          </Text>
        </View>

        {dadosCategorias.length === 0 ? (
          <Text style={styles.emptyText}>
            Nenhuma despesa registada neste período.
          </Text>
        ) : (
          <View style={styles.chartContainer}>
            {dadosCategorias.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={styles.barWrapper}
                onPress={() => abrirModalMeta(item)}
                activeOpacity={0.7}
              >
                <View style={styles.barHeader}>
                  <View style={styles.catLabelRow}>
                    <Text style={styles.rankNumber}>{index + 1}º</Text>
                    <View
                      style={[styles.colorDot, { backgroundColor: item.cor }]}
                    />
                    <Text style={styles.catName}>{item.nome}</Text>
                  </View>
                  <View style={styles.catValueRow}>
                    <Text style={styles.catAmount}>
                      R$ {item.totalCat.toFixed(2)}
                    </Text>
                    {item.meta > 0 ? (
                      <Text
                        style={[styles.catPercent, { color: item.corBarra }]}
                      >
                        {item.porcentagemMeta.toFixed(0)}% da meta
                      </Text>
                    ) : (
                      <Text style={styles.catPercent}>
                        {item.porcentagemGeral.toFixed(1)}% do total
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.progressBarBackground}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: item.corBarra,
                        width: `${Math.min(item.meta > 0 ? item.porcentagemMeta : item.porcentagemGeral, 100)}%`,
                      },
                    ]}
                  />
                </View>

                {item.meta > 0 && (
                  <View style={styles.metaInfoRow}>
                    <Text style={styles.metaInfoText}>
                      Limite: R$ {item.meta.toFixed(2)}
                    </Text>
                    <Text
                      style={[styles.metaStatusText, { color: item.corBarra }]}
                    >
                      {item.statusTexto}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* MODAL DE METAS */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalMetaVisivel}
        onRequestClose={() => setModalMetaVisivel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Meta para {catSelecionada?.nome}
            </Text>
            <Text style={styles.colorLabel}>
              Qual é o máximo que queres gastar?
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 300.00 (Coloca 0 para remover)"
              value={valorMetaInput}
              onChangeText={setValorMetaInput}
              keyboardType="numeric"
            />
            <View style={styles.modalButtons}>
              <Button
                title="Cancelar"
                color="#999"
                onPress={() => setModalMetaVisivel(false)}
              />
              <Button
                title="Salvar Meta"
                color="#E76F51"
                onPress={salvarMeta}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DE MESES */}
      <FinFlowPopup
        animationType="fade"
        transparent={true}
        visible={modalMesVisivel}
        onRequestClose={() => setModalMesVisivel(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Escolher Período</Text>
            <View style={styles.wrapContainer}>
              <TouchableOpacity
                style={[
                  styles.filterPill,
                  mesSelecionado === null && styles.filterPillActive,
                ]}
                onPress={() => {
                  setMesSelecionado(null);
                  setModalMesVisivel(false);
                }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    mesSelecionado === null && styles.filterPillTextActive,
                  ]}
                >
                  Visão Anual
                </Text>
              </TouchableOpacity>
              {mesesDoAno.map((yyyymm) => (
                <TouchableOpacity
                  key={`fmes-${yyyymm}`}
                  style={[
                    styles.filterPill,
                    mesSelecionado === yyyymm && styles.filterPillActive,
                  ]}
                  onPress={() => {
                    setMesSelecionado(yyyymm);
                    setModalMesVisivel(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      mesSelecionado === yyyymm && styles.filterPillTextActive,
                    ]}
                  >
                    {formatarMesAno(yyyymm)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button
              title="Cancelar"
              color="#999"
              onPress={() => setModalMesVisivel(false)}
            />
          </View>
        </View>
      </FinFlowPopup>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    padding: 20,
    paddingTop: 30,
    backgroundColor: "#FFF",
    paddingBottom: 10,
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#1A1A1A" },
  subtitle: { fontSize: 14, color: "#666", marginTop: 4 },
  filterSection: { paddingHorizontal: 20, marginBottom: 15 },
  monthButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F9FA",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  monthButtonText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  content: { flex: 1, paddingHorizontal: 20 },
  totalCard: {
    backgroundColor: "#E76F51",
    padding: 20,
    borderRadius: 16,
    marginBottom: 25,
    elevation: 4,
    alignItems: "center",
  },
  totalCardTitle: {
    color: "#FFDCCB",
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  totalCardAmount: {
    color: "#FFF",
    fontSize: 36,
    fontWeight: "bold",
    marginTop: 5,
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 20,
  },
  chartContainer: {
    backgroundColor: "#F8F9FA",
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  barWrapper: { marginBottom: 20 },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  catLabelRow: { flexDirection: "row", alignItems: "center" },
  rankNumber: { fontSize: 13, fontWeight: "bold", color: "#999", width: 22 },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  catName: { fontSize: 15, fontWeight: "600", color: "#333" },
  catValueRow: { alignItems: "flex-end" },
  catAmount: { fontSize: 15, fontWeight: "bold", color: "#1A1A1A" },
  catPercent: { fontSize: 12, color: "#666", fontWeight: "bold" },
  progressBarBackground: {
    height: 12,
    backgroundColor: "#EAEAEA",
    borderRadius: 6,
    overflow: "hidden",
  },
  progressBarFill: { height: "100%", borderRadius: 6 },
  metaInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  metaInfoText: { fontSize: 12, color: "#999", fontWeight: "500" },
  metaStatusText: { fontSize: 12, fontWeight: "bold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#FFF",
    width: "90%",
    padding: 25,
    borderRadius: 16,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#1A1A1A",
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 25,
  },
  colorLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
    marginBottom: 10,
  },
  modalButtons: { flexDirection: "row", justifyContent: "space-around" },
  wrapContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 25,
    justifyContent: "center",
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#F0F0F0",
  },
  filterPillActive: { backgroundColor: "#1A1A1A" },
  filterPillText: { fontSize: 14, color: "#555", fontWeight: "500" },
  filterPillTextActive: { color: "#FFF", fontWeight: "bold" },
});
