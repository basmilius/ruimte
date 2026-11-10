import { afterEach, describe, expect, test } from 'bun:test';
import { usePeerLapse } from './peer-lapse';
import { linkToPeer, linkToPeerOrMark, swapPeerLinker } from './peer-linker';

const SELF = { request: async () => ({}) as never };

let restore: () => void = () => undefined;

afterEach(() => {
    restore();
    usePeerLapse.setState({ lapsed: {} });
});

describe('linking this machine to another', () => {
    test('joins an attempt that runs for the same machine instead of starting another', async () => {
        let attempts = 0;
        const releases: Array<() => void> = [];
        restore = swapPeerLinker(async () => {
            attempts += 1;
            await new Promise<void>((resolve) => releases.push(resolve));
        });
        const first = linkToPeer('machine-b', SELF);
        const second = linkToPeerOrMark('machine-b', SELF);
        const other = linkToPeer('machine-c', SELF);
        expect(attempts).toBe(2);
        for (const release of releases) {
            release();
        }
        await first;
        expect(await second).toBe(true);
        await other;
    });

    test('starts a new attempt once the last one is over, also after it failed', async () => {
        let attempts = 0;
        restore = swapPeerLinker(async () => {
            attempts += 1;
            throw new Error('Sign in first');
        });
        await expect(linkToPeer('machine-b', SELF)).rejects.toThrow('Sign in first');
        expect(await linkToPeerOrMark('machine-b', SELF)).toBe(false);
        expect(attempts).toBe(2);
        expect(usePeerLapse.getState().lapsed['machine-b']).toBe(true);
    });

    test('hands one failure to everyone who joined the attempt', async () => {
        restore = swapPeerLinker(async () => {
            throw new Error('Sign in first');
        });
        const results = await Promise.allSettled([linkToPeer('machine-b', SELF), linkToPeer('machine-b', SELF)]);
        expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    });
});
