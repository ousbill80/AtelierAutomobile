/* global self, caches, fetch, URL, Response */
// M06 §13 — service worker de la PWA tablette : l'application (/tablette/*) et ses ressources
// statiques restent disponibles hors-ligne. Les données passent par IndexedDB (file
// d'opérations) ; les appels /api ne sont jamais mis en cache.
const CACHE = "atelieros-tablette-v1";
const SHELL = ["/tablette", "/tablette/taches"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Ressources statiques immuables : cache d'abord.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages de la tablette : réseau d'abord, cache en secours (hors-ligne).
  if (request.mode === "navigate" && url.pathname.startsWith("/tablette")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match("/tablette/taches"))
            .then((hit) => hit || Response.error()),
        ),
    );
  }
});
