// JobFinder push service worker. Plain script with no imports, so it needs no
// build step. It shows the notifications sent by the scanner through Firebase
// Cloud Messaging and opens the dashboard when one is tapped. It caches
// nothing and never sees the space key.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only ever open pages of this dashboard, whatever the message says. */
function dashboardUrl(link) {
  const home = self.location.origin + "/";
  try {
    const url = new URL(typeof link === "string" && link ? link : "/", home);
    return url.origin === self.location.origin ? url.href : home;
  } catch {
    return home;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall through and show a generic notification.
  }
  // The scanner sends the text in "data"; "notification" is the fallback.
  const data = payload.data || {};
  const note = payload.notification || {};
  const title = String(data.title || note.title || "JobFinder").slice(0, 200);
  const tag = String(data.tag || note.tag || "");
  const link = data.link || (payload.fcmOptions && payload.fcmOptions.link) || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || note.body || "").slice(0, 500),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: tag || undefined,
      renotify: tag !== "",
      requireInteraction: data.requireInteraction === "1" || note.requireInteraction === true,
      data: { url: dashboardUrl(link) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = dashboardUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        try {
          await w.navigate(url);
        } catch {
          // A tab this worker does not control cannot be navigated; focus it anyway.
        }
        return w.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
