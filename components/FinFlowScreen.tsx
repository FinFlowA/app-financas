import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, type ModalProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { finFlowTheme } from "../constants/finflow-design";
import { useTheme } from "@react-navigation/native";

type FlowEntry = {
  content: ReactNode;
  onRequestClose?: () => void;
};

type FlowRegistry = {
  entries: ReadonlyMap<string, FlowEntry>;
  register: (id: string, entry: FlowEntry) => void;
  unregister: (id: string) => void;
};

const FlowScreenContext = createContext<FlowRegistry | null>(null);
let nextFlowId = 0;

export function FinFlowScreenProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, FlowEntry>>(() => new Map());
  const register = useCallback((id: string, entry: FlowEntry) => {
    setEntries((current) => new Map(current).set(id, entry));
  }, []);
  const unregister = useCallback((id: string) => {
    setEntries((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo<FlowRegistry>(() => ({
    entries,
    register,
    unregister,
  }), [entries, register, unregister]);

  return <FlowScreenContext.Provider value={value}>{children}</FlowScreenContext.Provider>;
}

/**
 * Substituto navegável para o Modal nativo. O conteúdo continua pertencendo à
 * tela de origem (e preserva suas regras), mas passa a ser exibido em uma rota
 * própria, com histórico e botão Voltar do sistema.
 */
export default function FinFlowScreen({
  visible = true,
  children,
  onRequestClose,
}: {
  visible?: boolean;
  children?: ReactNode;
  onRequestClose?: () => void;
  animationType?: ModalProps["animationType"];
  transparent?: boolean;
  statusBarTranslucent?: boolean;
  presentationStyle?: ModalProps["presentationStyle"];
}) {
  const registry = useContext(FlowScreenContext);
  const register = registry?.register;
  const unregister = registry?.unregister;
  const router = useRouter();
  const idRef = useRef(`flow-${++nextFlowId}`);
  const openedRef = useRef(false);
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;

  useEffect(() => {
    if (!register || !unregister) return;
    const id = idRef.current;

    if (visible) {
      register(id, { content: children, onRequestClose: () => closeRef.current?.() });
      if (!openedRef.current) {
        openedRef.current = true;
        router.push({ pathname: "/flow-screen", params: { id } });
      }
      return;
    }

    unregister(id);
    openedRef.current = false;
  }, [children, register, router, unregister, visible]);

  useEffect(() => () => {
    unregister?.(idRef.current);
  }, [unregister]);

  return null;
}

export function FinFlowScreenPage() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const registry = useContext(FlowScreenContext);
  const router = useRouter();
  const { dark: isDark } = useTheme();
  const theme = finFlowTheme(isDark);
  const entry = id ? registry?.entries.get(id) : undefined;
  const lastEntryRef = useRef<FlowEntry | undefined>(entry);
  if (entry) lastEntryRef.current = entry;

  useEffect(() => {
    if (!id || !registry || entry) return;
    const timeout = setTimeout(() => router.back(), 80);
    return () => clearTimeout(timeout);
  }, [entry, id, registry, router]);

  useEffect(() => () => {
    lastEntryRef.current?.onRequestClose?.();
  }, []);

  const pageContent = expandContentToPage(entry?.content, theme.background);

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.page, { backgroundColor: theme.background }]}
    >
      <View style={styles.content}>{pageContent}</View>
    </SafeAreaView>
  );
}

function expandContentToPage(content: ReactNode, backgroundColor: string): ReactNode {
  if (!isValidElement(content)) return content;
  if (content.type === Fragment) {
    return Children.map((content.props as { children?: ReactNode }).children, (child) => (
      expandContentToPage(child, backgroundColor)
    ));
  }

  const root = content as ReactElement<{ style?: unknown; children?: ReactNode }>;
  let expandedPanel = false;
  const children = Children.map(root.props.children, (child) => {
    if (expandedPanel || !isValidElement(child) || child.type === Fragment) return child;
    expandedPanel = true;
    const panel = child as ReactElement<{ style?: unknown; children?: ReactNode }>;
    const panelChildren = hideLegacyDragHandle(panel.props.children);
    return cloneElement(panel, { style: [panel.props.style, styles.pagePanel], children: panelChildren });
  });

  return cloneElement(root, {
    style: [root.props.style, styles.pageCanvas, { backgroundColor }],
    children,
  });
}

function hideLegacyDragHandle(children: ReactNode): ReactNode {
  let firstElementChecked = false;
  return Children.map(children, (child) => {
    if (firstElementChecked || !isValidElement(child)) return child;
    firstElementChecked = true;
    const element = child as ReactElement<{ style?: unknown }>;
    const flattened = (StyleSheet.flatten(element.props.style) ?? {}) as {
      width?: number | string;
      height?: number | string;
    };
    const width = typeof flattened.width === "number" ? flattened.width : Number.POSITIVE_INFINITY;
    const height = typeof flattened.height === "number" ? flattened.height : Number.POSITIVE_INFINITY;
    if (width <= 80 && height <= 8) {
      return cloneElement(element, { style: [element.props.style, styles.hidden] });
    }
    return child;
  });
}

const styles = StyleSheet.create({
  page: { flex: 1, width: "100%", height: "100%" },
  content: { flex: 1, width: "100%", height: "100%" },
  hidden: { display: "none" },
  pageCanvas: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: "100%",
    padding: 0,
    margin: 0,
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  pagePanel: {
    flex: 1,
    width: "100%",
    height: "100%",
    minHeight: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    margin: 0,
    borderWidth: 0,
    borderRadius: 0,
  },
});
