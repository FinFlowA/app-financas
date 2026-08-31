import React, { type ReactNode } from "react";
import { Modal } from "react-native";

export default function FinFlowPopup({
  visible = true,
  children,
  onRequestClose,
  animationType = "fade",
  statusBarTranslucent = true,
}: {
  visible?: boolean;
  children?: ReactNode;
  onRequestClose?: () => void;
  animationType?: "none" | "slide" | "fade";
  transparent?: boolean;
  statusBarTranslucent?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={onRequestClose}
    >
      {children}
    </Modal>
  );
}
