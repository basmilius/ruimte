import { describe, expect, test } from 'bun:test';
import { retryingRename } from './busy-retry.ts';

function failing(codes: readonly (string | null)[]): { rename: (from: string, to: string) => Promise<void>; calls: number } {
    const state = {
        calls: 0,
        rename: async (): Promise<void> => {
            const code = codes[state.calls++];
            if (code !== null && code !== undefined) {
                throw Object.assign(new Error(code), { code });
            }
        }
    };
    return state;
}

describe('retryingRename', () => {
    test('tries again on Windows while the file is held, and moves once it is let go', async () => {
        const waits: number[] = [];
        const held = failing(['EBUSY', 'EPERM', 'EACCES', null]);
        await retryingRename(held.rename, { platform: 'win32', wait: async (ms) => void waits.push(ms) })('C:\\x\\a', 'C:\\x\\b');
        expect(held.calls).toBe(4);
        expect(waits).toEqual([20, 50, 100]);
    });

    test('gives up on Windows after a bounded number of tries, with the last error', async () => {
        const held = failing(Array(10).fill('EBUSY'));
        const move = retryingRename(held.rename, { platform: 'win32', wait: async () => undefined });
        await expect(move('C:\\x\\a', 'C:\\x\\b')).rejects.toMatchObject({ code: 'EBUSY' });
        expect(held.calls).toBe(6);
    });

    test('never retries an error that is not a held file', async () => {
        const held = failing(['EEXIST']);
        const move = retryingRename(held.rename, { platform: 'win32', wait: async () => undefined });
        await expect(move('C:\\x\\a', 'C:\\x\\b')).rejects.toMatchObject({ code: 'EEXIST' });
        expect(held.calls).toBe(1);
    });

    test('tries once on other platforms', async () => {
        const held = failing(['EBUSY', null]);
        const move = retryingRename(held.rename, { platform: 'darwin', wait: async () => undefined });
        await expect(move('/x/a', '/x/b')).rejects.toMatchObject({ code: 'EBUSY' });
        expect(held.calls).toBe(1);
    });
});
