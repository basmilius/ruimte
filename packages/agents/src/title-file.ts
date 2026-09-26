import { open } from 'node:fs/promises';
import { SUGGESTED_TITLE_LIMIT } from '@ruimte/agent-contracts';

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/*
 * A model wrote this, so it is text and nothing else: no control characters, no line breaks, one
 * space between words and a length a header can hold.
 */
export const cleanTitle = (raw: unknown): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }
    const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    if (text === '') {
        return null;
    }
    return text.length <= SUGGESTED_TITLE_LIMIT ? text : `${text.slice(0, SUGGESTED_TITLE_LIMIT - 1).trimEnd()}…`;
};

/*
 * Hands every whole line between `from` and `size` of a file that only grows to `onLine`, and
 * answers where the next read starts: just past the last whole line, so a line still being written
 * is read once it is done. In pieces, so a file of hundreds of megabytes is never one buffer, and cut
 * on bytes, since a piece may end halfway into a character.
 */
export const readLines = async (path: string, from: number, size: number, chunkBytes: number, onLine: (line: string) => void): Promise<number> => {
    const handle = await open(path, 'r');
    let offset = from;
    try {
        let carry = Buffer.alloc(0);
        let position = from;
        while (position < size) {
            const piece = Buffer.alloc(Math.min(chunkBytes, size - position));
            const { bytesRead } = await handle.read(piece, 0, piece.length, position);
            if (bytesRead === 0) {
                break;
            }
            position += bytesRead;
            const bytes = Buffer.concat([carry, piece.subarray(0, bytesRead)]);
            const end = bytes.lastIndexOf(0x0a);
            if (end < 0) {
                carry = bytes;
                continue;
            }
            for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
                onLine(line);
            }
            carry = bytes.subarray(end + 1);
            offset = position - carry.length;
        }
    } finally {
        await handle.close();
    }
    return offset;
};
