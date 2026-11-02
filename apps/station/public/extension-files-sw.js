// What an extension is made of comes over the connection to a machine, which a browser cannot import from.
// The page puts the files in this cache, and this answers them on the page's own origin under script-src 'self'.
const CACHE = 'ruimte-extension-files';
const PATH = '/__extensions/';
// In `/__extensions/<machine>/<id>/<version>/`, the version a load is asked for under.
const VERSION_SEGMENT = 4;

/* A window asks each load of a version under `<version>~<load>`, so its modules run anew; the files are the version's. */
function fileOf(pathname) {
    const segments = pathname.split('/');

    if (segments.length > VERSION_SEGMENT + 1) {
        segments[VERSION_SEGMENT] = segments[VERSION_SEGMENT].replace(/~\d+$/, '');
    }

    return segments.join('/');
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
    if (event.data === 'claim') {
        event.waitUntil(self.clients.claim());
    }
});
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.origin === self.location.origin && url.pathname.startsWith(PATH)) {
        event.respondWith(caches.open(CACHE).then((cache) => cache.match(fileOf(url.pathname))).then((hit) => hit ?? new Response('Not found', { status: 404 })));
    }
});
