import { describe, expect, test } from 'bun:test';
import type { BytesReadPayload, BytesReadResult } from '@ruimte/contracts';
import { blobTypeFor, readResource } from './byte-transfer';

const RESOURCE = { kind: 'file', path: '/tmp/picture.gif' } as const;

/* A daemon that serves `bytes` in pieces and counts what it was asked, optionally changing the file under a read. */
const daemon = (bytes: Uint8Array<ArrayBuffer>, mime = 'image/gif') => {
    const asked: BytesReadPayload[] = [];
    let version = '1-1';
    let content = bytes;
    const read = async (payload: BytesReadPayload): Promise<BytesReadResult> => {
        asked.push(payload);
        const slice = content.subarray(payload.offset, payload.offset + payload.length);
        return { mime, size: content.length, version, offset: payload.offset, data: Buffer.from(slice).toString('base64') };
    };
    return {
        read,
        asked,
        change: (next: Uint8Array<ArrayBuffer>) => {
            content = next;
            version = `${Number(version.split('-')[0]) + 1}-${next.length}`;
        }
    };
};

const random = (size: number): Uint8Array<ArrayBuffer> => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
        bytes[i] = (i * 31 + 7) % 256;
    }
    return bytes;
};

describe('readResource', () => {
    test('the pieces arrive one after the other and join into the whole file', async () => {
        const bytes = random(2_500);
        const fake = daemon(bytes);
        const blob = await readResource(fake.read, RESOURCE, { chunkBytes: 1_000 });
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
        expect(fake.asked.map((payload) => payload.offset)).toEqual([0, 1_000, 2_000]);
        expect(blob.type).toBe('image/gif');
    });

    test('the next piece is asked for only once the one before is in', async () => {
        const fake = daemon(random(3_000));
        let inFlight = 0;
        let most = 0;
        await readResource(
            async (payload) => {
                inFlight += 1;
                most = Math.max(most, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 1));
                inFlight -= 1;
                return fake.read(payload);
            },
            RESOURCE,
            { chunkBytes: 500 }
        );
        expect(most).toBe(1);
    });

    test('an empty file is one request and an empty blob', async () => {
        const fake = daemon(new Uint8Array(0));
        const blob = await readResource(fake.read, RESOURCE);
        expect(blob.size).toBe(0);
        expect(fake.asked).toHaveLength(1);
    });

    test('a file larger than the cap stops after the first piece and says how large it is', async () => {
        const fake = daemon(random(5_000));
        await expect(readResource(fake.read, RESOURCE, { chunkBytes: 1_000, maxBytes: 2_000 })).rejects.toThrow(/at most/);
        expect(fake.asked).toHaveLength(1);
    });

    test('a file that changes halfway is read again from the start', async () => {
        const fake = daemon(random(2_000));
        const next = random(1_500).reverse();
        let changed = false;
        const blob = await readResource(
            async (payload) => {
                if (payload.offset === 1_000 && !changed) {
                    changed = true;
                    fake.change(next);
                }
                return fake.read(payload);
            },
            RESOURCE,
            { chunkBytes: 1_000 }
        );
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(next);
    });

    test('a file that keeps changing is a failure rather than a mix of two versions', async () => {
        const fake = daemon(random(2_000));
        await expect(
            readResource(
                async (payload) => {
                    if (payload.offset > 0) {
                        fake.change(random(2_000));
                    }
                    return fake.read(payload);
                },
                RESOURCE,
                { chunkBytes: 1_000 }
            )
        ).rejects.toThrow('The file changed while it was loading');
    });

    test('a refusal from the daemon is the error the caller sees', async () => {
        await expect(
            readResource(async () => {
                throw new Error('Not a file this machine serves');
            }, RESOURCE)
        ).rejects.toThrow('Not a file this machine serves');
    });

    test('only types a browser draws without running anything keep their mime', () => {
        expect(blobTypeFor('image/png')).toBe('image/png');
        expect(blobTypeFor('image/svg+xml')).toBe('image/svg+xml');
        expect(blobTypeFor('video/mp4')).toBe('video/mp4');
        expect(blobTypeFor('text/html')).toBe('application/octet-stream');
        expect(blobTypeFor('application/javascript')).toBe('application/octet-stream');
    });
});
