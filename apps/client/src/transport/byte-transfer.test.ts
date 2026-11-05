import { describe, expect, test } from 'bun:test';
import type { BytesReadPayload } from '@ruimte/contracts';
import { readResource } from './byte-transfer';
import type { BytesPiece } from './piece';
import { blobTypeFor } from './piece';

const RESOURCE = { kind: 'file', path: '/tmp/picture.gif' } as const;

/* A daemon that serves `bytes` in pieces and counts what it was asked, optionally changing the file under a read. */
function daemon(bytes: Uint8Array<ArrayBuffer>, mime = 'image/gif') {
    const asked: BytesReadPayload[] = [];
    let version = '1-1';
    let content = bytes;
    const read = async (payload: BytesReadPayload): Promise<BytesPiece> => {
        asked.push(payload);
        const slice = content.subarray(payload.offset, payload.offset + payload.length);
        return { mime, size: content.length, version, offset: payload.offset, bytes: new Uint8Array(slice) };
    };
    return {
        read,
        asked,
        change: (next: Uint8Array<ArrayBuffer>) => {
            content = next;
            version = `${Number(version.split('-')[0]) + 1}-${next.length}`;
        }
    };
}

function random(size: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
        bytes[i] = (i * 31 + 7) % 256;
    }
    return bytes;
}

describe('readResource', () => {
    test('the pieces arrive one after the other and join into the whole file', async () => {
        const bytes = random(2_500);
        const fake = daemon(bytes);
        const blob = await readResource(fake.read, RESOURCE, { chunkBytes: 1_000 });
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
        expect(fake.asked.map((payload) => payload.offset)).toEqual([0, 1_000, 2_000]);
        expect(blob.type).toBe('image/gif');
    });

    test('a few pieces are on their way at once, never more than the output gate allows', async () => {
        const bytes = random(10 * 262_144);
        const fake = daemon(bytes);
        let inFlight = 0;
        let most = 0;
        let released = false;
        const waiting: Array<() => void> = [];
        const started = Promise.withResolvers<void>();
        const loading = readResource(async (payload) => {
            inFlight += 1;
            most = Math.max(most, inFlight);
            if (payload.offset > 0 && !released) {
                await new Promise<void>((resolve) => {
                    waiting.push(resolve);
                    if (waiting.length === 2) {
                        started.resolve();
                    }
                });
            }
            inFlight -= 1;
            return fake.read(payload);
        }, RESOURCE);
        await started.promise;
        expect(waiting).toHaveLength(2);
        expect(most).toBe(2);
        expect(most * Math.ceil(fake.asked[0]!.length / 3) * 4).toBeLessThan(1_048_576);
        released = true;
        waiting.splice(0).forEach((release) => release());
        const blob = await loading;
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
        expect(fake.asked.map((payload) => payload.offset)).toEqual([
            0, 262_144, 524_288, 786_432, 1_048_576, 1_310_720, 1_572_864, 1_835_008, 2_097_152, 2_359_296
        ]);
    });

    test('one piece in flight asks for the next only once the one before is in', async () => {
        const fake = daemon(random(3_000));
        let inFlight = 0;
        let most = 0;
        await readResource(
            async (payload) => {
                inFlight += 1;
                most = Math.max(most, inFlight);
                await new Promise((resolve) => setImmediate(resolve));
                inFlight -= 1;
                return fake.read(payload);
            },
            RESOURCE,
            { chunkBytes: 500, piecesInFlight: 1 }
        );
        expect(most).toBe(1);
    });

    test('pieces that arrive out of order still join in order', async () => {
        const bytes = random(3_000);
        const fake = daemon(bytes);
        const blob = await readResource(
            async (payload) => {
                // The later the piece, the sooner it is back.
                for (let i = 0; i < 10 - payload.offset / 500; i += 1) {
                    await new Promise((resolve) => setImmediate(resolve));
                }
                return fake.read(payload);
            },
            RESOURCE,
            { chunkBytes: 500 }
        );
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    });

    test('a piece shorter than asked drops the ones asked after it and goes on from where it ended', async () => {
        const bytes = random(3_000);
        const fake = daemon(bytes);
        const blob = await readResource(
            async (payload) => {
                const piece = await fake.read(payload);
                return payload.offset === 1_000 ? { ...piece, bytes: piece.bytes.subarray(0, 200) } : piece;
            },
            RESOURCE,
            { chunkBytes: 1_000 }
        );
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
        expect(fake.asked.map((payload) => payload.offset)).toEqual([0, 1_000, 2_000, 1_200, 2_200]);
    });

    test('a failing piece is the error, and the pieces still on their way are left without a complaint', async () => {
        const fake = daemon(random(5_000));
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            await expect(
                readResource(
                    async (payload) => {
                        await new Promise((resolve) => setImmediate(resolve));
                        if (payload.offset >= 1_000) {
                            throw new Error(`gone at ${payload.offset}`);
                        }
                        return fake.read(payload);
                    },
                    RESOURCE,
                    { chunkBytes: 1_000 }
                )
            ).rejects.toThrow('gone at 1000');
            await new Promise((resolve) => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('an empty file is one request and an empty blob', async () => {
        const fake = daemon(new Uint8Array(0));
        const blob = await readResource(fake.read, RESOURCE);
        expect(blob.size).toBe(0);
        expect(fake.asked).toHaveLength(1);
    });

    test('a piece extending past the declared file size cannot become a successful blob', async () => {
        const fake = daemon(random(2_000));
        await expect(
            readResource(
                async (payload) => {
                    const piece = await fake.read(payload);
                    return payload.offset === 0 ? { ...piece, size: 100 } : piece;
                },
                RESOURCE,
                { chunkBytes: 1_000, restarts: 0 }
            )
        ).rejects.toThrow('The file changed while it was loading');
    });

    test('pieces with inconsistent metadata restart instead of mixing resources', async () => {
        for (const changed of [{ size: 3_000 }, { mime: 'text/plain' }]) {
            const fake = daemon(random(2_000));
            await expect(
                readResource(
                    async (payload) => {
                        const piece = await fake.read(payload);
                        return payload.offset === 0 ? piece : { ...piece, ...changed };
                    },
                    RESOURCE,
                    { chunkBytes: 1_000, restarts: 0 }
                )
            ).rejects.toThrow('The file changed while it was loading');
        }
    });

    test('a file larger than the cap stops after the first piece and says how large it is', async () => {
        const fake = daemon(random(5_000));
        await expect(readResource(fake.read, RESOURCE, { chunkBytes: 1_000, maxBytes: 2_000 })).rejects.toThrow(/too large/);
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
