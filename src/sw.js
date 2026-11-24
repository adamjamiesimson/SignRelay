const prefix = 'signrelay-gameshow-';
const cacheName = prefix + RELEASE.version;
const scope = self.registration.scope;
const urlFor = path => new URL(path, scope).href;
const assets = new Map(RELEASE.assets.map(asset => [urlFor(asset.path), asset]));
const home = urlFor('index.html');
const manifestUrl = urlFor('runtime.json');

async function install() {
  const cache = await caches.open(cacheName);
  for (const asset of RELEASE.assets) {
    const url = urlFor(asset.path);
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error('Offline install failed: ' + asset.path);
    const bytes = await response.clone().arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== asset.bytes || hex !== asset.sha256) {
      throw new Error('Offline fingerprint mismatch: ' + asset.path);
    }
    await cache.put(url, response);
  }
  await cache.put(manifestUrl, new Response(JSON.stringify(RELEASE), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', event => event.waitUntil(install()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  for (const key of await caches.keys()) {
    if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
  }
})()));

async function mediaRange(request, response, size) {
  const range = request.headers.get('Range');
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start;
  let end;
  if (match?.[1]) {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  } else if (match?.[2]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  const data = await response.blob();
  return new Response(data.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
    'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
    'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
  } });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  let key = request.url;
  if (request.mode === 'navigate') {
    const path = new URL(key).pathname;
    if (path === new URL(scope).pathname || path === new URL(home).pathname) key = home;
  }
  const asset = assets.get(key);
  if (!asset && key !== manifestUrl) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(key);
    if (!cached) return fetch(request);
    return request.headers.has('Range') && asset ? mediaRange(request, cached, asset.bytes) : cached;
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const keys = new Set((await cache.keys()).map(key => key.url));
    const missing = RELEASE.assets.filter(item => !keys.has(urlFor(item.path))).map(item => item.path);
    event.ports[0].postMessage({ version: RELEASE.version, count: RELEASE.assets.length, missing });
  })());
});

