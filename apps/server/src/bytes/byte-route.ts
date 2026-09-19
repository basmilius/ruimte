import { decideAccess, type AccessOptions } from '../auth/access.ts';
import type { AuthStore } from '../auth/auth-store.ts';

// Every URL that serves bytes carries the version of what is behind it, so it never changes; a year is forever enough.
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

/*
 * What every route that serves bytes asks before it looks anything up: the method it answers and the
 * access rules the socket itself is behind. A response here is the answer; null means carry on.
 */
export const guardBytesRequest = async (request: Request, remoteAddress: string, auth: AuthStore, options: AccessOptions): Promise<Response | null> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
    }
    const decision = await decideAccess(request, remoteAddress, auth, options);
    return decision.ok ? null : new Response(decision.reason, { status: decision.status });
};

export interface ServedFile {
    mime: string;
    size: number;
    /* The whole of it; a range is cut from this. */
    body: Blob;
}

export interface ServedFileOptions {
    /* The name a client saves it under; without one it is only ever shown. */
    name?: string;
    /* Whether a browser may paint it itself, rather than hand it over as a download. */
    inline: boolean;
    /* Leave this out for a route that serves no ranges; it is what says the route does. */
    range?: ByteRange | 'unsatisfiable' | null;
}

/*
 * The bytes with the headers every one of these routes answers with, `nosniff` among them: a file a
 * person uploaded is never a browser's to guess the type of.
 */
export const bytesResponse = (file: ServedFile, options: ServedFileOptions): Response => {
    const named = options.name === undefined ? '' : `; filename="${options.name.replaceAll(/["\\\r\n]/g, '')}"`;
    const headers: Record<string, string> = {
        'content-type': file.mime,
        'content-disposition': `${options.inline ? 'inline' : 'attachment'}${named}`,
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff'
    };
    if (file.mime === 'image/svg+xml') {
        headers['content-security-policy'] = SVG_CSP;
    }
    if (options.range === undefined) {
        return new Response(file.body, { headers });
    }
    headers['accept-ranges'] = 'bytes';
    if (options.range === 'unsatisfiable') {
        return new Response('Range not satisfiable', { status: 416, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${file.size}` } });
    }
    if (options.range === null) {
        return new Response(file.body, { headers });
    }
    const { start, end } = options.range;
    return new Response(file.body.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${start}-${end}/${file.size}`, 'content-length': `${end - start + 1}` }
    });
};
