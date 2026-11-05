import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_MAX_BYTES, BYTES_CHUNK_MAX, decodeBytesReply, type ByteResource } from '@ruimte/contracts';
import { MachineHome } from '../disk/machine-home.ts';
import { Dispatcher } from '../dispatcher.ts';
import { readServedFile } from '../fs/read.ts';
import { registerBytesHandlers } from '../handlers/bytes.ts';
import type { ClientConnection } from '../wire.ts';
import { BytesError, readBytes, type ByteSources } from './read-bytes.ts';

let folder: string;
let picture: Uint8Array;
let sources: ByteSources;
let read: string[] = [];

beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'ruimte-bytes-'));
    // A GIF header is all the sniff looks at; the rest is noise, enough for three pieces.
    picture = new Uint8Array(BYTES_CHUNK_MAX * 2 + 1234);
    crypto.getRandomValues(picture.subarray(0, 65_536));
    picture.set(new TextEncoder().encode('GIF89a'));
    await writeFile(join(folder, 'picture.gif'), picture);
    await writeFile(join(folder, 'notes.txt'), 'not an image');
    await writeFile(join(folder, 'a.out'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
    sources = {
        attachment: async (chatId, id) =>
            chatId === 'chat-1' && id === 'a1'
                ? { id: 'a1', name: 'picture.gif', mime: 'image/gif', size: picture.length, path: join(folder, 'picture.gif') }
                : null,
        projectIcon: async (projectId) => (projectId === 'p1' ? { path: join(folder, 'picture.gif'), mime: 'image/gif' } : null),
        file: readServedFile,
        bundleRead: async (bundleId) => void read.push(bundleId),
        bundle: async (bundleId) => (bundleId === 'bundle-one' ? join(folder, 'one.bundle') : bundleId === 'bundle-huge' ? join(folder, 'huge.bundle') : null)
    };
    await writeFile(join(folder, 'one.bundle'), 'a bundle');
    await writeFile(join(folder, 'huge.bundle'), 'x');
    // Sparse, so the file costs no disk.
    await truncate(join(folder, 'huge.bundle'), BUNDLE_MAX_BYTES + 1);
});

afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
});

async function readAll(resource: ByteResource): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let offset = 0;
    let size = Number.POSITIVE_INFINITY;
    const versions = new Set<string>();
    while (offset < size) {
        const piece = await readBytes(sources, { resource, offset, length: BYTES_CHUNK_MAX });
        size = piece.size;
        versions.add(piece.version);
        const bytes = Buffer.from(piece.bytes);
        parts.push(bytes);
        offset += bytes.length;
    }
    expect(versions.size).toBe(1);
    expect(parts.length).toBe(3);
    return Buffer.concat(parts);
}

function bytesDispatcher(): Dispatcher {
    const dispatcher = new Dispatcher();
    registerBytesHandlers(dispatcher, sources, new MachineHome(join(folder, 'home')));
    return dispatcher;
}

describe('readBytes', () => {
    test('a file comes back whole, one piece at a time', async () => {
        expect(await readAll({ kind: 'file', path: join(folder, 'picture.gif') })).toEqual(picture);
    });

    test('an attachment and a project icon come from the same lookups the routes use', async () => {
        expect(await readAll({ kind: 'attachment', chatId: 'chat-1', attachmentId: 'a1' })).toEqual(picture);
        expect(await readAll({ kind: 'projectIcon', projectId: 'p1', theme: 'dark' })).toEqual(picture);
    });

    test('a piece is no larger than asked and says what it is', async () => {
        const piece = await readBytes(sources, { resource: { kind: 'file', path: join(folder, 'picture.gif') }, offset: 10, length: 100 });
        expect(Buffer.from(piece.bytes)).toEqual(Buffer.from(picture.subarray(10, 110)));
        expect(piece).toMatchObject({ mime: 'image/gif', size: picture.length, offset: 10 });
    });

    test('text comes as plain text, whatever its name', async () => {
        const piece = await readBytes(sources, { resource: { kind: 'file', path: join(folder, 'notes.txt') }, offset: 0, length: 100 });
        expect(new TextDecoder().decode(piece.bytes)).toBe('not an image');
        expect(piece.mime).toBe('text/plain; charset=utf-8');
    });

    test('a binary that is not media is refused like the route refuses it', async () => {
        const refused = readBytes(sources, { resource: { kind: 'file', path: join(folder, 'a.out') }, offset: 0, length: 10 });
        await expect(refused).rejects.toBeInstanceOf(BytesError);
        await expect(refused).rejects.toMatchObject({ code: 'not-found' });
    });

    test('a path, an attachment or a project nobody knows is not found', async () => {
        for (const resource of [
            { kind: 'file', path: join(folder, 'missing.gif') },
            { kind: 'attachment', chatId: 'chat-1', attachmentId: 'nope' },
            { kind: 'projectIcon', projectId: 'p2', theme: 'light' }
        ] as ByteResource[]) {
            await expect(readBytes(sources, { resource, offset: 0, length: 10 })).rejects.toMatchObject({ code: 'not-found' });
        }
    });

    test('a piece deep inside a file of 100 MB is read without the rest of it', async () => {
        const path = join(folder, 'long.gif');
        await writeFile(path, 'GIF89a');
        // Sparse, so the file costs no disk.
        await truncate(path, 100 * 1024 * 1024);
        const piece = await readBytes(sources, { resource: { kind: 'file', path }, offset: 90 * 1024 * 1024, length: 10 });
        expect(piece).toMatchObject({ size: 100 * 1024 * 1024, offset: 90 * 1024 * 1024 });
        expect(Buffer.from(piece.bytes)).toHaveLength(10);
    });

    test('a bundle this machine wrote is served in pieces, and one over the cap is not', async () => {
        const piece = await readBytes(sources, { resource: { kind: 'bundle', bundleId: 'bundle-one' }, offset: 2, length: 100 });
        expect(new TextDecoder().decode(piece.bytes)).toBe('bundle');
        expect(piece).toMatchObject({ mime: 'application/x-git-bundle', size: 8 });
        await expect(readBytes(sources, { resource: { kind: 'bundle', bundleId: 'bundle-huge' }, offset: 0, length: 10 })).rejects.toMatchObject({
            code: 'bundle-too-large'
        });
        await expect(readBytes(sources, { resource: { kind: 'bundle', bundleId: 'nope' }, offset: 0, length: 10 })).rejects.toMatchObject({
            code: 'not-found'
        });
    });

    test('a bundle is reported read once its last byte was served, and not before', async () => {
        read = [];
        const resource = { kind: 'bundle', bundleId: 'bundle-one' } as const;
        await readBytes(sources, { resource, offset: 0, length: 4 });
        expect(read).toEqual([]);
        await readBytes(sources, { resource, offset: 4, length: 4 });
        expect(read).toEqual(['bundle-one']);
    });

    test('an archive entry comes in pieces of the entry, with the version of the archive', async () => {
        const entry = new Uint8Array(BYTES_CHUNK_MAX + 10).fill(7);
        const withEntries: ByteSources = {
            ...sources,
            archiveEntry: async (path, name) => {
                expect([path, name]).toEqual([join(folder, 'site.zip'), 'big.bin']);
                return { bytes: entry, mime: 'application/octet-stream', version: '5-100' };
            }
        };
        const resource = { kind: 'file', path: join(folder, 'site.zip'), entry: 'big.bin' } as const;
        const first = await readBytes(withEntries, { resource, offset: 0, length: BYTES_CHUNK_MAX });
        expect(first).toMatchObject({ size: entry.length, version: '5-100', mime: 'application/octet-stream' });
        expect(first.bytes).toHaveLength(BYTES_CHUNK_MAX);
        expect((await readBytes(withEntries, { resource, offset: BYTES_CHUNK_MAX, length: BYTES_CHUNK_MAX })).bytes).toHaveLength(10);
        await expect(readBytes(withEntries, { resource, offset: entry.length + 1, length: 1 })).rejects.toMatchObject({ code: 'bad-offset' });
        await expect(readBytes(sources, { resource, offset: 0, length: 1 })).rejects.toMatchObject({ code: 'not-found' });
    });

    test('an offset past the end is refused', async () => {
        await expect(
            readBytes(sources, { resource: { kind: 'file', path: join(folder, 'picture.gif') }, offset: picture.length + 1, length: 10 })
        ).rejects.toMatchObject({ code: 'bad-offset' });
    });

    test('the handler answers a refusal with its code on the wire', async () => {
        const dispatcher = bytesDispatcher();
        const frames: unknown[] = [];
        const client: ClientConnection = { id: 'c1', send: (frame) => frames.push(frame) };
        await dispatcher.handle(
            client,
            JSON.stringify({ id: '1', type: 'bytes.read', payload: { resource: { kind: 'file', path: join(folder, 'a.out') }, offset: 0, length: 10 } })
        );
        expect(frames[0]).toMatchObject({ id: '1', ok: false, error: { code: 'not-found' } });
    });

    const readRequest = (binary?: boolean): string =>
        JSON.stringify({
            id: '2',
            type: 'bytes.read',
            payload: { resource: { kind: 'file', path: join(folder, 'picture.gif') }, offset: 10, length: 100, binary }
        });

    test('a client that asks for a binary reply gets the bytes as they are, with the header in front', async () => {
        const dispatcher = bytesDispatcher();
        const frames: unknown[] = [];
        const binary: Uint8Array[] = [];
        const client: ClientConnection = { id: 'c1', send: (frame) => frames.push(frame), sendBinary: (frame) => binary.push(frame) };
        await dispatcher.handle(client, readRequest(true));
        expect(frames).toEqual([]);
        const reply = decodeBytesReply(binary[0]!);
        expect(reply).toMatchObject({ id: '2', result: { mime: 'image/gif', size: picture.length, offset: 10 } });
        expect(reply?.bytes).toEqual(picture.slice(10, 110));
    });

    test('a client that did not ask, or a channel without binary frames, gets base64 in JSON', async () => {
        const dispatcher = bytesDispatcher();
        for (const [binary, sendBinary] of [
            [undefined, true],
            [true, false]
        ] as const) {
            const frames: Array<{ result?: { data?: string } }> = [];
            const client: ClientConnection = {
                id: 'c1',
                send: (frame) => frames.push(frame as (typeof frames)[number]),
                ...(sendBinary ? { sendBinary: () => undefined } : {})
            };
            await dispatcher.handle(client, readRequest(binary));
            expect(Buffer.from(frames[0]?.result?.data ?? '', 'base64')).toEqual(Buffer.from(picture.subarray(10, 110)));
        }
    });
});
