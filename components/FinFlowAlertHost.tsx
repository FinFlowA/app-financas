import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, type AlertButton, type AlertOptions } from "react-native";
import Modal from "./FinFlowPopup";
import { finFlowTheme, FinFlowRadius, FinFlowShadow } from "../constants/finflow-design";

type AlertState = { title: string; message?: string; buttons: AlertButton[] } | null;

export default function FinFlowAlertHost({ isDark }: { isDark: boolean }) {
  const [alerta, setAlerta] = useState<AlertState>(null);
  const theme = finFlowTheme(isDark);

  useEffect(() => {
    const original = Alert.alert;
    Alert.alert = (title: string, message?: string, buttons?: AlertButton[], _options?: AlertOptions) => {
      setAlerta({ title, message, buttons: buttons?.length ? buttons : [{ text: "Entendi" }] });
    };
    return () => { Alert.alert = original; };
  }, []);

  if (!alerta) return null;
  const fechar = (botao: AlertButton) => {
    setAlerta(null);
    botao.onPress?.();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setAlerta(null)}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
            <MaterialIcons name="info-outline" size={28} color={theme.primary} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{alerta.title}</Text>
          {!!alerta.message && <Text style={[styles.message, { color: theme.textMuted }]}>{alerta.message}</Text>}
          <View style={styles.actions}>
            {alerta.buttons.map((button, index) => {
              const destructive = button.style === "destructive";
              const cancel = button.style === "cancel";
              return (
                <TouchableOpacity
                  key={`${button.text}-${index}`}
                  style={[styles.button, { backgroundColor: cancel ? theme.surfaceMuted : destructive ? "#D95757" : theme.primary }]}
                  onPress={() => fechar(button)}
                >
                  <Text style={{ color: cancel ? theme.text : "#FFF", fontWeight: "800" }}>{button.text || "OK"}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: FinFlowRadius.large, borderWidth: 1, padding: 24, alignItems: "center", ...FinFlowShadow },
  icon: { width: 58, height: 58, borderRadius: 29, justifyContent: "center", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: "900", textAlign: "center" },
  message: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, marginBottom: 22 },
  actions: { width: "100%", gap: 9 },
  button: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
