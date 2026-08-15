const STATIC_CACHE = "finflow-static-v3";
const STATIC_PATHS = ["/manifest.webmanifest", "/icon.png", "/apple-icon.png"];
const NOTIFICATION_PATHS = new Set([
  "/", "/transacoes", "/objetivos", "/cartoes", "/relatorios",
  "/assistente", "/configuracoes", "/contas", "/categorias", "/planos",
]);

function safeNotificationRoute(value) {
  try {
    const url = new URL(String(value || "/"), self.location.origin);
    if (url.origin === self.location.origin && NOTIFICATION_PATHS.has(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch { /* usa a rota segura padrao */ }
  return "/";
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_PATHS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Dados financeiros e HTML autenticado nunca vão para Cache Storage.
  if (!url.pathname.startsWith("/_next/static/") && !STATIC_PATHS.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});

self.addEventListener("push", (event) => {
  let payload = { title: "FinFlow", body: "Você tem uma nova atualização financeira.", route: "/" };
  try { payload = { ...payload, ...(event.data ? event.data.json() : {}) }; } catch { /* payload seguro padrão */ }
  event.waitUntil(self.registration.showNotification(String(payload.title).slice(0, 80), {
    body: String(payload.body).slice(0, 240), icon: "/icon.png", badge: "/icon.png", tag: "finflow-web", data: { route: String(payload.route || "/") },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = safeNotificationRoute(event.notification.data?.route);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) { existing.navigate(route); return existing.focus(); }
    return self.clients.openWindow(route);
  }));
});
