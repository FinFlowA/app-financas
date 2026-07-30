import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";

type Props = {
  value: string;
  onChange: (color: string) => void;
  dark?: boolean;
};

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export default function ColorPalettePicker({ value, onChange, dark = false }: Props) {
  const [size, setSize] = useState({ width: 1, height: 150 });
  const [point, setPoint] = useState({ x: 0.45, y: 0.35 });
  const changeAt = (x: number, y: number) => {
    const nx = Math.max(0, Math.min(1, x / size.width));
    const ny = Math.max(0, Math.min(1, y / size.height));
    setPoint({ x: nx, y: ny });
    const saturation = ny <= 0.5 ? ny * 2 : 1;
    const brightness = ny <= 0.5 ? 1 : 1 - (ny - 0.5) * 2;
    onChange(hsvToHex(nx * 360, saturation, Math.max(0.08, brightness)));
  };
  const changeRef = useRef(changeAt);
  changeRef.current = changeAt;
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => changeRef.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderMove: (e) => changeRef.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
  }), []);
  const cells = useMemo(() => Array.from({ length: 12 }, (_, row) =>
    Array.from({ length: 24 }, (_, column) => {
      const y = row / 11;
      const saturation = y <= 0.5 ? y * 2 : 1;
      const brightness = y <= 0.5 ? 1 : 1 - (y - 0.5) * 2;
      return hsvToHex((column / 24) * 360, saturation, Math.max(0.08, brightness));
    })
  ), []);

  return (
    <View>
      <View
        {...panResponder.panHandlers}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
        style={styles.palette}
        accessibilityLabel="Paleta de cor personalizada"
      >
        {cells.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((color, columnIndex) => <View key={columnIndex} style={{ flex: 1, backgroundColor: color }} />)}
          </View>
        ))}
        <View style={[styles.cursor, { left: point.x * size.width - 10, top: point.y * size.height - 10 }]} />
      </View>
      <View style={[styles.result, { backgroundColor: dark ? "#252525" : "#F4F4F4" }]}>
        <View style={[styles.swatch, { backgroundColor: value }]} />
        <Text style={{ color: dark ? "#FFF" : "#27313A", fontWeight: "700" }}>Cor escolhida</Text>
        <Text style={{ color: dark ? "#AAA" : "#68727D", marginLeft: "auto", fontSize: 12 }}>Deslize na paleta</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  palette: { height: 150, borderRadius: 14, overflow: "hidden", marginTop: 10 },
  row: { flex: 1, flexDirection: "row" },
  cursor: { position: "absolute", width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: "#FFF", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 3, elevation: 4 },
  result: { marginTop: 8, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: "rgba(127,127,127,.35)" },
});
