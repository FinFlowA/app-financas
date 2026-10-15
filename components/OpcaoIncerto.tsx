import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const COR_INCERTO = "#8B6CDB";

/**
 * "Não tenho certeza deste lançamento": receita ou despesa única pendente que
 * fica de fora do Fluxo de caixa quando "Considerar incertos" está desligado.
 */
export default function OpcaoIncerto({ marcado, onAlternar, cores }: {
  marcado: boolean;
  onAlternar: () => void;
  cores: { texto: string; textoSecundario: string; borda: string; fundo: string };
}) {
  return (
    <TouchableOpacity
      style={[styles.opcao, { borderColor: marcado ? COR_INCERTO : cores.borda, backgroundColor: marcado ? "rgba(139, 108, 219, 0.12)" : cores.fundo }]}
      onPress={onAlternar}
      activeOpacity={0.75}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcado }}
      accessibilityLabel="Não tenho certeza deste lançamento"
    >
      <MaterialIcons name={marcado ? "check-box" : "check-box-outline-blank"} size={22} color={marcado ? COR_INCERTO : cores.textoSecundario} />
      <View style={styles.textos}>
        <Text style={[styles.titulo, { color: cores.texto }]}>Não tenho certeza deste lançamento</Text>
        <Text style={[styles.texto, { color: cores.textoSecundario }]}>No Fluxo de caixa, desligue “Considerar incertos” para ver a projeção sem ele.</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  opcao: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, marginTop: 10 },
  textos: { flex: 1, minWidth: 0 },
  titulo: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  texto: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
});
