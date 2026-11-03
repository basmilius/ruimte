import { randomUUID } from 'node:crypto';
import { FS_WRITE_PIECE_BYTES } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';

type UploadErrorCode = 'upload-gone' | 'upload-invalid' | 'upload-incomplete' | 'not-text';

class UploadError extends CodedError<UploadErrorCode> {}

/* A client that went away leaves nothing behind for long: a new upload pushes out the oldest past this many. */
const MAX_UPLOADS = 4;

interface Upload {
    readonly clientId: string;
    readonly path: string;
    readonly expectedMtime: number;
    readonly bytes: Uint8Array;
    readonly pieces: Map<number, number>;
}

export interface FinishedUpload {
    readonly path: string;
    readonly expectedMtime: number;
    readonly text: string;
}

/* Text on its way in pieces, held in memory so a save that never finishes leaves the file and the disk alone. */
export class TextUploads {
    private readonly uploads = new Map<string, Upload>();

    start(clientId: string, path: string, size: number, expectedMtime: number): string {
        const uploadId = randomUUID();

        this.uploads.set(uploadId, { clientId, path, expectedMtime, bytes: new Uint8Array(size), pieces: new Map() });

        if (this.uploads.size > MAX_UPLOADS) {
            const [oldest] = this.uploads.keys();

            this.uploads.delete(oldest!);
        }

        return uploadId;
    }

    /* The path a piece belongs to is checked at the start and at the commit; this holds only the bytes. */
    piece(clientId: string, uploadId: string, offset: number, data: string): void {
        const upload = this.ownUpload(clientId, uploadId);
        const piece = Buffer.from(data, 'base64');

        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            piece.byteLength === 0 ||
            piece.byteLength > FS_WRITE_PIECE_BYTES ||
            offset + piece.byteLength > upload.bytes.byteLength
        ) {
            throw new UploadError('upload-invalid', 'That piece does not fit the upload');
        }

        for (const [start, length] of upload.pieces) {
            if (offset === start && piece.byteLength === length && piece.equals(upload.bytes.subarray(start, start + length))) {
                return;
            }

            if (offset < start + length && start < offset + piece.byteLength) {
                throw new UploadError('upload-invalid', 'That piece overlaps bytes already received');
            }
        }

        upload.bytes.set(piece, offset);
        upload.pieces.set(offset, piece.byteLength);
    }

    /* Ends the upload whatever comes of it: a commit that fails starts over from a fresh read. */
    finish(clientId: string, uploadId: string): FinishedUpload {
        const upload = this.ownUpload(clientId, uploadId);

        this.uploads.delete(uploadId);

        const received = [...upload.pieces.values()].reduce((total, length) => total + length, 0);

        if (received !== upload.bytes.byteLength) {
            throw new UploadError('upload-incomplete', 'Part of that upload did not arrive');
        }

        try {
            return {
                path: upload.path,
                expectedMtime: upload.expectedMtime,
                text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(upload.bytes)
            };
        } catch {
            throw new UploadError('not-text', 'That upload is not UTF-8 text');
        }
    }

    abort(clientId: string, uploadId: string): void {
        if (this.uploads.get(uploadId)?.clientId === clientId) {
            this.uploads.delete(uploadId);
        }
    }

    private ownUpload(clientId: string, uploadId: string): Upload {
        const upload = this.uploads.get(uploadId);

        if (upload === undefined || upload.clientId !== clientId) {
            throw new UploadError('upload-gone', 'That upload is no longer here. Save again.');
        }

        return upload;
    }
}
