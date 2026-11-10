import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES, type ByteResource, type BytesReadPayload } from '@ruimte/contracts';
import i18next from 'i18next';
import { blobTypeFor, type BytesPiece } from '../transport-api/piece';

type ReadPiece = (payload: BytesReadPayload) => Promise<BytesPiece>;

interface ReadResourceOptions {
    chunkBytes?: number;
    maxBytes?: number;
    /* How often a file that changed halfway is started over before it counts as a failure. */
    restarts?: number;
    /* At most `PIECES_IN_FLIGHT`; one asks for each piece only once the one before arrived. */
    piecesInFlight?: number;
}

/*
 * Two pieces stay under the daemon's output gate of 1 MB even when base64 encoded; above it, a terminal
 * on the same connection loses output until it resyncs.
 */
const PIECES_IN_FLIGHT = 2;

function pieceSizes(options: Pick<ReadResourceOptions, 'chunkBytes' | 'piecesInFlight'>): { chunkBytes: number; inFlight: number } {
    return {
        chunkBytes: Math.min(options.chunkBytes ?? BYTES_CHUNK_MAX, BYTES_CHUNK_MAX),
        inFlight: Math.max(1, Math.min(options.piecesInFlight ?? PIECES_IN_FLIGHT, PIECES_IN_FLIGHT))
    };
}

export function fileTooLarge(size: number, maxBytes: number): Error {
    return new Error(i18next.t('machines:file.tooLarge', { size: Math.ceil(size / 1024 / 1024), max: Math.ceil(maxBytes / 1024 / 1024) }));
}

/*
 * A resource's bytes over the wire, a few pieces on their way at once so a slow link is not one
 * round trip per piece. The first piece is asked alone, since it says how large the resource is;
 * each piece is one frame that the channel splits further.
 */
export async function readResource(read: ReadPiece, resource: ByteResource, options: ReadResourceOptions = {}): Promise<Blob> {
    const { chunkBytes, inFlight } = pieceSizes(options);
    const maxBytes = options.maxBytes ?? BYTES_READ_MAX_BYTES;
    let restarts = options.restarts ?? 1;

    for (;;) {
        const first = await read({ resource, offset: 0, length: chunkBytes });
        if (first.size > maxBytes) {
            throw fileTooLarge(first.size, maxBytes);
        }
        const parts: Uint8Array<ArrayBuffer>[] = [];
        if (await readPieces(read, resource, first, chunkBytes, inFlight, (bytes) => void parts.push(bytes))) {
            return new Blob(parts, { type: blobTypeFor(first.mime) });
        }
        if (restarts <= 0) {
            throw new Error(i18next.t('machines:file.changed'));
        }
        restarts -= 1;
    }
}

type AcceptPiece = (bytes: Uint8Array<ArrayBuffer>) => void | Promise<void>;

/*
 * A resource's bytes handed on piece by piece, in order, for one too large to hold whole. A change under
 * the read fails it rather than starting over, since the pieces before it were handed on already.
 */
export async function streamResource(
    read: ReadPiece,
    resource: ByteResource,
    accept: AcceptPiece,
    options: Pick<ReadResourceOptions, 'chunkBytes' | 'piecesInFlight'> = {}
): Promise<void> {
    const { chunkBytes, inFlight } = pieceSizes(options);
    const first = await read({ resource, offset: 0, length: chunkBytes });
    if (!(await readPieces(read, resource, first, chunkBytes, inFlight, accept))) {
        throw new Error(i18next.t('machines:file.changed'));
    }
}

/* Hands on every piece from `first` on, in order; false when the resource changed under the read. */
async function readPieces(
    read: ReadPiece,
    resource: ByteResource,
    first: BytesPiece,
    chunkBytes: number,
    inFlight: number,
    accept: AcceptPiece
): Promise<boolean> {
    const queue: Array<{ offset: number; piece: Promise<BytesPiece> }> = [];
    let offset = 0;
    let piece = first;
    for (;;) {
        if (
            piece.version !== first.version ||
            piece.offset !== offset ||
            piece.size !== first.size ||
            piece.mime !== first.mime ||
            piece.bytes.length > first.size - offset
        ) {
            await Promise.allSettled(queue.map((pending) => pending.piece));
            return false;
        }
        await accept(piece.bytes);
        offset += piece.bytes.length;
        if (offset >= first.size) {
            return true;
        }
        if (piece.bytes.length === 0) {
            throw new Error(i18next.t('machines:file.emptyPiece'));
        }
        if (queue[0] !== undefined && queue[0].offset !== offset) {
            // A short piece leaves the ones already asked for at the wrong offsets, so the read goes on from here.
            await Promise.allSettled(queue.map((pending) => pending.piece));
            queue.length = 0;
        }
        const last = queue.at(-1);
        let next = last === undefined ? offset : last.offset + chunkBytes;
        while (queue.length < inFlight && next < first.size) {
            const pending = read({ resource, offset: next, length: chunkBytes });
            // A piece left behind by a failure or a restart may still reject, and nobody waits on it any more.
            pending.catch(() => undefined);
            queue.push({ offset: next, piece: pending });
            next += chunkBytes;
        }
        piece = await queue.shift()!.piece;
    }
}
