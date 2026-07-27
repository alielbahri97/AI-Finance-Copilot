/**
 * FinPilot service worker: receives Web Push messages and shows them as
 * system notifications. Clicking a notification focuses (or opens) the app
 * at the deep link carried in the payload.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = { title: "FinPilot", body: "", link: "/dashboard" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { link: payload.link },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(link);
          return;
        }
      }
      return clients.openWindow(link);
    })
  );
});
