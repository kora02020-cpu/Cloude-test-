"use strict";
// コツコツ印帳 Service Worker: オフライン対応とリマインダー通知
const VERSION = "kotsukotsu-v2";
const SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png",
];
const STATUS_CACHE = "kotsukotsu-status";
const STATUS_URL = "./__status.json";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== STATUS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: 古いキャッシュを即返しつつ裏で更新
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // 画面遷移はネット優先（更新をすぐ反映）、失敗したらキャッシュ
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      caches.open(VERSION).then((c) => c.put("./index.html", res.clone()));
      return res;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  // それ以外はキャッシュ優先
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});

// アプリ側が書き込む「今日の状態」を読む
async function readStatus() {
  try {
    const c = await caches.open(STATUS_CACHE);
    const res = await c.match(STATUS_URL);
    return res ? await res.json() : null;
  } catch (e) { return null; }
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function maybeRemind() {
  const s = await readStatus();
  if (!s || !s.notify) return;
  const now = new Date();
  const today = ymd(now);
  if (s.lastCheckin === today || s.lastNotified === today) return;
  const [h, m] = (s.time || "07:30").split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  const title = s.streak > 0 ? `${s.streak}日連続を守ろう` : "今日の印を押しましょう";
  await self.registration.showNotification(title, {
    body: `${s.anchor}、${s.amountText}を貯金する`,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "daily-reminder",
    data: { url: "./index.html?action=checkin" },
    actions: [{ action: "checkin", title: "貯金した" }],
  });
  s.lastNotified = today;
  const c = await caches.open(STATUS_CACHE);
  await c.put(STATUS_URL, new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }));
}

// Android の Chrome でインストール済みの場合に、ブラウザが適当な間隔で起こしてくれる
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "daily-reminder") e.waitUntil(maybeRemind());
});
// アプリから「今チェックして」と頼まれたとき
self.addEventListener("message", (e) => {
  if (e.data === "check-reminder") e.waitUntil(maybeRemind());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./index.html", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) { c.navigate(target); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
