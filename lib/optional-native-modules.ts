/**
 * A versao 2.0 original do APK nao possui todos os modulos nativos que foram
 * adicionados depois. Estes carregadores mantem o mesmo bundle OTA executavel
 * nesse binario antigo: quando o modulo existe usamos a implementacao nativa;
 * quando nao existe, a funcionalidade chamadora aplica um fallback seguro.
 *
 * Os `require` precisam permanecer literais para o Metro incluir o JavaScript
 * dos pacotes no bundle, mas ficam dentro de `try/catch` para que a ausencia da
 * contraparte nativa nunca derrube a inicializacao do aplicativo.
 */

import { runtimeVersion } from "expo-updates";
import { Platform } from "react-native";

/**
 * O primeiro binario 2.0 usa React Native Bridgeless. Nesse ambiente, tentar
 * resolver um pacote nativo ausente pode disparar uma excecao fatal do host
 * antes que o `try/catch` JavaScript consiga intercepta-la. Portanto, nesse
 * runtime nao basta tratar a falha: nenhum dos pacotes novos pode ser
 * solicitado ao Metro.
 */
const IS_LEGACY_NATIVE_RUNTIME =
  (Platform.OS === "android" || Platform.OS === "ios")
  && runtimeVersion === "2.0.0";

export type OptionalSecureStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: { keychainAccessible?: unknown }): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: unknown;
};

export type OptionalNetInfoState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

export type OptionalNetInfo = {
  fetch(): Promise<OptionalNetInfoState>;
  addEventListener(listener: (state: OptionalNetInfoState) => void): () => void;
};

export type OptionalScreenCapture = {
  preventScreenCaptureAsync(key?: string): Promise<void>;
  allowScreenCaptureAsync(key?: string): Promise<void>;
  enableAppSwitcherProtectionAsync(opacity?: number): Promise<void>;
  disableAppSwitcherProtectionAsync(): Promise<void>;
};

export type OptionalExpoCrypto = {
  randomUUID(): string;
  digestStringAsync(
    algorithm: unknown,
    value: string,
  ): Promise<string>;
  CryptoDigestAlgorithm?: { SHA256?: unknown };
};

let secureStoreResolved = false;
let secureStoreModule: OptionalSecureStore | null = null;

export function getOptionalSecureStore(): OptionalSecureStore | null {
  if (secureStoreResolved) return secureStoreModule;
  secureStoreResolved = true;
  if (IS_LEGACY_NATIVE_RUNTIME) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const candidate = require("expo-secure-store") as Partial<OptionalSecureStore>;
    if (
      typeof candidate.getItemAsync === "function"
      && typeof candidate.setItemAsync === "function"
      && typeof candidate.deleteItemAsync === "function"
    ) {
      secureStoreModule = candidate as OptionalSecureStore;
    }
  } catch {
    secureStoreModule = null;
  }
  return secureStoreModule;
}

let netInfoResolved = false;
let netInfoModule: OptionalNetInfo | null = null;

export function getOptionalNetInfo(): OptionalNetInfo | null {
  if (netInfoResolved) return netInfoModule;
  netInfoResolved = true;
  if (IS_LEGACY_NATIVE_RUNTIME) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require("@react-native-community/netinfo") as {
      default?: Partial<OptionalNetInfo>;
    } & Partial<OptionalNetInfo>;
    const candidate = loaded.default ?? loaded;
    if (
      typeof candidate.fetch === "function"
      && typeof candidate.addEventListener === "function"
    ) {
      netInfoModule = candidate as OptionalNetInfo;
    }
  } catch {
    netInfoModule = null;
  }
  return netInfoModule;
}

let screenCaptureResolved = false;
let screenCaptureModule: OptionalScreenCapture | null = null;

export function getOptionalScreenCapture(): OptionalScreenCapture | null {
  if (screenCaptureResolved) return screenCaptureModule;
  screenCaptureResolved = true;
  if (IS_LEGACY_NATIVE_RUNTIME) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const candidate = require("expo-screen-capture") as Partial<OptionalScreenCapture>;
    if (
      typeof candidate.preventScreenCaptureAsync === "function"
      && typeof candidate.allowScreenCaptureAsync === "function"
    ) {
      screenCaptureModule = candidate as OptionalScreenCapture;
    }
  } catch {
    screenCaptureModule = null;
  }
  return screenCaptureModule;
}

let expoCryptoResolved = false;
let expoCryptoModule: OptionalExpoCrypto | null = null;

export function getOptionalExpoCrypto(): OptionalExpoCrypto | null {
  if (expoCryptoResolved) return expoCryptoModule;
  expoCryptoResolved = true;
  if (IS_LEGACY_NATIVE_RUNTIME) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const candidate = require("expo-crypto") as Partial<OptionalExpoCrypto>;
    if (typeof candidate.randomUUID === "function") {
      expoCryptoModule = candidate as OptionalExpoCrypto;
    }
  } catch {
    expoCryptoModule = null;
  }
  return expoCryptoModule;
}

let fallbackUuidCounter = 0;

/** UUID para idempotencia, nao para autenticacao ou geracao de segredo. */
export function randomUuidCompat(): string {
  const nativeCrypto = getOptionalExpoCrypto();
  try {
    if (nativeCrypto) return nativeCrypto.randomUUID();
  } catch {
    // Continua no gerador disponivel no runtime JavaScript.
  }

  const availableCrypto = (globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string; getRandomValues?: (values: Uint8Array) => Uint8Array };
  }).crypto;
  try {
    if (typeof availableCrypto?.randomUUID === "function") return availableCrypto.randomUUID();
  } catch {
    // Alguns runtimes antigos expoem a API parcialmente.
  }

  const bytes = new Uint8Array(16);
  try {
    if (typeof availableCrypto?.getRandomValues === "function") {
      availableCrypto.getRandomValues(bytes);
    } else {
      throw new Error("secure-random-unavailable");
    }
  } catch {
    // Unicidade e o requisito deste identificador: tempo, contador e entropia
    // local evitam colisao mesmo no APK antigo sem expo-crypto.
    fallbackUuidCounter = (fallbackUuidCounter + 1) >>> 0;
    const seed = `${Date.now()}:${fallbackUuidCounter}:${Math.random()}:${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      const code = seed.charCodeAt(index % seed.length);
      bytes[index] = (code + (index * 37) + fallbackUuidCounter) & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function fallbackDigest(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map((initial, seedIndex) => {
    let hash = initial >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + seedIndex;
      hash = Math.imul(hash, 0x01000193);
      hash ^= hash >>> 13;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("");
}

/** Hash usado apenas para deduplicar agendas locais de notificacao. */
export async function digestForLocalDeduplication(value: string): Promise<string> {
  const nativeCrypto = getOptionalExpoCrypto();
  try {
    const sha256 = nativeCrypto?.CryptoDigestAlgorithm?.SHA256;
    if (nativeCrypto && sha256 !== undefined && typeof nativeCrypto.digestStringAsync === "function") {
      return await nativeCrypto.digestStringAsync(sha256, value);
    }
  } catch {
    // A assinatura local pode usar o fallback deterministico abaixo.
  }
  return fallbackDigest(value);
}
