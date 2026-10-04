import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { DESKTOP_APP_ORIGIN } from '@ruimte/contracts';
import { cspString } from '@ruimte/csp';

// The policy the page runs under, the same one the client's own `<meta http-equiv>` carries.
const CLIENT_CSP = cspString();

// The blank page the move of the old origin's storage writes from, which never boots the client.
export const STORAGE_MOVE_PATH = '/__ruimte-storage';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    // A WebAssembly module compiles while it streams only under its own type, which shiki relies on.
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json'
};

/*
 * The file of the build a request asks for, `index.html` for an address without an extension (the
 * client routes itself), or null for a file the build does not have or a path that leaves the build.
 * A missing chunk answers 404 rather than the page, so a stale one fails as a load error.
 */
export function clientFileFor(root: string, url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (`${parsed.protocol}//${parsed.host}` !== DESKTOP_APP_ORIGIN) {
        return null;
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(parsed.pathname);
    } catch {
        return null;
    }
    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (relative === '' || extname(relative) === '') {
        return join(root, 'index.html');
    }
    const file = join(root, relative);
    return file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`) ? file : null;
}

/* What the shell answers for one request on its scheme. */
export async function answerAppRequest(root: string, url: string): Promise<Response> {
    if (new URL(url).pathname === STORAGE_MOVE_PATH) {
        return new Response('<!doctype html><title>Ruimte</title>', { headers: { 'content-type': CONTENT_TYPES['.html']! } });
    }
    const file = clientFileFor(root, url);
    if (file === null) {
        return new Response('Not found', { status: 404 });
    }
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch {
        return new Response('Not found', { status: 404 });
    }
    return new Response(new Uint8Array(bytes), {
        headers: {
            'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'content-security-policy': CLIENT_CSP
        }
    });
}
