import { withSecurityHeaders } from './headers.ts';

interface Env {
    ASSETS: Fetcher;
}

/*
 * The web client: the built `apps/client` as static assets, with a page for every path that is not a
 * file (a login comes back on `/pulsar/callback`), and the security headers on every answer. The
 * Worker runs first so no answer leaves without them.
 */
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.protocol === 'http:') {
            url.protocol = 'https:';
            return Response.redirect(url.toString(), 301);
        }
        return withSecurityHeaders(await env.ASSETS.fetch(request), url.pathname);
    }
} satisfies ExportedHandler<Env>;
