import { createServer, type Server } from 'node:http';
import { EXTENSION_FILES_PATH } from '@ruimte/csp';
import type { ClientExtensions } from './extensions';

// The same number as the proxy in `apps/client/vite.config.ts`.
export const DEV_EXTENSION_FILES_PORT = 4213;

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

        void extensions.answer(pathname, origin).then(async (answer) => {
            response.writeHead(answer.status, Object.fromEntries(answer.headers));
            response.end(Buffer.from(await answer.arrayBuffer()));
        });
    });

    server.on('error', (e) => console.warn(`Extension files are not served under bun dev: ${e.message}`));
    server.listen(port, '127.0.0.1');
    server.unref();

    return server;
}
