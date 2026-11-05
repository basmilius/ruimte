import { afterEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { httpUrlFor, readMachineFile, type MachineResource } from './machine-url';

const studio: Endpoint = {
    id: 'studio',
    label: 'Studio',
    httpBaseUrl: 'http://studio.local:4210',
    wsBaseUrl: 'ws://studio.local:4210',
    reachability: 'lan',
    daemonId: 'studio',
    daemonPublicKey: null
};

const attachment: MachineResource = { kind: 'attachment', chatId: 'chat-1', attachmentId: 'shot.png' };

afterEach(() => {
    useEndpoints.getState().remove(studio.id);
});

describe('the HTTP route to bytes on a machine', () => {
    test('is on the machine the bytes belong to', () => {
        useEndpoints.getState().add(studio);
        expect(httpUrlFor(studio.id, attachment)).toBe('http://studio.local:4210/attachments/chat-1/shot.png');
    });

    test('is not there for a machine this client no longer knows, rather than asked of the active one', () => {
        expect(httpUrlFor('forgotten', attachment)).toBeNull();
    });
});

describe('reading a file whole over HTTP', () => {
    const realFetch = globalThis.fetch;
    const file = { path: '/work/big.bin', mtime: 1, size: 0 };
    const MB = 1024 * 1024;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    // A body in 1 MB chunks, counting what the reader pulled, with the length header only when asked.
    function serve(megabytes: number, declared: boolean): { pulled: () => number } {
        let pulled = 0;
        globalThis.fetch = (async () => {
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (pulled === megabytes) {
                        controller.close();
                        return;
                    }
                    pulled += 1;
                    controller.enqueue(new Uint8Array(MB));
                }
            });
            return new Response(body, { headers: declared ? { 'content-length': String(megabytes * MB) } : {} });
        }) as unknown as typeof fetch;

        return { pulled: () => pulled };
    }

    test('stops a body without a length once it passes the limit', async () => {
        useEndpoints.getState().add(studio);
        const body = serve(64, false);

        await expect(readMachineFile(studio.id, file, 4 * MB)).rejects.toThrow('too large');
        expect(body.pulled()).toBeLessThan(8);
    });

    test('refuses a body whose length says it is larger before reading it', async () => {
        useEndpoints.getState().add(studio);
        const body = serve(64, true);

        await expect(readMachineFile(studio.id, file, 4 * MB)).rejects.toThrow('too large');
        expect(body.pulled()).toBeLessThan(2);
    });

    test('hands back a body within the limit whole', async () => {
        useEndpoints.getState().add(studio);
        serve(3, false);

        expect((await readMachineFile(studio.id, file, 4 * MB)).byteLength).toBe(3 * MB);
    });
});
