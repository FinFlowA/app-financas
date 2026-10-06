import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { largurasDaBarra, type ProgressoDoAlvo } from "../web/src/lib/metas-categorias";

const COR_OK = "#2A9D8F";
const COR_ALERTA = "#F4A261";
const COR_ESTOURADO = "#E76F51";

/**
 * Barra do mês da meta (receitas) ou do limite (despesas) de uma categoria:
 * a parte cheia é o que já aconteceu e a mais clara, o que está agendado.
 * O cálculo é o mesmo do site (web/src/lib/metas-categorias.ts).
 */
export default function ProgressoMetaCategoria({
  progresso,
  formatar,
  corTexto,
  corTextoSecundario,
  corTrilho,
}: {
  progresso: ProgressoDoAlvo;
  formatar: (valor: number) => string;
  corTexto: string;
  corTextoSecundario: string;
  corTrilho: string;
}) {
  const larguras = largurasDaBarra(progresso);
  const limite = progresso.tipo === "limite";
  const cor = progresso.situacao === "estourado" ? COR_ESTOURADO : progresso.situacao === "alerta" ? COR_ALERTA : COR_OK;
  const percentual = Math.round(progresso.percentual);
  const situacao = limite
    ? progresso.situacao === "estourado"
      ? `Passou ${formatar(-progresso.restante)} do limite`
      : `${percentual}% usado · restam ${formatar(progresso.restante)}`
    : progresso.situacao === "atingida"
      ? "Meta atingida"
      : `${percentual}% da meta · faltam ${formatar(progresso.restante)}`;
  const agendado = progresso.agendado > 0.004 ? ` · ${formatar(progresso.agendado)} ${limite ? "agendado" : "a receber"}` : "";
  const titulo = limite ? "Limite do mês" : "Meta do mês";

  return (
    <View
      style={estilos.caixa}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${titulo}: ${formatar(progresso.realizado)} de ${formatar(progresso.alvo)}. ${situacao}${agendado}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.max(0, percentual)) }}
    >
      <View style={estilos.linha}>
        <Text style={[estilos.rotulo, { color: corTextoSecundario }]}>{titulo}</Text>
        <Text style={[estilos.valor, { color: corTexto }]} numberOfLines={1}>
          {formatar(progresso.realizado)} <Text style={[estilos.valorAlvo, { color: corTextoSecundario }]}>de {formatar(progresso.alvo)}</Text>
        </Text>
      </View>
      <View style={[estilos.trilho, { backgroundColor: corTrilho }]}>
        <View style={{ width: `${larguras.realizado}%`, backgroundColor: cor }} />
        <View style={{ width: `${larguras.agendado}%`, backgroundColor: cor, opacity: 0.35 }} />
      </View>
      <Text style={[estilos.situacao, { color: progresso.situacao === "estourado" ? COR_ESTOURADO : corTextoSecundario }]}>
        {situacao}{agendado}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  caixa: { marginTop: 8, gap: 5 },
  linha: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  rotulo: { fontSize: 11, fontWeight: "700" },
  valor: { flexShrink: 1, fontSize: 12, fontWeight: "800" },
  valorAlvo: { fontSize: 12, fontWeight: "600" },
  trilho: { flexDirection: "row", height: 7, borderRadius: 4, overflow: "hidden" },
  situacao: { fontSize: 11, lineHeight: 15 },
});
