import { FS_READ_MAX_TEXT_BYTES, FS_WRITE_MAX_BYTES, FS_WRITE_PIECE_BYTES, type FsWriteResult } from '@ruimte/contracts';
import i18next from 'i18next';
import { base64Of } from '@/base64';
import { TransportError, type Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';

// As many as `bytes.read` has on their way: enough to fill a slow line, and never a queue a terminal waits behind.
const PIECES_IN_FLIGHT = 2;

type WritingTransport = Pick<Transport, 'request' | 'connection'>;

/* The largest text a save can carry to this machine. */
export function textWriteLimit(answersPieces: boolean): number {
    return answersPieces ? FS_WRITE_MAX_BYTES : FS_READ_MAX_TEXT_BYTES;
}

/* Saves text over a file read at `expectedMtime`, in one frame when it fits and in pieces when it does not. */
export async function writeMachineText(transport: WritingTransport, path: string, text: string, expectedMtime: number): Promise<FsWriteResult> {
    const encoded = new TextEncoder().encode(text);

    if (encoded.byteLength <= FS_READ_MAX_TEXT_BYTES) {
        return transport.request('fs.write', { path, text, expectedMtime });
    }

    if (encoded.byteLength > textWriteLimit(machineAnswers(transport.connection, 'fs.writeStart'))) {
        throw new TransportError('too-large', i18next.t('panels:file.edit.tooLargeToSave'));
    }

    const { uploadId } = await transport.request('fs.writeStart', { path, size: encoded.byteLength, expectedMtime });
    let next = 0;

    const sendPieces = async (): Promise<void> => {
        while (next < encoded.byteLength) {
            const offset = next;

            next += FS_WRITE_PIECE_BYTES;
            await transport.request('fs.writePiece', { uploadId, offset, data: base64Of(encoded.subarray(offset, offset + FS_WRITE_PIECE_BYTES)) });
        }
    };

    try {
        await Promise.all(Array.from({ length: PIECES_IN_FLIGHT }, sendPieces));
    } catch (error) {
        void transport.request('fs.writeAbort', { uploadId }).catch(() => undefined);

        throw error;
    }

    return transport.request('fs.writeCommit', { uploadId });
}
