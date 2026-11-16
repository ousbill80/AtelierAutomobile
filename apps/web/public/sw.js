/* global self, caches, fetch, URL, Response */
// Service worker d'AtelierOS (PWA) :
// - M06 §13 : la tablette d'atelier (/tablette/*) et ses ressources statiques restent
//   disponibles hors-ligne (les données passent par IndexedDB ; /api jamais mis en cache) ;
// - application installable : page « hors-ligne » quand le réseau manque ;
// - notifications push (Web Push) : affichage, puis ouverture de la bonne page au toucher.
const CACHE = "atelieros-v3";
const OFFLINE_URL = "/offline.html";
const SHELL = [
  "/tablette",
  "/tablette/taches",
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/badge-72.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // Chaque ressource séparément : une page indisponible n'empêche pas l'installation.
        Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
      )
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

  // Fichiers au nom hashé (cache-control immutable) : cache d'abord, pour le hors-ligne.
  // En développement les chunks gardent le même nom et sont en no-cache : on les recharge.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const cachedControl = hit?.headers.get("cache-control") ?? "";
        if (hit && (cachedControl.includes("immutable") || url.pathname.startsWith("/icons/"))) {
          return hit;
        }
        return fetch(request)
          .then((response) => {
            const control = response.headers.get("cache-control") ?? "";
            if (
              response.ok &&
              (control.includes("immutable") || url.pathname.startsWith("/icons/"))
            ) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => hit || Response.error());
      }),
    );
    return;
  }

  if (request.mode !== "navigate") return;

  // Pages de la tablette : réseau d'abord, cache en secours (travail hors-ligne).
  if (url.pathname.startsWith("/tablette")) {
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
            .then((hit) => hit || caches.match(OFFLINE_URL))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Autres pages : toujours le réseau (données à jour) ; sans réseau, la page hors-ligne.
  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit || Response.error())),
  );
});

// ----- Notifications push -----

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "AtelierOS", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "AtelierOS";
  // Aligné sur safeInternalLink (core/notifications/push) : chemin relatif same-origin
  // uniquement — rejette les protocol-relative `//host` qui ouvriraient un domaine externe.
  const rawLink = typeof data.link === "string" ? data.link : "";
  const link = rawLink.startsWith("/") && !rawLink.startsWith("//") ? rawLink : "/notifications";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || undefined,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        tag: data.tag || undefined,
        lang: "fr",
        data: { link },
      }),
      // Application ouverte : la cloche se met à jour sans attendre.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windows) =>
          windows.forEach((w) => w.postMessage({ type: "notification:received" })),
        ),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.link) || "/notifications";
  const candidate =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
      ? raw
      : "/notifications";
  const targetUrl = new URL(candidate, self.location.origin);
  // Ceinture : n'ouvrir que des URLs same-origin (défense si data.link a été altéré).
  const target =
    targetUrl.origin === self.location.origin
      ? targetUrl.href
      : new URL("/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w
            .focus()
            .then((focused) =>
              focused && "navigate" in focused ? focused.navigate(target) : focused,
            );
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// Abonnement renouvelé par le navigateur : la page le réenregistrera à la prochaine ouverture.
self.addEventListener("pushsubscriptionchange", () => {
  self.clients
    .matchAll({ type: "window" })
    .then((windows) => windows.forEach((w) => w.postMessage({ type: "push:resubscribe" })));
});
