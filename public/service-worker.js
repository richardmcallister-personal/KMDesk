/* Deputy CEO Desk — app-shell service worker.
   Cache-first for the shell so the app opens on a plane. Bump CACHE on every
   deploy: the old cache is deleted on activate and clients reload once. */

var CACHE = "km-desk-v3";

var DESK = "./data/desk.json";

var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./fonts/murphy-sans-300.ttf",
  "./fonts/murphy-sans-500.ttf",
  "./img/wordmark-ink.png",
  "./img/wordmark-light.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a redeploy is picked up, fall back to the
  // cached shell when there is no signal.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  // The desk: network first so each rebuild shows up on the next open, with
  // the last good copy kept for when there is no signal.
  if (url.pathname.endsWith("/data/desk.json")) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(DESK, copy); });
          return res;
        }
        return caches.match(DESK).then(function (hit) { return hit || res; });
      }).catch(function () {
        return caches.match(DESK).then(function (hit) {
          if (hit) return hit;
          throw new Error("offline and no saved copy of the desk");
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* Push is wired but inert until a server sends to it — see README, "Push". */
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Deputy CEO Desk", {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: d.tag || "desk",
    data: { url: d.url || "./index.html" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "./index.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
