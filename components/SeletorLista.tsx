import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FinFlowPopup from "./FinFlowPopup";
import { FinFlowShadow } from "../constants/finflow-design";
import { useSobreposicaoTeclado } from "../hooks/use-teclado";
import { filtrarOpcoesSeletor, type OpcaoSeletor } from "../lib/seletor-busca";

export type { OpcaoSeletor } from "../lib/seletor-busca";

export type CoresSeletor = {
  card: string;
  campo: string;
  borda: string;
  pill: string;
  texto: string;
  textoSecundario: string;
};

type Props = {
  /** Nome do campo, no singular: "Conta", "Categoria"... */
  rotulo: string;
  placeholder: string;
  opcoes: readonly OpcaoSeletor[];
  selecionadoId: OpcaoSeletor["id"] | null;
  onSelecionar: (opcao: OpcaoSeletor) => void;
  corDestaque: string;
  cores: CoresSeletor;
  iconePadrao?: React.ComponentProps<typeof MaterialIcons>["name"];
};

/**
 * Campo de escolha que abre a lista completa de opções.
 *
 * O primeiro toque mostra tudo, sem teclado. A busca fica no topo da folha e só
 * abre o teclado quando tocada; por estar no topo, continua visível com o
 * teclado aberto (a folha sobe junto, ver useSobreposicaoTeclado).
 */
export default function SeletorLista({
  rotulo,
  placeholder,
  opcoes,
  selecionadoId,
  onSelecionar,
  corDestaque,
  cores,
  iconePadrao = "label-outline",
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const areaRef = useRef<View>(null);
  const sobreposicao = useSobreposicaoTeclado(areaRef, aberto && Platform.OS === "android");
  const selecionado = opcoes.find((opcao) => opcao.id === selecionadoId) ?? null;
  const filtradas = useMemo(() => filtrarOpcoesSeletor(opcoes, busca), [opcoes, busca]);

  const fechar = () => {
    setAberto(false);
    setBusca("");
  };

  const renderMarcador = (opcao: OpcaoSeletor, ativo: boolean) => {
    if (opcao.cor && !opcao.icone) return <View style={[styles.bolinha, { backgroundColor: opcao.cor }]} />;
    if (opcao.cor && opcao.icone) {
      return (
        <View style={[styles.iconeRedondo, { backgroundColor: opcao.cor }]}>
          <MaterialIcons name={opcao.icone as never} size={12} color="#FFF" />
        </View>
      );
    }
    return (
      <MaterialIcons
        name={(opcao.icone ?? iconePadrao) as never}
        size={18}
        color={ativo ? corDestaque : cores.textoSecundario}
      />
    );
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.gatilho, { backgroundColor: cores.campo, borderColor: selecionado ? corDestaque : cores.borda }]}
        onPress={() => setAberto(true)}
        accessibilityRole="button"
        accessibilityLabel={`${rotulo}: ${selecionado?.titulo ?? "nenhuma opção escolhida"}. Toque para escolher.`}
      >
        {selecionado ? renderMarcador(selecionado, true) : <MaterialIcons name={iconePadrao} size={18} color={cores.textoSecundario} />}
        <Text
          style={[styles.gatilhoTexto, { color: selecionado ? cores.texto : cores.textoSecundario }]}
          numberOfLines={1}
        >
          {selecionado?.titulo ?? placeholder}
        </Text>
        <MaterialIcons name="keyboard-arrow-down" size={22} color={cores.textoSecundario} />
      </TouchableOpacity>

      <FinFlowPopup visible={aberto} onRequestClose={fechar}>
        <View ref={areaRef} style={[styles.overlay, { paddingBottom: sobreposicao }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={fechar} accessibilityLabel="Fechar lista" />
          <KeyboardAvoidingView
            enabled={Platform.OS === "ios"}
            behavior="padding"
            style={styles.area}
            pointerEvents="box-none"
          >
            <View style={[styles.folha, FinFlowShadow, { backgroundColor: cores.card, borderColor: cores.borda }]}>
              <View style={styles.cabecalho}>
                <Text style={[styles.titulo, { color: cores.texto }]}>{rotulo}</Text>
                <TouchableOpacity
                  style={[styles.fechar, { backgroundColor: cores.pill }]}
                  onPress={fechar}
                  accessibilityLabel="Fechar"
                >
                  <MaterialIcons name="close" size={20} color={cores.textoSecundario} />
                </TouchableOpacity>
              </View>

              <View style={[styles.busca, { backgroundColor: cores.campo, borderColor: cores.borda }]}>
                <MaterialIcons name="search" size={19} color={cores.textoSecundario} />
                <TextInput
                  style={[styles.buscaTexto, { color: cores.texto }]}
                  placeholder="Toque para pesquisar"
                  placeholderTextColor={cores.textoSecundario}
                  value={busca}
                  onChangeText={setBusca}
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel={`Pesquisar ${rotulo.toLowerCase()}`}
                />
                {busca.length > 0 && (
                  <TouchableOpacity onPress={() => setBusca("")} accessibilityLabel="Limpar pesquisa">
                    <MaterialIcons name="close" size={18} color={cores.textoSecundario} />
                  </TouchableOpacity>
                )}
              </View>

              <FlatList
                data={filtradas}
                keyExtractor={(opcao) => String(opcao.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                style={styles.lista}
                contentContainerStyle={styles.listaConteudo}
                ListEmptyComponent={
                  <Text style={[styles.vazio, { color: cores.textoSecundario }]}>
                    {busca ? `Nada encontrado para "${busca}".` : "Nenhuma opção disponível."}
                  </Text>
                }
                renderItem={({ item, index }) => {
                  const ativo = item.id === selecionadoId;
                  const novoGrupo = item.grupo && item.grupo !== filtradas[index - 1]?.grupo;
                  return (
                    <View>
                      {novoGrupo && <Text style={[styles.grupo, { color: cores.textoSecundario }]}>{item.grupo}</Text>}
                      <TouchableOpacity
                        style={[styles.opcao, { borderColor: ativo ? corDestaque : cores.borda, backgroundColor: ativo ? `${corDestaque}14` : "transparent" }]}
                        onPress={() => {
                          onSelecionar(item);
                          fechar();
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: ativo }}
                        accessibilityLabel={item.titulo}
                      >
                        {renderMarcador(item, ativo)}
                        <Text style={[styles.opcaoTexto, { color: cores.texto }]} numberOfLines={2}>{item.titulo}</Text>
                        {ativo && <MaterialIcons name="check-circle" size={20} color={corDestaque} />}
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </FinFlowPopup>
    </>
  );
}

const styles = StyleSheet.create({
  gatilho: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  gatilhoTexto: { flex: 1, fontSize: 15, fontWeight: "600" },
  bolinha: { width: 12, height: 12, borderRadius: 6 },
  iconeRedondo: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(2,12,15,0.72)" },
  area: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  folha: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "78%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 16,
  },
  cabecalho: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 },
  titulo: { fontSize: 18, fontWeight: "900" },
  fechar: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  busca: {
    minHeight: 48,
    marginHorizontal: 20,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  buscaTexto: { flex: 1, fontSize: 15, paddingVertical: 10 },
  // Encolhe dentro do maxHeight da folha para a lista rolar em vez de vazar.
  lista: { flexGrow: 0, flexShrink: 1 },
  listaConteudo: { paddingHorizontal: 20, paddingBottom: 28 },
  grupo: { fontSize: 10, fontWeight: "900", letterSpacing: 0.45, textTransform: "uppercase", marginTop: 8, marginBottom: 6 },
  opcao: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  opcaoTexto: { flex: 1, fontSize: 15, fontWeight: "600" },
  vazio: { textAlign: "center", fontSize: 13, paddingVertical: 24 },
});
