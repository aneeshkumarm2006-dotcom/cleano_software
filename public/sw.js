/*
 * Cleano service worker.
 *
 * Chrome will not treat a site as installable — and therefore never fires
 * `beforeinstallprompt` — unless a service worker with a fetch handler is
 * registered. Without this file, "Add to Home screen" only produced a
 * bookmark that opened inside Chrome's UI instead of a standalone app.
 *
 * Deliberately conservative: this is an authenticated business app, so we do
 * NOT cache app HTML or API responses (stale jobs/pay data would be worse than
 * an error). Navigations go to the network first and only fall back to a
 * bundled offline page when the device is genuinely offline.
 */

const CACHE = "cleano-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).catch(() => {})
  );
  // Take over as soon as possible so a new deploy isn't stuck behind an old SW.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Never interfere with non-GET (auth posts, server actions) or cross-origin.
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Only page navigations get the offline fallback. Everything else (JS, CSS,
  // images, API) passes straight through to the network untouched.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ||
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })()
    );
  }
});
