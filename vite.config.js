import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

// Cache the exact built assets, including PouchDB. Database requests are never cached here.
function offlineShell() {
  return {
    name: 'offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const version = createHash('sha256').update(JSON.stringify(bundle)).digest('hex').slice(0, 12);
      const urls = ['/', '/favicon.svg', ...files.map((file) => `/${file}`)];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const CACHE = 'reel-local-${version}';
const SHELL = ${JSON.stringify(urls)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('reel-local-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/index.html'))));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) || fetch(event.request)));
  }
});`
      });
    }
  };
}

export default defineConfig({
  define: { global: 'globalThis' },
  plugins: [offlineShell()],
  build: { target: 'es2022' }
});
