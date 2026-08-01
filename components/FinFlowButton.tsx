import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from "react-native";

type Props = {
  title: string;
  onPress?: () => void;
  color?: string;
  disabled?: boolean;
  style?: ViewStyle;
};

export default function FinFlowButton({ title, onPress, color = "#2A9D8F", disabled = false, style }: Props) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: color }, disabled && styles.disabled, style]}
    >
      {disabled && /aguarde|salvando/i.test(title) ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <Text style={styles.label}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 112,
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  label: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.56 },
});
