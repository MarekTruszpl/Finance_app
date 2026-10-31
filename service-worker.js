// service-worker.js — хранит копию файлов приложения на устройстве, чтобы оно открывалось без интернета.
// Данные пользователя здесь не участвуют: они лежат в IndexedDB и обновление кода их не затрагивает.
//
// Как обновляются файлы: когда есть интернет, всегда берём свежую версию с сервера (и сохраняем её),
// а без интернета открываем сохранённую. Поэтому после загрузки новой версии на хостинг
// достаточно открыть приложение с интернетом (иногда с перезапуском) — и оно обновится.
//
// VERSION менять нужно, только если вы удалили или переименовали файлы: старый кэш тогда очистится.

const VERSION = 'v1';
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
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Библиотека Dexie с внешнего адреса. Версия зашита в адрес, поэтому файл не меняется.
const DEXIE_URL = 'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' — не брать устаревшие копии из HTTP-кэша браузера
    await cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
    try {
      await cache.add(DEXIE_URL);
    } catch {
      // нет сети при установке: Dexie сохранится при первом обычном запуске
    }
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

  if (request.url === DEXIE_URL) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (new URL(request.url).origin !== self.location.origin) return; // чужие адреса не трогаем

  event.respondWith(networkFirst(request));
});

// Свои файлы: сначала сервер, при отсутствии сети — сохранённая копия
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request.url, { cache: 'no-cache' }));
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    return Response.error();
  }
}

// Dexie: сначала сохранённая копия
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  cache.add(DEXIE_URL).catch(() => {}); // сохранить на будущее (запрос с CORS, чтобы ответ можно было положить в кэш)
  return fetch(request);
}
