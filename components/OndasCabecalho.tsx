import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * Ondas translúcidas que se movem devagar no fundo dos cabeçalhos coloridos
 * (Início e Cartões), num vai e vem de 9 s para cada lado.
 *
 * Coloque como primeiro filho de um cabeçalho com `overflow: "hidden"`: as
 * ondas ficam por trás do conteúdo e não recebem toques.
 */
export default function OndasCabecalho() {
  const movimento = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animacao = Animated.loop(
      Animated.sequence([
        Animated.timing(movimento, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(movimento, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animacao.start();
    return () => animacao.stop();
  }, [movimento]);

  const deslocar = (x: [number, number], y: [number, number], rotacao: string) => ({
    transform: [
      { translateX: movimento.interpolate({ inputRange: [0, 1], outputRange: x }) },
      { translateY: movimento.interpolate({ inputRange: [0, 1], outputRange: y }) },
      { rotate: rotacao },
    ],
  });

  return (
    <View pointerEvents="none" style={styles.ondas}>
      <Animated.View style={[styles.onda, styles.ondaUm, deslocar([-18, 22], [-5, 8], "-10deg")]} />
      <Animated.View style={[styles.onda, styles.ondaDois, deslocar([20, -15], [7, -6], "12deg")]} />
      <Animated.View style={[styles.onda, styles.ondaTres, deslocar([-10, 16], [4, -5], "-7deg")]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ondas: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  onda: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  ondaUm: { width: 420, height: 155, right: -175, top: 45 },
  ondaDois: { width: 390, height: 135, left: -205, top: 92, backgroundColor: "rgba(255,255,255,0.06)" },
  ondaTres: { width: 330, height: 105, right: -105, bottom: -58, backgroundColor: "rgba(0,55,48,0.10)" },
});
