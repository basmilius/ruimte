import { decideAccess } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import { readMedia } from './read.ts';

export const FS_FILE_PATH = '/fs/file';

// The URL carries the file's version, so the bytes behind it never change; a year is forever enough.
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

// An SVG painted in an `<img>` runs nothing, but the URL can also be opened directly. This makes
// that page inert as well: no script, no network, no subresource, only the styles it carries.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

export interface ByteRange {
    start: number;
    end: number;
}

// One range, the form a media element sends when it seeks. A request for several at once is answered
// with the whole file, which is always allowed and simpler than a multipart body nothing here needs.
const RANGE = /^bytes=(\d*)-(\d*)$/;

/*
 * What of the file the `Range` header asks for. Null when there is nothing to honor and the whole
 * file is the answer, `unsatisfiable` when it names bytes the file does not have, which is a 416.
 */
export const parseByteRange = (header: string | null, size: number): ByteRange | 'unsatisfiable' | null => {
    const match = header === null ? null : RANGE.exec(header.trim());
    if (!match) {
        return null;
    }
    const [, from, to] = match;
    if (from === '') {
        // `bytes=-N` counts back from the end, which is how a player reads a trailing index.
        const length = Number(to);
        if (to === '' || length === 0 || size === 0) {
            return 'unsatisfiable';
        }
        return { start: Math.max(0, size - length), end: size - 1 };
    }
    const start = Number(from);
    const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    if (start >= size || start > end) {
        return 'unsatisfiable';
    }
    return { start, end };
};

interface FileRouteOptions {
    allowedOrigins: string[];
    requireToken: boolean;
}

/*
 * `GET /fs/file?path=<absolute>&v=<mtime>-<size>`: the bytes of an image or a video the viewer is
 * drawing. Behind the same access rules as the socket, so a paired client sends the token it already
 * has. Only those two are served: everything else the viewer can draw travels as `fs.read` over the
 * socket, and a route that hands out arbitrary bytes to an `<img>` tag is a worse deal than one that
 * does not. A video answers ranges, without which a player can start a file and never seek in it.
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
    const media = await readMedia(path).catch(() => null);
    if (!media) {
        return new Response('Not a file this route serves', { status: 404 });
    }
    const headers: Record<string, string> = {
        'content-type': media.mime,
        'content-disposition': 'inline',
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
        'accept-ranges': 'bytes'
    };
    if (media.mime === 'image/svg+xml') {
        headers['content-security-policy'] = SVG_CSP;
    }
    const range = parseByteRange(request.headers.get('range'), media.size);
    if (range === 'unsatisfiable') {
        return new Response('Range not satisfiable', { status: 416, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${media.size}` } });
    }
    if (range) {
        const slice = media.bytes.slice(range.start, range.end + 1);
        return new Response(slice, {
            status: 206,
            headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${media.size}`, 'content-length': `${range.end - range.start + 1}` }
        });
    }
    return new Response(media.bytes, { headers });
};
