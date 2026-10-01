import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  Keyboard,
  Platform,
  TextInput,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type View,
} from "react-native";

const EVENTO_MOSTRAR = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const EVENTO_ESCONDER = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/**
 * Quantos pixels do contêiner o teclado cobre, medidos na janela.
 *
 * O Android do app roda em modo edge-to-edge (padrão do Expo SDK 54): a
 * janela não encolhe quando o teclado abre. O KeyboardAvoidingView mede a
 * própria posição relativa ao pai e erra a conta quando há área segura,
 * cabeçalho ou modal acima dele, por isso campos ficavam cobertos só em alguns
 * aparelhos. Aqui a medida usa measureInWindow e o topo real do teclado; em
 * aparelhos em que a janela encolhe, a sobreposição medida é zero e nada muda.
 * Use o valor como paddingBottom do próprio contêiner medido.
 */
export function useSobreposicaoTeclado(ref: RefObject<View | null>, ativo = true): number {
  const [sobreposicao, setSobreposicao] = useState(0);

  useEffect(() => {
    if (!ativo) {
      setSobreposicao(0);
      return;
    }
    let quadro = 0;
    const mostrar = (evento: KeyboardEvent) => {
      const topoTeclado = evento.endCoordinates.screenY;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        ref.current?.measureInWindow((_x, y, _largura, altura) => {
          setSobreposicao(Math.max(0, Math.round(y + altura - topoTeclado)));
        });
      });
    };
    const esconder = () => {
      cancelAnimationFrame(quadro);
      setSobreposicao(0);
    };
    const inscricaoMostrar = Keyboard.addListener(EVENTO_MOSTRAR, mostrar);
    const inscricaoEsconder = Keyboard.addListener(EVENTO_ESCONDER, esconder);
    return () => {
      cancelAnimationFrame(quadro);
      inscricaoMostrar.remove();
      inscricaoEsconder.remove();
    };
  }, [ref, ativo]);

  return sobreposicao;
}

/**
 * Mantém o campo focado acima do teclado dentro de um ScrollView.
 *
 * Quando o teclado abre, ou quando outro campo recebe foco com ele aberto
 * (chame `garantirVisivel` no onFocus), mede o campo na janela e rola só o
 * necessário. Passe `onScroll` ao ScrollView para acompanhar a posição atual.
 */
export function useCampoFocadoVisivel(
  scrollRef: RefObject<ScrollView | null>,
  { margem = 24, ativo = true }: { margem?: number; ativo?: boolean } = {},
) {
  const deslocamento = useRef(0);
  const topoTeclado = useRef<number | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const garantirVisivel = useCallback((atraso = 90) => {
    if (espera.current) clearTimeout(espera.current);
    // Espera o layout aplicar o espaço do teclado antes de medir.
    espera.current = setTimeout(() => {
      const topo = topoTeclado.current;
      const campo = TextInput.State.currentlyFocusedInput?.() as View | null | undefined;
      if (topo == null || !campo?.measureInWindow) return;
      campo.measureInWindow((_x, y, _largura, altura) => {
        const excesso = y + altura + margem - topo;
        if (excesso > 0) {
          scrollRef.current?.scrollTo({ y: deslocamento.current + excesso, animated: true });
        }
      });
    }, atraso);
  }, [margem, scrollRef]);

  useEffect(() => {
    if (!ativo) return;
    const inscricaoMostrar = Keyboard.addListener(EVENTO_MOSTRAR, (evento) => {
      topoTeclado.current = evento.endCoordinates.screenY;
      garantirVisivel();
    });
    const inscricaoEsconder = Keyboard.addListener(EVENTO_ESCONDER, () => {
      topoTeclado.current = null;
    });
    return () => {
      if (espera.current) clearTimeout(espera.current);
      inscricaoMostrar.remove();
      inscricaoEsconder.remove();
    };
  }, [ativo, garantirVisivel]);

  const onScroll = useCallback((evento: NativeSyntheticEvent<NativeScrollEvent>) => {
    deslocamento.current = evento.nativeEvent.contentOffset.y;
  }, []);

  return { onScroll, garantirVisivel };
}
