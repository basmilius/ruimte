import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
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
                target: process.env.RUIMTE_DAEMON ?? 'ws://localhost:4210',
                ws: true
            }
        }
    }
});
