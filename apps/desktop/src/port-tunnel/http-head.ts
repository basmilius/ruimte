/*
 * The bounded parsing the proxy of a shared port does by hand: a request head, its body framing and the
 * chunk framing of a body. Nothing here is a regular expression over a whole message, and nothing guesses: what is
 * ambiguous is refused, since a proxy that reads a request differently from the service behind it can be made to smuggle.
 */

/* A request head larger than this is refused unread. */
export const MAX_HEAD_BYTES = 16 * 1024;

const MAX_HEADERS = 100;
const HEAD_END = Buffer.from('\r\n\r\n');
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface RequestHead {
    method: string;
    target: string;
    headers: Array<[name: string, value: string]>;
}

export type HeadResult = { kind: 'need-more' } | { kind: 'head'; head: RequestHead; rest: Buffer } | { kind: 'bad'; status: 400 | 431 | 501; reason: string };

export function parseRequestHead(buffer: Buffer): HeadResult {
    const end = buffer.indexOf(HEAD_END);

    if (end === -1) {
        return buffer.length > MAX_HEAD_BYTES ? { kind: 'bad', status: 431, reason: 'The request head is too large' } : { kind: 'need-more' };
    }

    if (end > MAX_HEAD_BYTES) {
        return { kind: 'bad', status: 431, reason: 'The request head is too large' };
    }

    const text = buffer.subarray(0, end).toString('latin1');

    if (text.includes('\0')) {
        return { kind: 'bad', status: 400, reason: 'The request head holds a null byte' };
    }

    const lines = text.split('\r\n');
    const requestLine = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(lines[0]!);

    if (requestLine === null) {
        return { kind: 'bad', status: 400, reason: 'The request line is not HTTP/1' };
    }

    if (lines.length - 1 > MAX_HEADERS) {
        return { kind: 'bad', status: 431, reason: 'The request has too many headers' };
    }

    const headers: RequestHead['headers'] = [];

    for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        const name = colon === -1 ? '' : line.slice(0, colon);

        // A name with a space before the colon, a folded line or a bare CR or LF is read differently by different servers.
        if (!TOKEN.test(name) || /[\r\n]/.test(line)) {
            return { kind: 'bad', status: 400, reason: 'A header line is malformed' };
        }

        headers.push([name, line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '')]);
    }

    return { kind: 'head', head: { method: requestLine[1]!, target: requestLine[2]!, headers }, rest: buffer.subarray(end + HEAD_END.length) };
}

export function headerValues(headers: RequestHead['headers'], name: string): string[] {
    return headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

export type Framing = { kind: 'none' } | { kind: 'length'; bytes: number } | { kind: 'chunked' } | { kind: 'bad'; reason: string };

/* How long the body of a request is, by the rules of RFC 9112 section 6, refusing a request that names two lengths. */
export function framingOf(headers: RequestHead['headers']): Framing {
    const lengths = headerValues(headers, 'content-length').flatMap((value) => value.split(',').map((part) => part.trim()));
    const encodings = headerValues(headers, 'transfer-encoding');

    if (encodings.length > 0) {
        if (lengths.length > 0) {
            return { kind: 'bad', reason: 'The request names both a length and a transfer encoding' };
        }

        return encodings.length === 1 && encodings[0]!.toLowerCase() === 'chunked'
            ? { kind: 'chunked' }
            : { kind: 'bad', reason: 'The transfer encoding is not plain chunked' };
    }

    if (lengths.length === 0) {
        return { kind: 'none' };
    }

    if (!lengths.every((length) => /^\d{1,15}$/.test(length) && length === lengths[0])) {
        return { kind: 'bad', reason: 'The content length is not one number' };
    }

    const bytes = Number(lengths[0]);

    return bytes === 0 ? { kind: 'none' } : { kind: 'length', bytes };
}

type ChunkState = 'size' | 'data' | 'data-end' | 'trailers';

const MAX_CHUNK_LINE = 1024;

/*
 * Finds where a chunked body ends without keeping it: `feed` says how many of the given bytes belong to the
 * body, and `done` turns true once the last chunk and its trailers went by.
 */
export class ChunkedBody {
    done = false;
    error: string | null = null;
    private state: ChunkState = 'size';
    private line = '';
    private remaining = 0;
    private trailerBytes = 0;
    private dataEnd = 0;

    feed(bytes: Uint8Array): number {
        let used = 0;

        while (used < bytes.length && !this.done && this.error === null) {
            if (this.state === 'data') {
                const take = Math.min(this.remaining, bytes.length - used);

                this.remaining -= take;
                used += take;

                if (this.remaining === 0) {
                    this.state = 'data-end';
                    this.dataEnd = 0;
                }

                continue;
            }

            const byte = bytes[used++]!;

            if (this.state === 'data-end') {
                // Each chunk ends with CRLF, which no byte of the chunk's own data can stand in for.
                if (byte !== (this.dataEnd === 0 ? 0x0d : 0x0a)) {
                    this.error = 'A chunk did not end with a line break';
                } else if (++this.dataEnd === 2) {
                    this.state = 'size';
                    this.line = '';
                }

                continue;
            }

            if (byte !== 0x0a) {
                this.line += String.fromCharCode(byte);

                if (this.line.length > MAX_CHUNK_LINE || (this.state === 'trailers' && ++this.trailerBytes > MAX_HEAD_BYTES)) {
                    this.error = 'A chunk line is too long';
                }

                continue;
            }

            if (!this.line.endsWith('\r')) {
                this.error = 'A chunk line did not end with CRLF';

                continue;
            }

            const line = this.line.slice(0, -1);

            this.line = '';

            if (this.state === 'trailers') {
                this.done = line === '';

                continue;
            }

            const size = /^([0-9a-fA-F]{1,12})(?:;[^\r\n]*)?$/.exec(line);

            if (size === null) {
                this.error = 'A chunk size is not a number';

                continue;
            }

            this.remaining = parseInt(size[1]!, 16);
            this.state = this.remaining === 0 ? 'trailers' : 'data';
        }

        return used;
    }
}

const ALIASES = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i;

export interface Authority {
    /* The host as the page wrote it, lowercase; the Host header the service sees. */
    host: string;
    port: number;
    /* The authority as written, with the port left out when the page left it out. */
    text: string;
}

/* A host from the fixed set of loopback spellings and a port, nothing resolved and nothing normalized. */
export function parseAuthority(text: string): Authority | null {
    const match = ALIASES.exec(text);

    if (match === null) {
        return null;
    }

    const port = match[2] === undefined ? 80 : Number(match[2]);

    if (port < 1 || port > 65535) {
        return null;
    }

    return { host: match[1]!.toLowerCase(), port, text: text.toLowerCase() };
}

/* `http://authority/path?query` split into its authority and the origin-form target, or null for anything else. */
export function parseAbsoluteTarget(target: string): { authority: Authority; path: string } | null {
    // After the authority comes a path or a query and nothing else, so `host:80@elsewhere` is no authority of ours.
    const match = /^http:\/\/([^/?#\s@]+)((?:[/?][\x21-\x7e]*)?)$/i.exec(target);

    if (match === null) {
        return null;
    }

    const authority = parseAuthority(match[1]!);
    const rest = match[2]!;

    if (authority === null || rest.includes('#')) {
        return null;
    }

    return { authority, path: rest === '' ? '/' : rest.startsWith('?') ? `/${rest}` : rest };
}

/** Headers that never cross to the service: the proxy's own, and Host, which is written again from the validated authority. */
const DROPPED = new Set(['proxy-authorization', 'proxy-connection', 'proxy-authenticate', 'host']);

export function forwardedHead(head: RequestHead, authority: Authority, path: string): Buffer {
    const lines = [`${head.method} ${path} HTTP/1.1`, `Host: ${authority.text}`];

    for (const [name, value] of head.headers) {
        if (!DROPPED.has(name.toLowerCase())) {
            lines.push(`${name}: ${value}`);
        }
    }

    return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
}

/* The status code of a response head, or null when the bytes do not start one. */
export function statusOfResponse(bytes: Buffer): number | null {
    const match = /^HTTP\/1\.[01] (\d{3})[ \r]/.exec(bytes.subarray(0, 32).toString('latin1'));

    return match === null ? null : Number(match[1]);
}
