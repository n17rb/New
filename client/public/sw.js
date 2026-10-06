const CACHE_NAME = "jawharat-v4";
const FONT_CACHE = "jawharat-fonts-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/manifest.json", "/icon.svg"])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== FONT_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// الصفحة الرئيسية: من الإنترنت لو وصل خلال ٣ ثواني، وإلا من النسخة المحفوظة (فتح فوري)
async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    if (response && response.ok) cache.put("/", response.clone());
    return response;
  } catch {
    const cached = (await cache.match("/")) || (await cache.match(request));
    if (cached) {
      // نحدّث النسخة المحفوظة بالخلفية للمرة الجاية
      fetch(request).then((r) => { if (r && r.ok) cache.put("/", r); }).catch(() => {});
      return cached;
    }
    return fetch(request);
  }
}

// ملفات التطبيق (اسمها بيتغير مع كل تحديث) — من الجهاز مباشرة
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // الخطوط من جوجل
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // أي شي من موقع ثاني (السيرفر/API، الخرائط...) بيروح للإنترنت مباشرة
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// إشعار جاي من السيرفر — بيطلع حتى لو التطبيق مسكّر
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "جوهرة الرابية";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "عندك إشعار جديد",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag,
      dir: "rtl",
      lang: "ar",
      vibrate: [200, 100, 200],
      requireInteraction: false,
      data: { url: data.url || "/notifications" },
    })
  );
});

// الضغط على إشعار الجهاز بيفتح التطبيق على صفحة الإشعارات
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate?.(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
