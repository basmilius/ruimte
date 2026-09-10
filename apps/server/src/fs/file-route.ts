import { decideAccess } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { readImage } from './read.ts';

export const FS_FILE_PATH = '/fs/file';

// The URL carries the file's version, so the bytes behind it never change; a year is forever enough.
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

// An SVG painted in an `<img>` runs nothing, but the URL can also be opened directly. This makes
// that page inert as well: no script, no network, no subresource, only the styles it carries.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

interface FileRouteOptions {
    allowedOrigins: string[];
    requireToken: boolean;
}

/*
 * `GET /fs/file?path=<absolute>&v=<mtime>-<size>`: the bytes of an image the viewer is drawing.
 * Behind the same access rules as the socket, so a paired client sends the token it already has.
 * Only an image is served: everything else the viewer can draw travels as `fs.read` over the socket,
 * and a route that hands out arbitrary bytes to an `<img>` tag is a worse deal than one that does not.
 */
export const handleFsFileRequest = async (request: Request, url: URL, remoteAddress: string, auth: AuthStore, options: FileRouteOptions): Promise<Response> => {
    if (url.pathname !== FS_FILE_PATH) {
        return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
    }
    const decision = await decideAccess(request, remoteAddress, auth, options);
    if (!decision.ok) {
        return new Response(decision.reason, { status: decision.status });
    }
    const path = url.searchParams.get('path');
    if (!path) {
        return new Response('No path', { status: 400 });
    }
    const image = await readImage(path).catch(() => null);
    if (!image) {
        return new Response('Not an image', { status: 404 });
    }
    const headers: Record<string, string> = {
        'content-type': image.mime,
        'content-disposition': 'inline',
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff'
    };
    if (image.mime === 'image/svg+xml') {
        headers['content-security-policy'] = SVG_CSP;
    }
    return new Response(image.bytes, { headers });
};
