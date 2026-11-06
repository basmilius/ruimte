import { createServer, type Server } from 'node:http';
import { EXTENSION_FILES_PATH } from '@ruimte/csp';
import type { ClientExtensions } from './extensions';

// The same number as the proxy in `apps/client/vite.config.ts`.
export const DEV_EXTENSION_FILES_PORT = 4213;

// What a sandboxed frame loads as part of its page; a fetch is `empty` and gets no answer for an opaque origin.
const FRAME_SUBRESOURCES = new Set(['script', 'style', 'font', 'image', 'audio', 'video', 'track', 'worker']);

/*
 * Who may read an extension file across origins: Vite's page, and a sandboxed frame loading a part of itself. Any
 * other website gets no header, so it cannot read an extension's source from this loopback port.
 */
function allowedOrigin(asker: string | undefined, destination: string | undefined, devOrigin: string): string | null {
    if (asker === devOrigin) {
        return devOrigin;
    }

    if (asker === 'null' && destination !== undefined && FRAME_SUBRESOURCES.has(destination)) {
        return 'null';
    }

    return null;
}

/*
 * Under `bun dev` a window is on Vite's origin, which has no extension files: they sit beside the shell, or
 * in a dev link only the shell knows. Vite proxies that one path here, and the rest of the page never
 * passes through the shell. Only on loopback, and only under `bun dev`.
 */
export function serveDevExtensionFiles(devUrl: string, extensions: Pick<ClientExtensions, 'answer'>, port = DEV_EXTENSION_FILES_PORT): Server {
    const { origin } = new URL(devUrl);
    const server = createServer((request, response) => {
        const { pathname } = new URL(request.url ?? '/', origin);

        if (!pathname.startsWith(EXTENSION_FILES_PATH)) {
            response.writeHead(404).end();

            return;
        }

        // Every request gets an answer, also one whose file could not be read.
        void extensions
            .answer(pathname, origin)
            .then(async (answer) => {
                const body = Buffer.from(await answer.arrayBuffer());
                const headers = new Headers(answer.headers);
                const destination = request.headers['sec-fetch-dest'];
                const allowed = allowedOrigin(request.headers.origin, typeof destination === 'string' ? destination : undefined, origin);

                headers.delete('access-control-allow-origin');

                if (allowed !== null) {
                    headers.set('access-control-allow-origin', allowed);
                }

                headers.set('vary', 'Origin');
                response.writeHead(answer.status, Object.fromEntries(headers));
                response.end(body);
            })
            .catch(() => {
                if (!response.headersSent) {
                    response.writeHead(500);
                }

                response.end();
            });
    });

    server.on('error', (e) => console.warn(`Extension files are not served under bun dev: ${e.message}`));
    server.listen(port, '127.0.0.1');
    server.unref();

    return server;
}
