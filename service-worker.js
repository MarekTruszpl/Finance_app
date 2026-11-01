// service-worker.js — хранит копию файлов приложения на устройстве, чтобы оно открывалось без интернета.
// Данные пользователя здесь не участвуют: они лежат в IndexedDB и обновление кода их не затрагивает.
//
// Как обновляются файлы: когда есть интернет, всегда берём свежую версию с сервера (и сохраняем её),
// а без интернета (или если сервер недоступен) открываем сохранённую. Поэтому после загрузки новой
// версии на хостинг достаточно открыть приложение с интернетом (иногда с перезапуском) — и оно обновится.
//
// VERSION менять нужно, только если вы удалили или переименовали файлы: старый кэш тогда очистится.
// Новые файлы приложения обязательно добавляйте в APP_FILES, иначе без интернета они не откроются.

const VERSION = 'v3';
const CACHE = `finance-app-${VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ui.js',
  './logic.js',
  './storage.js',
  './defaults.js',
  './importer.js',
  './stats.js',
  './stats-view.js',
  './charts.js',
  './format.js',
  './history-view.js',
  './libs/dexie.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' — не брать устаревшие копии из HTTP-кэша браузера
    await cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('finance-app-') && key !== CACHE) await caches.delete(key); // старые версии кэша
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // чужие адреса не трогаем
  event.respondWith(networkFirst(request));
});

// Сначала сервер; если его нет или он ответил ошибкой (например, 404) — сохранённая копия
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request.url, { cache: 'no-cache' }));
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    const saved = await cache.match(request, { ignoreSearch: true });
    return saved ?? response;
  } catch {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    return Response.error();
  }
}
