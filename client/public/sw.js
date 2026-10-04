const CACHE_NAME = "jawharat-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (event.request.method !== "GET" || url.includes("/api/") || url.includes("onrender.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
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
