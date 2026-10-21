self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((window) => window.visibilityState === "visible")) return;
    const message = event.data?.json() || {};
    await self.registration.showNotification("새 메시지", {
      body: String(message.body || "새 메시지가 도착했습니다."),
      icon: new URL("icon.svg", self.registration.scope).href,
      tag: `duo-message-${message.id || Date.now()}`,
      data: { url: self.registration.scope },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows[0]) return windows[0].focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
