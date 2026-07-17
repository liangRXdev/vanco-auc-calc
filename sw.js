/* vanco-auc-calc Service Worker
 * 快取完整 app shell（HTML/CSS/JS/圖示），計算器可完全離線使用。
 * Google Fonts 為跨源，不攔截；離線時自動退回系統字型，計算功能不受影響。
 * 版本更新：改動 shell 檔案後，將 CACHE 版本號 +1 以汰換舊快取。
 */
const CACHE = 'vanco-auc-calc-v6';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/constants.js',
  'js/pk.js',
  'js/bayes.js',
  'js/safety.js',
  'js/ui.js',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只處理同源；Google Fonts 等跨源交給瀏覽器直接連網（離線退回系統字型）
  if (url.origin !== self.location.origin) return;

  // 導覽（入口頁）：stale-while-revalidate（離線可開、上線即更新）
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 其餘同源靜態資源（CSS/JS/圖示/manifest）：cache-first，背景補網
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}
