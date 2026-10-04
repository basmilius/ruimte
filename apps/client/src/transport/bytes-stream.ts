import { blobTypeFor, type BytesPiece } from './piece';

// At the root, since a service worker only controls the pages under the folder its script is in.
export const BYTES_WORKER_SCRIPT = '/bytes-worker.js';

// The one path the worker answers; every other request passes it by.
export const BYTES_STREAM_PATH = '/machine-bytes/file';

/*
 * The most one answer to an open range carries. HTTP lets a server answer less than was asked, and
 * the player then asks for the next range itself, so no answer keeps the worker busy for minutes and
 * a seek leaves little behind.
 */
const WINDOW_BYTES = 8 * 1024 * 1024;

// Three binary pieces are 768 KiB, under the daemon's 1 MB output gate, so a terminal on the same connection keeps flowing.
const AHEAD = 3;

// `BYTES_CHUNK_MAX`, which a test holds this to: importing the value would bring every schema into the worker.
export const STREAM_PIECE_BYTES = 256 * 1024;

export interface StreamedFile {
    machine: string;
    path: string;
    mtime: number;
    size: number;
}

/* The worker asks the page that plays the video, since only a page holds the connection to a machine. */
export interface PieceQuestion {
    machine: string;
    path: string;
    offset: number;
    length: number;
}

export type AskPiece = (question: PieceQuestion) => Promise<BytesPiece>;

export interface RangeRequest {
    url: string;
    method: string;
    mode: string;
    range: string | null;
}

export interface StreamOptions {
    windowBytes?: number;
    // How many pieces are on their way beyond the one the player reads.
    ahead?: number;
}

// The URL carries no credential: access was decided when the direct connection was let in.
export function bytesStreamUrl(file: StreamedFile): string {
    return `${BYTES_STREAM_PATH}?${new URLSearchParams({ machine: file.machine, path: file.path, v: `${file.mtime}-${file.size}` }).toString()}`;
}

const VERSION = /^(\d+)-(\d+)$/;

function fileOf(url: URL): StreamedFile | null {
    const machine = url.searchParams.get('machine');
    const path = url.searchParams.get('path');
    const version = VERSION.exec(url.searchParams.get('v') ?? '');
    if (!machine || !path || !version) {
        return null;
    }
    return { machine, path, mtime: Number(version[1]), size: Number(version[2]) };
}

/* `bytes=X-` or `bytes=X-Y`, the forms a media element sends. HTTP lets any other form be answered whole. */
export function parseRange(header: string | null): { start: number; end: number | null } | null {
    const match = header === null ? null : /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!match) {
        return null;
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? null : Number(match[2]);
    return end !== null && end < start ? null : { start, end };
}

// The file viewer rounds a file's mtime and `bytes.read` truncates it, so the same file may differ by a millisecond.
function sameVersion(version: string, file: StreamedFile): boolean {
    const match = VERSION.exec(version);
    return match !== null && Number(match[2]) === file.size && Math.abs(Number(match[1]) - file.mtime) <= 1;
}

// The answer has this page's origin, so it may never be read as a document, whatever the file says it is.
const GUARDED = {
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cache-control': 'no-store'
};

function refuse(status: number, message: string, headers: Record<string, string> = {}): Response {
    return new Response(message, { status, headers: { ...GUARDED, 'content-type': 'text/plain', ...headers } });
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/*
 * The body from `start` to `last`, piece by piece. A few pieces are asked ahead so the round trips
 * overlap, and only as the player reads, so a player that stops reading stops the asking too.
 */
function streamPieces(
    file: StreamedFile,
    first: BytesPiece,
    start: number,
    last: number,
    ask: AskPiece,
    ahead: number
): ReadableStream<Uint8Array<ArrayBuffer>> {
    const lengthAt = (offset: number): number => Math.min(STREAM_PIECE_BYTES, last + 1 - offset);
    const pending: Promise<BytesPiece>[] = [];
    let next = start + lengthAt(start);
    let position = start;
    let cancelled = false;

    const fill = (): void => {
        while (!cancelled && pending.length < ahead && next <= last) {
            const piece = ask({ machine: file.machine, path: file.path, offset: next, length: lengthAt(next) });
            // A piece asked before a cancel is never read, and neither is its failure.
            piece.catch(() => undefined);
            pending.push(piece);
            next += lengthAt(next);
        }
    };

    const take = (piece: BytesPiece): Uint8Array<ArrayBuffer> => {
        if (!sameVersion(piece.version, file) || piece.offset !== position) {
            throw new Error('The file changed while it played');
        }
        const { bytes } = piece;
        if (bytes.length !== lengthAt(position)) {
            throw new Error('A piece came back short');
        }
        position += bytes.length;
        return bytes;
    };

    const push = (controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>, piece: BytesPiece): void => {
        controller.enqueue(take(piece));
        if (position > last) {
            controller.close();
            return;
        }
        fill();
    };

    return new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
            start: (controller) => push(controller, first),
            pull: async (controller) => {
                const piece = pending.shift();
                if (piece) {
                    push(controller, await piece);
                }
            },
            cancel: () => {
                cancelled = true;
                pending.length = 0;
            }
        },
        { highWaterMark: 0 }
    );
}

/*
 * The service worker's answer to a request for its path. A range becomes pieces of `bytes.read` and
 * the answer streams as they arrive. The first piece is asked before answering, so a file that is
 * gone or changed is a status the player sees at once, and the type comes from the machine.
 */
export async function answerRange(request: RangeRequest, ask: AskPiece, options: StreamOptions = {}): Promise<Response> {
    if (request.mode === 'navigate') {
        return refuse(400, 'Not a page');
    }
    if (request.method !== 'GET') {
        return refuse(405, 'Only GET');
    }
    const file = fileOf(new URL(request.url));
    if (file === null) {
        return refuse(400, 'Not a file');
    }
    const range = parseRange(request.range);
    const start = range?.start ?? 0;
    if (start >= file.size) {
        return refuse(416, 'Past the end of the file', { 'content-range': `bytes */${file.size}` });
    }
    const last =
        range === null ? file.size - 1 : Math.min(range.end ?? Number.POSITIVE_INFINITY, file.size - 1, start + (options.windowBytes ?? WINDOW_BYTES) - 1);

    let first: BytesPiece;
    try {
        first = await ask({ machine: file.machine, path: file.path, offset: start, length: Math.min(STREAM_PIECE_BYTES, last + 1 - start) });
    } catch (e) {
        return refuse(502, messageOf(e));
    }
    if (!sameVersion(first.version, file)) {
        return refuse(412, 'The file changed');
    }

    const body = streamPieces(file, first, start, last, ask, options.ahead ?? AHEAD);
    const headers = { ...GUARDED, 'content-type': blobTypeFor(first.mime), 'content-length': String(last + 1 - start), 'accept-ranges': 'bytes' };
    if (range === null) {
        return new Response(body, { status: 200, headers });
    }
    return new Response(body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${last}/${file.size}` } });
}
