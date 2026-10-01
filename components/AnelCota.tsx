import React from "react";
import { StyleSheet, View } from "react-native";
import { rotacoesAnel } from "../lib/cota-ia";

/**
 * Anel de progresso feito só com Views (o app não tem react-native-svg, e
 * adicioná-lo exigiria um APK novo). Cada metade é um círculo com duas bordas
 * coloridas (um arco de 180°) que gira dentro de um recorte de meia largura.
 */
export default function AnelCota({
  fracao,
  cor,
  corTrilho,
  tamanho = 30,
  espessura = 3,
}: {
  fracao: number;
  cor: string;
  corTrilho: string;
  tamanho?: number;
  espessura?: number;
}) {
  const metade = tamanho / 2;
  const { direita, esquerda } = rotacoesAnel(fracao);
  const circulo = {
    position: "absolute" as const,
    top: 0,
    width: tamanho,
    height: tamanho,
    borderRadius: metade,
    borderWidth: espessura,
  };
  // Bordas de cima e da direita coloridas = arco de -45° a 135°.
  const arco = { ...circulo, borderColor: "transparent", borderTopColor: cor, borderRightColor: cor };

  return (
    <View style={{ width: tamanho, height: tamanho }}>
      <View style={[circulo, { left: 0, borderColor: corTrilho }]} />
      <View style={[styles.recorte, { left: metade, width: metade, height: tamanho }]}>
        <View style={[arco, { left: -metade, transform: [{ rotate: `${direita}deg` }] }]} />
      </View>
      {esquerda !== null && (
        <View style={[styles.recorte, { left: 0, width: metade, height: tamanho }]}>
          <View style={[arco, { left: 0, transform: [{ rotate: `${esquerda}deg` }] }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recorte: { position: "absolute", top: 0, overflow: "hidden" },
});
