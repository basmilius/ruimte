import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { FS_READ_MAX_TEXT_BYTES, type FsReadText, type FsReadTooLarge } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { readLargeText, textLimitFor } from './large-text';

const MB = 1024 * 1024;

const machine = (id: string, reachability: Endpoint['reachability']): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}:4210`,
    wsBaseUrl: `ws://${id}:4210`,
    reachability,
    daemonId: id,
    daemonPublicKey: null
});

const here = machine('here', 'loopback');
const studio = machine('studio', 'lan');

const tooLarge = (size: number): FsReadTooLarge => ({ kind: 'too-large', size, mtime: 1700 });

let fetched: string[];

beforeEach(() => {
    useEndpoints.getState().add(here);
    useEndpoints.getState().add(studio);
    fetched = [];
    spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return new Response('<p>a report</p>');
    }) as typeof fetch);
});

afterEach(() => {
    mock.restore();
    useEndpoints.getState().remove(here.id);
    useEndpoints.getState().remove(studio.id);
});

describe('text past the frame cap', () => {
    test('opens a file of 16 MB on this machine, over the file route', async () => {
        const read = await readLargeText(here.id, '/repo/report.html', tooLarge(16 * MB), null);
        expect(read).toEqual({ kind: 'text', text: '<p>a report</p>', encoding: 'utf-8', size: 16 * MB, mtime: 1700 });
        expect(fetched).toHaveLength(1);
        expect(fetched[0]).toStartWith('http://here:4210/fs/file?path=%2Frepo%2Freport.html');
    });

    test('leaves a file of 16 MB on another machine too large, without fetching it', async () => {
        expect(await readLargeText(studio.id, '/repo/report.html', tooLarge(16 * MB), null)).toEqual(tooLarge(16 * MB));
        expect(fetched).toEqual([]);
        expect(textLimitFor(studio.id, tooLarge(16 * MB))).toBe(8 * MB);
    });

    test('keeps a daemon that predates the route at its own cap', async () => {
        const old: FsReadTooLarge = { kind: 'too-large', size: 3 * MB };
        expect(await readLargeText(here.id, '/repo/report.html', old, null)).toEqual(old);
        expect(textLimitFor(here.id, old)).toBe(FS_READ_MAX_TEXT_BYTES);
    });

    test('takes bytes that are not UTF-8 as binary, never as lossy text', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9])));
        expect(await readLargeText(here.id, '/repo/legacy.txt', tooLarge(3 * MB), null)).toEqual({
            kind: 'binary',
            mime: 'application/octet-stream',
            size: 3 * MB,
            mtime: 1700
        });
    });

    test('keeps the text it has while the file is unchanged', async () => {
        const previous: FsReadText = { kind: 'text', text: 'kept', encoding: 'utf-8', size: 3 * MB, mtime: 1700 };
        expect(await readLargeText(here.id, '/repo/log.txt', tooLarge(3 * MB), previous)).toBe(previous);
        expect(fetched).toEqual([]);
    });
});
