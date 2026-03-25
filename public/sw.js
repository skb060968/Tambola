/* ==============================
   Tambola PWA Service Worker
   - Network-first for HTML/JS/CSS (Vite hashes these)
   - Cache-first for static assets (images, sounds, icons)
   - Update detection + prompt support
   ============================== */

const CACHE_NAME = "tambola-v3";

// Pre-cache truly static assets (not Vite-hashed JS/CSS)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/images/wood.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/sounds/draw.mp3",
  "/sounds/mark.mp3",
  "/sounds/win.mp3",
  "/sounds/error.mp3",
  "/sounds/claim.mp3",
];

/* ==============================
   Install
   ============================== */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  // Do NOT call skipWaiting — let the page control when to activate
});

/* ==============================
   Activate
   ============================== */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* ==============================
   Fetch — hybrid strategy
   ============================== */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Network-first for HTML, JS, CSS (Vite hashes these, so cache-first would serve stale code)
  if (
    event.request.mode === "navigate" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.startsWith("/assets/")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match("/index.html")),
        ),
    );
    return;
  }

  // Cache-first for static assets (images, sounds, icons, manifest)
  event.respondWith(
    caches
      .match(event.request)
      .then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone));
            return response;
          }),
      )
      .catch(() => caches.match("/index.html")),
  );
});

/* ==============================
   Listen for SKIP_WAITING message
   ============================== */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
