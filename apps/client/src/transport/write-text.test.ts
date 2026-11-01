import { describe, expect, test } from 'bun:test';
import { FS_READ_MAX_TEXT_BYTES, FS_WRITE_PIECE_BYTES } from '@ruimte/contracts';
import { writeMachineText } from './write-text';

type Asked = { type: string; payload: Record<string, unknown> };

function machine(features: string[], failPiece = false): { transport: Parameters<typeof writeMachineText>[0]; asked: Asked[] } {
    const asked: Asked[] = [];
    const request = async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
        asked.push({ type, payload });

        if (type === 'fs.writeStart') {
            return { uploadId: 'upload' };
        }

        if (type === 'fs.writePiece' && failPiece) {
            throw new Error('The line dropped');
        }

        return type === 'fs.write' || type === 'fs.writeCommit' ? { size: 1, mtime: 2 } : {};
    };

    return { transport: { request, connection: { features } } as unknown as Parameters<typeof writeMachineText>[0], asked };
}

const LARGE = 'é'.repeat(FS_READ_MAX_TEXT_BYTES);

describe('a save to a machine', () => {
    test('goes in one frame when it fits', async () => {
        const { transport, asked } = machine(['fs.writeStart']);

        await writeMachineText(transport, '/a.txt', 'small', 1);

        expect(asked.map((each) => each.type)).toEqual(['fs.write']);
    });

    test('goes in pieces past one frame, whole and within a piece each', async () => {
        const { transport, asked } = machine(['fs.writeStart']);

        await writeMachineText(transport, '/a.txt', LARGE, 1);

        const pieces = asked.filter((each) => each.type === 'fs.writePiece').map((each) => Buffer.from(each.payload.data as string, 'base64'));

        expect(asked[0]).toEqual({ type: 'fs.writeStart', payload: { path: '/a.txt', size: FS_READ_MAX_TEXT_BYTES * 2, expectedMtime: 1 } });
        expect(pieces.every((piece) => piece.byteLength <= FS_WRITE_PIECE_BYTES)).toBe(true);
        expect(pieces.reduce((total, piece) => total + piece.byteLength, 0)).toBe(FS_READ_MAX_TEXT_BYTES * 2);
        expect(asked.at(-1)?.type).toBe('fs.writeCommit');
    });

    test('refuses past one frame on a machine that takes no pieces, and asks it nothing', async () => {
        const { transport, asked } = machine([]);

        await expect(writeMachineText(transport, '/a.txt', LARGE, 1)).rejects.toThrow();
        expect(asked).toEqual([]);
    });

    test('lets the machine drop an upload a piece of failed, and never commits it', async () => {
        const { transport, asked } = machine(['fs.writeStart'], true);

        await expect(writeMachineText(transport, '/a.txt', LARGE, 1)).rejects.toThrow('The line dropped');
        expect(asked.map((each) => each.type)).toContain('fs.writeAbort');
        expect(asked.map((each) => each.type)).not.toContain('fs.writeCommit');
    });
});
