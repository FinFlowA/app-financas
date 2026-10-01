import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import FinFlowPopup from "./FinFlowPopup";
import { FinFlowShadow } from "../constants/finflow-design";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export type CoresCalendario = {
  card: string;
  pill: string;
  borda: string;
  texto: string;
  textoSecundario: string;
};

const inicioDoDia = (data: Date) => new Date(data.getFullYear(), data.getMonth(), data.getDate());

/**
 * Calendário no visual do FinFlow (o mesmo do lançamento de transação), no
 * lugar do seletor nativo do Android, que não segue as cores do app.
 */
export default function CalendarioPopup({
  visivel,
  valor,
  aoSelecionar,
  aoFechar,
  corDestaque,
  cores,
  titulo = "Selecionar data",
  subtitulo = "Escolha o dia.",
  dataMinima,
}: {
  visivel: boolean;
  valor: Date | null;
  aoSelecionar: (data: Date) => void;
  aoFechar: () => void;
  corDestaque: string;
  cores: CoresCalendario;
  titulo?: string;
  subtitulo?: string;
  dataMinima?: Date;
}) {
  const [mesExibido, setMesExibido] = useState(() => valor ?? new Date());
  const [escolhendoPeriodo, setEscolhendoPeriodo] = useState(false);

  useEffect(() => {
    if (!visivel) return;
    setMesExibido(valor ?? new Date());
    setEscolhendoPeriodo(false);
  }, [visivel, valor]);

  const dias = useMemo(() => {
    const ano = mesExibido.getFullYear();
    const mes = mesExibido.getMonth();
    const primeiroDia = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();
    return [
      ...Array.from({ length: primeiroDia }, () => null),
      ...Array.from({ length: totalDias }, (_, indice) => indice + 1),
    ];
  }, [mesExibido]);

  const minimo = dataMinima ? inicioDoDia(dataMinima).getTime() : null;
  const mudarMes = (delta: number) => setMesExibido((data) => new Date(data.getFullYear(), data.getMonth() + delta, 1));
  const mudarAno = (delta: number) => setMesExibido((data) => new Date(data.getFullYear() + delta, data.getMonth(), 1));

  if (!visivel) return null;

  return (
    <FinFlowPopup animationType="fade" transparent visible onRequestClose={aoFechar}>
      <View style={styles.overlay}>
        <View style={[styles.painel, FinFlowShadow, { backgroundColor: cores.card, borderColor: cores.borda }]}>
          <View style={styles.cabecalho}>
            <View style={[styles.cabecalhoIcone, { backgroundColor: `${corDestaque}22` }]}>
              <MaterialIcons name="calendar-month" size={22} color={corDestaque} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.titulo, { color: cores.texto }]}>{titulo}</Text>
              <Text style={[styles.subtitulo, { color: cores.textoSecundario }]}>{subtitulo}</Text>
            </View>
            <TouchableOpacity style={[styles.fechar, { backgroundColor: cores.pill }]} onPress={aoFechar} accessibilityLabel="Fechar calendário">
              <MaterialIcons name="close" size={20} color={cores.textoSecundario} />
            </TouchableOpacity>
          </View>

          <View style={[styles.calendario, { backgroundColor: cores.pill, borderColor: cores.borda }]}>
            <View style={styles.linhaMes}>
              <TouchableOpacity style={styles.seta} onPress={() => mudarMes(-1)} accessibilityLabel="Mês anterior">
                <MaterialIcons name="chevron-left" size={22} color={cores.texto} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.botaoPeriodo, { borderColor: cores.borda }]}
                onPress={() => setEscolhendoPeriodo((aberto) => !aberto)}
                accessibilityLabel="Selecionar mês e ano"
              >
                <Text style={[styles.tituloMes, { color: cores.texto }]}>{MESES[mesExibido.getMonth()]} {mesExibido.getFullYear()}</Text>
                <MaterialIcons name={escolhendoPeriodo ? "keyboard-arrow-up" : "keyboard-arrow-down"} size={18} color={cores.textoSecundario} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.seta} onPress={() => mudarMes(1)} accessibilityLabel="Próximo mês">
                <MaterialIcons name="chevron-right" size={22} color={cores.texto} />
              </TouchableOpacity>
            </View>

            {escolhendoPeriodo ? (
              <View>
                <View style={styles.linhaAno}>
                  <TouchableOpacity style={styles.seta} onPress={() => mudarAno(-1)} accessibilityLabel="Ano anterior">
                    <MaterialIcons name="chevron-left" size={23} color={cores.texto} />
                  </TouchableOpacity>
                  <Text style={[styles.textoAno, { color: cores.texto }]}>{mesExibido.getFullYear()}</Text>
                  <TouchableOpacity style={styles.seta} onPress={() => mudarAno(1)} accessibilityLabel="Próximo ano">
                    <MaterialIcons name="chevron-right" size={23} color={cores.texto} />
                  </TouchableOpacity>
                </View>
                <View style={styles.gradeMeses}>
                  {MESES.map((mes, indice) => {
                    const ativo = indice === mesExibido.getMonth();
                    return (
                      <TouchableOpacity
                        key={mes}
                        style={[styles.opcaoMes, ativo && { backgroundColor: corDestaque }]}
                        onPress={() => {
                          setMesExibido((data) => new Date(data.getFullYear(), indice, 1));
                          setEscolhendoPeriodo(false);
                        }}
                      >
                        <Text style={[styles.textoOpcaoMes, { color: ativo ? "#FFF" : cores.texto }]}>{mes.slice(0, 3)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : (
              <>
                <View style={styles.linhaSemana}>
                  {DIAS_SEMANA.map((dia, indice) => (
                    <Text key={`${dia}-${indice}`} style={[styles.diaSemana, { color: cores.textoSecundario }]}>{dia}</Text>
                  ))}
                </View>
                <View style={styles.gradeDias}>
                  {dias.map((dia, indice) => {
                    if (dia === null) return <View key={`vazio-${indice}`} style={styles.celula} />;
                    const data = new Date(mesExibido.getFullYear(), mesExibido.getMonth(), dia);
                    const bloqueado = minimo !== null && data.getTime() < minimo;
                    const selecionado = valor !== null
                      && dia === valor.getDate()
                      && mesExibido.getMonth() === valor.getMonth()
                      && mesExibido.getFullYear() === valor.getFullYear();
                    return (
                      <TouchableOpacity
                        key={`dia-${dia}`}
                        style={styles.celula}
                        disabled={bloqueado}
                        onPress={() => {
                          aoSelecionar(data);
                          aoFechar();
                        }}
                        accessibilityLabel={`Selecionar dia ${dia}`}
                        accessibilityState={{ disabled: bloqueado, selected: selecionado }}
                      >
                        <View style={[styles.circuloDia, selecionado && { backgroundColor: corDestaque }]}>
                          <Text style={[
                            styles.textoDia,
                            { color: selecionado ? "#FFF" : cores.texto },
                            bloqueado && styles.diaBloqueado,
                          ]}>{dia}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    </FinFlowPopup>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.7)", justifyContent: "center", alignItems: "center" },
  painel: { width: "90%", maxWidth: 380, borderRadius: 24, borderWidth: 1, padding: 18, elevation: 12 },
  cabecalho: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 15 },
  cabecalhoIcone: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 18, fontWeight: "900" },
  subtitulo: { fontSize: 11, marginTop: 2 },
  fechar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  calendario: { borderWidth: 1, borderRadius: 18, padding: 11 },
  linhaMes: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  seta: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  botaoPeriodo: { minHeight: 35, minWidth: 150, borderRadius: 12, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  tituloMes: { fontSize: 14, fontWeight: "900", textTransform: "capitalize" },
  linhaAno: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22, marginBottom: 8 },
  textoAno: { fontSize: 17, fontWeight: "900", minWidth: 56, textAlign: "center" },
  gradeMeses: { flexDirection: "row", flexWrap: "wrap", rowGap: 7 },
  opcaoMes: { width: "25%", height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  textoOpcaoMes: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  linhaSemana: { flexDirection: "row" },
  diaSemana: { width: `${100 / 7}%`, textAlign: "center", fontSize: 9, fontWeight: "900", paddingVertical: 4 },
  gradeDias: { flexDirection: "row", flexWrap: "wrap" },
  celula: { width: `${100 / 7}%`, height: 38, alignItems: "center", justifyContent: "center" },
  circuloDia: { width: 29, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  textoDia: { fontSize: 12, fontWeight: "700" },
  diaBloqueado: { opacity: 0.3 },
});
