const CACHE = "kage-v2";
const MAX = 220;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const p = new URL(req.url).pathname;
  if (!p.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);

      const net = fetch(req)
        .then(async (res) => {
          if (res.ok) {
            cache.put(req, res.clone());
            const keys = await cache.keys();
            if (keys.length > MAX) {
              for (const k of keys.slice(0, keys.length - MAX)) await cache.delete(k);
            }
          }
          return res;
        })
        .catch(() => hit);

      return hit || net;
    })()
  );
});