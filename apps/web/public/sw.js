// Minimal service worker: app-shell offline fallback + Web Push display.
// Static pages are server-rendered per user, so we cache only the shell.
const CACHE = "pgrow-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/offline")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match("/offline")),
  );
});

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Subscription rotation recovery. Re-subscribes with the current session and
 * saves the new endpoint through the existing authenticated endpoint.
 * Fail-safe: any failure (logged out, no org context, no network, server
 * rejection) removes the orphaned local subscription and defers recovery
 * until the user next opens the CRM. Binding always derives server-side
 * from the session — never rebound across users here. No pages, API data,
 * or sessions are cached by this handler.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch("/api/push/public-key");
        if (!keyRes.ok) return;
        const { key } = await keyRes.json();
        if (!key) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
        });
        if (!res.ok) await sub.unsubscribe().catch(() => undefined);
      } catch {
        // Offline or logged out: leave recovery to the next CRM visit.
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Phenomenal Grow", body: "", link: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", data: { link: data.link } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(self.clients.openWindow(link));
});
