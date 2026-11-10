import { VISUAL_HOST } from '@ruimte/csp/visual-host';
import type { Plugin } from 'vite';

/*
 * The sandbox host page of a visual: answered by the dev server under its own policy, and written into
 * the build at the same path, where the station serves it as a file and sends that policy itself. The
 * desktop app answers it from its own scheme. It never goes through the client's `index.html`.
 */
export function visualHostPage(): Plugin {
    return {
        name: 'ruimte-visual-host',
        configureServer: (server) => {
            server.middlewares.use((request, response, next) => {
                if (request.url?.split('?')[0] !== VISUAL_HOST.path) {
                    next();
                    return;
                }
                for (const [name, value] of Object.entries(VISUAL_HOST.headers)) {
                    response.setHeader(name, value);
                }
                response.end(VISUAL_HOST.body);
            });
        },
        generateBundle() {
            this.emitFile({ type: 'asset', fileName: `${VISUAL_HOST.path.slice(1)}index.html`, source: VISUAL_HOST.body });
        }
    };
}
