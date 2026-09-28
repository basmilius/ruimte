import i18next from 'i18next';
import { BYTES_CHUNK_MAX, BYTES_READ_MAX_BYTES, type ByteResource, type BytesReadPayload } from '@ruimte/contracts';
import { blobTypeFor, type BytesPiece } from './piece';

export type ReadPiece = (payload: BytesReadPayload) => Promise<BytesPiece>;

export interface ReadResourceOptions {
    chunkBytes?: number;
    maxBytes?: number;
    /* How often a file that changed halfway is started over before it counts as a failure. */
    restarts?: number;
}

/*
 * A resource's bytes over the wire, one piece per request. The client asks for the next piece only
 * once the one before arrived, so the daemon never has more than one piece of this resource on its
 * way; each piece is one frame that the channel splits further.
 */
export const readResource = async (read: ReadPiece, resource: ByteResource, options: ReadResourceOptions = {}): Promise<Blob> => {
    const chunkBytes = Math.min(options.chunkBytes ?? BYTES_CHUNK_MAX, BYTES_CHUNK_MAX);
    const maxBytes = options.maxBytes ?? BYTES_READ_MAX_BYTES;
    let restarts = options.restarts ?? 1;

    for (;;) {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        let changed = false;
        const first = await read({ resource, offset: 0, length: chunkBytes });
        if (first.size > maxBytes) {
            throw new Error(i18next.t('machines:file.tooLarge', { size: Math.ceil(first.size / 1024 / 1024), max: Math.ceil(maxBytes / 1024 / 1024) }));
        }
        let piece = first;
        for (;;) {
            if (piece.version !== first.version || piece.offset !== offset) {
                changed = true;
                break;
            }
            const { bytes } = piece;
            parts.push(bytes);
            offset += bytes.length;
            if (offset >= first.size) {
                break;
            }
            if (bytes.length === 0) {
                throw new Error(i18next.t('machines:file.emptyPiece'));
            }
            piece = await read({ resource, offset, length: chunkBytes });
        }
        if (!changed && offset === first.size) {
            return new Blob(parts, { type: blobTypeFor(first.mime) });
        }
        if (restarts <= 0) {
            throw new Error(i18next.t('machines:file.changed'));
        }
        restarts -= 1;
    }
};
