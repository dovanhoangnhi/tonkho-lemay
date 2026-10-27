// Cache khung ứng dụng để mở được khi mạng yếu. Ưu tiên bản mới từ mạng, lỗi thì dùng cache.
const CACHE = 'tonkho-lemay-v6';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'nguon-du-lieu.js', 'logo-data.js', 'manifest.json',
  'nguon-m365.js', 'm365/', 'm365/index.html', 'm365/config.js', 'm365/manifest.json',
  'vendor/xlsx.full.min.js', 'vendor/msal-browser.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/lotus.png', 'icons/logo-wide.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // no-cache: luôn hỏi lại máy chủ để nhận bản app mới ngay khi có cập nhật
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
