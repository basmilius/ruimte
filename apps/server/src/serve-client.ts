import { join, normalize } from 'node:path';
import { cspString } from '@ruimte/csp';

/* The policy the served client runs under, the same one the client's own `<meta http-equiv>` carries. */
const CLIENT_CSP = cspString();

/* The built client from one directory; anything that is not a file falls back to the app shell. */
export const serveClient = async (dir: string, pathname: string): Promise<Response> => {
    const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = Bun.file(join(dir, relative === '/' ? 'index.html' : relative));
    const headers = { 'content-security-policy': CLIENT_CSP };
    if (await file.exists()) {
        return new Response(file, { headers });
    }
    return new Response(Bun.file(join(dir, 'index.html')), { headers });
};
