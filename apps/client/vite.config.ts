import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

// The dev daemon sits on 4211 so an installed Ruimte can keep 4210.
const daemon = process.env.RUIMTE_DAEMON ?? 'ws://localhost:4211';

/*
 * The web client at `station.ruimte.app` (`vite build --mode station`). It is the same page, plus what
 * lets a person put it on a Home Screen: Safari clears a site's storage after seven days without a
 * visit, and a Home Screen app is exempt, which is where the session and the client key live.
 */
const stationHead = (): Plugin => ({
    name: 'ruimte-station-head',
    transformIndexHtml: (html) => ({
        // A browser prefers an SVG icon over any PNG, so the page's own mark would win over the app icon.
        html: html.replace(/\s*<link rel="icon" href="\/favicon\.svg"[^>]*>/, ''),
        tags: [
            { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
            { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' },
            { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' }, injectTo: 'head' },
            { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Ruimte' }, injectTo: 'head' }
        ]
    })
});

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss(), ...(mode === 'station' ? [stationHead()] : [])],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        proxy: {
            // The client always talks to its own origin; in dev that origin is Vite, which
            // forwards the socket to the daemon so no port or CORS setup leaks into the client.
            // `RUIMTE_DAEMON` points a second Vite at a daemon on another port, for a dev setup
            // next to the usual one.
            '/ws': {
                target: daemon,
                ws: true
            },
            // A project's icon is bytes on the daemon, never a data URL on the wire.
            '/projects': {
                target: daemon.replace(/^ws/, 'http')
            },
            // The same for an image the file viewer draws.
            '/fs': {
                target: daemon.replace(/^ws/, 'http')
            },
            // And for a file someone attached to a message; the bytes stay on the daemon.
            '/attachments': {
                target: daemon.replace(/^ws/, 'http')
            }
        }
    }
}));
