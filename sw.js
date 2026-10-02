/* sw.js — Tic-Tac-Logic service worker.
 * Cache-first app shell. Bump CACHE_NAME on every deploy so clients update.
 */
const CACHE_NAME = "tictaclogic-v3";

const SHELL = [
  ".",
  "index.html",
  "style.css",
  "board.js",
  "solver.js",
  "generator.js",
  "ui.js",
  "manifest.json",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    // cache: "reload" bypasses the browser's HTTP cache, so a new version
    // never gets seeded with stale copies of the previous deploy's files
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin app shell: cache-first, fall back to network then index.html.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return resp;
        }).catch(() => caches.match("index.html"))
      )
    );
    return;
  }

  // Google Fonts (CSS + font files): cache at runtime so the app keeps its
  // typefaces offline — the spec forbids falling back to a system stack.
  if (url.host.indexOf("fonts.googleapis.com") !== -1 || url.host.indexOf("fonts.gstatic.com") !== -1) {
    e.respondWith(
      caches.open(CACHE_NAME).then((c) =>
        c.match(req).then((cached) => {
          const net = fetch(req).then((resp) => { c.put(req, resp.clone()); return resp; }).catch(() => cached);
          return cached || net;
        })
      )
    );
  }
});
