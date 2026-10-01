import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/** Três pontinhos pulando em sequência, como o "digitando..." do WhatsApp. */
export default function IndicadorDigitando({ cor }: { cor: string }) {
  const pontos = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const pulo = (valor: Animated.Value) => Animated.sequence([
      Animated.timing(valor, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(valor, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    const ciclo = Animated.loop(Animated.sequence([
      Animated.stagger(150, pontos.map(pulo)),
      Animated.delay(220),
    ]));
    ciclo.start();
    return () => ciclo.stop();
  }, [pontos]);

  return (
    <View style={styles.linha} accessibilityRole="progressbar" accessibilityLabel="Finn está digitando">
      {pontos.map((valor, indice) => (
        <Animated.View
          key={indice}
          style={[styles.ponto, {
            backgroundColor: cor,
            opacity: valor.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: valor.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: "row", alignItems: "center", gap: 5, height: 18, paddingTop: 4 },
  ponto: { width: 8, height: 8, borderRadius: 4 },
});
