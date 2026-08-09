const LOCAL_DEMO_FLAG = process.env.EXPO_PUBLIC_FINFLOW_LOCAL_DEMO === "true";
const INSTALLATION_KEY = "__FINFLOW_LOCAL_DEMO_NETWORK_GUARD__";

type GuardState = {
  installed: true;
  originalFetch?: typeof globalThis.fetch;
  originalXhrOpen?: typeof XMLHttpRequest.prototype.open;
  originalWebSocket?: typeof WebSocket;
  originalEventSource?: typeof EventSource;
  originalSendBeacon?: typeof navigator.sendBeacon;
  originalWindowOpen?: typeof window.open;
  clickHandler?: (event: MouseEvent) => void;
};

type GuardedGlobal = typeof globalThis & {
  [INSTALLATION_KEY]?: GuardState;
};

function guardedGlobal(): GuardedGlobal {
  return globalThis as GuardedGlobal;
}

function currentOrigin(): string | null {
  return typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : null;
}

function resolveUrl(value: string | URL): URL | null {
  try {
    return new URL(String(value), currentOrigin() ?? "http://localhost");
  } catch {
    return null;
  }
}

export function localDemoAllowsUrl(value: string | URL): boolean {
  const url = resolveUrl(value);
  if (!url) return false;
  if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
  const origin = currentOrigin();
  if (origin && url.origin === origin) return true;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "0.0.0.0";
}

function assertLocalUrl(value: string | URL, channel: string): void {
  if (localDemoAllowsUrl(value)) return;
  const resolved = resolveUrl(value)?.origin ?? "destino inválido";
  throw new Error(`FINFLOW_LOCAL_DEMO_BLOCKED_NETWORK:${channel}:${resolved}`);
}

function requestUrl(input: RequestInfo | URL): string | URL {
  if (typeof input === "string" || input instanceof URL) return input;
  return input.url;
}

/**
 * Bloqueia, no browser, todos os canais de rede usados pelo app fora do
 * loopback. É uma segunda barreira: o modo demo também não instancia o cliente
 * Supabase real e usa somente dados em memória.
 */
export function installLocalDemoNetworkGuard(): boolean {
  if (!LOCAL_DEMO_FLAG || typeof window === "undefined") return false;
  const root = guardedGlobal();
  if (root[INSTALLATION_KEY]?.installed) return true;

  const state: GuardState = { installed: true };

  if (typeof globalThis.fetch === "function") {
    state.originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      assertLocalUrl(requestUrl(input), "fetch");
      return state.originalFetch!(input, init);
    }) as typeof globalThis.fetch;
  }

  if (typeof XMLHttpRequest !== "undefined") {
    state.originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function guardedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      assertLocalUrl(url, "xhr");
      Reflect.apply(state.originalXhrOpen!, this, [
        method,
        String(url),
        async ?? true,
        username ?? null,
        password ?? null,
      ]);
    } as typeof XMLHttpRequest.prototype.open;
  }

  if (typeof WebSocket !== "undefined") {
    state.originalWebSocket = WebSocket;
    const Original = WebSocket;
    const GuardedWebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        assertLocalUrl(url, "websocket");
        super(url, protocols);
      }
    };
    globalThis.WebSocket = GuardedWebSocket as typeof WebSocket;
  }

  if (typeof EventSource !== "undefined") {
    state.originalEventSource = EventSource;
    const Original = EventSource;
    const GuardedEventSource = class extends Original {
      constructor(url: string | URL, options?: EventSourceInit) {
        assertLocalUrl(url, "eventsource");
        super(url, options);
      }
    };
    globalThis.EventSource = GuardedEventSource as typeof EventSource;
  }

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    state.originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      assertLocalUrl(url, "beacon");
      return state.originalSendBeacon!(url, data);
    }) as typeof navigator.sendBeacon;
  }

  if (typeof window.open === "function") {
    state.originalWindowOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (url && !localDemoAllowsUrl(url)) {
        console.warn("Modo local: link externo bloqueado.");
        return null;
      }
      return state.originalWindowOpen!(url, target, features);
    }) as typeof window.open;
  }

  state.clickHandler = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || localDemoAllowsUrl(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    console.warn("Modo local: navegação externa bloqueada.");
  };
  document.addEventListener("click", state.clickHandler, true);

  root[INSTALLATION_KEY] = state;
  return true;
}

export function localDemoNetworkGuardInstalled(): boolean {
  return guardedGlobal()[INSTALLATION_KEY]?.installed === true;
}
