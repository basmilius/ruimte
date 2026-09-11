import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { FS_FILE_PATH, handleFsFileRequest, parseByteRange } from './file-route.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

// An MP4 head (a box length, `ftyp`, the brand) with enough bytes behind it to ask for a slice of.
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(100, 0x2a)]);

// No handshake in these tests, so a credential is only ever a session token.
const OPTIONS = { allowedOrigins: [], requireToken: false, tickets: { ticketSession: () => null } };

let root: string;
let auth: AuthStore;

const ask = (path: string, remote = '127.0.0.1', init?: RequestInit): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}?v=1-1&path=${encodeURIComponent(join(root, path))}`);
    return handleFsFileRequest(new Request(url, init), url, remote, auth, OPTIONS);
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-fs-file-route-'));
    await writeFile(join(root, 'icon.png'), PNG);
    auth = new AuthStore(join(root, 'home'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the file route', () => {
    test('serves the bytes to a loopback client with headers that keep them inert', async () => {
        const response = await ask('icon.png');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toContain('immutable');
        expect(response.headers.get('content-disposition')).toBe('inline');
        // Only an SVG can carry script; a PNG needs no policy of its own.
        expect(response.headers.get('content-security-policy')).toBeNull();
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PNG));
    });

    test('an SVG comes with a policy that allows nothing but its own styles', async () => {
        await writeFile(join(root, 'mark.svg'), SVG);
        const response = await ask('mark.svg');
        expect(response.headers.get('content-type')).toBe('image/svg+xml');
        expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    });

    test('serves nothing but the images and video the viewer draws', async () => {
        await writeFile(join(root, 'notes.md'), '# hello');
        await writeFile(join(root, 'paper.pdf'), '%PDF-1.7\n');
        expect((await ask('notes.md')).status).toBe(404);
        expect((await ask('paper.pdf')).status).toBe(404);
        expect((await ask('nothing.png')).status).toBe(404);
    });

    test('a video comes with the ranges a player needs', async () => {
        await writeFile(join(root, 'clip.mp4'), MP4);
        const whole = await ask('clip.mp4');
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('video/mp4');
        expect(whole.headers.get('accept-ranges')).toBe('bytes');
        expect((await whole.arrayBuffer()).byteLength).toBe(MP4.length);

        const slice = await ask('clip.mp4', '127.0.0.1', { headers: { range: 'bytes=16-31' } });
        expect(slice.status).toBe(206);
        expect(slice.headers.get('content-range')).toBe(`bytes 16-31/${MP4.length}`);
        expect(slice.headers.get('content-length')).toBe('16');
        expect(new Uint8Array(await slice.arrayBuffer())).toEqual(new Uint8Array(MP4.subarray(16, 32)));

        const tail = await ask('clip.mp4', '127.0.0.1', { headers: { range: 'bytes=100-' } });
        expect(tail.status).toBe(206);
        expect(tail.headers.get('content-range')).toBe(`bytes 100-${MP4.length - 1}/${MP4.length}`);

        const past = await ask('clip.mp4', '127.0.0.1', { headers: { range: `bytes=${MP4.length}-` } });
        expect(past.status).toBe(416);
        expect(past.headers.get('content-range')).toBe(`bytes */${MP4.length}`);
    });

    test('reads what a Range header asks for', () => {
        expect(parseByteRange(null, 100)).toBeNull();
        expect(parseByteRange('', 100)).toBeNull();
        // Several ranges at once are answered with the whole file, which is always allowed.
        expect(parseByteRange('bytes=0-9, 20-29', 100)).toBeNull();
        expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
        expect(parseByteRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
        // A player may ask past the end; what is there is what it gets.
        expect(parseByteRange('bytes=90-999', 100)).toEqual({ start: 90, end: 99 });
        expect(parseByteRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
        expect(parseByteRange('bytes=-999', 100)).toEqual({ start: 0, end: 99 });
        expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
        expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
        expect(parseByteRange('bytes=0-0', 0)).toBe('unsatisfiable');
        expect(parseByteRange('bytes=20-10', 100)).toBe('unsatisfiable');
    });

    test('a client from elsewhere needs the token the socket needs', async () => {
        const url = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}?path=${encodeURIComponent(join(root, 'icon.png'))}`);
        const refused = await handleFsFileRequest(new Request(url), url, '192.168.1.20', auth, OPTIONS);
        expect(refused.status).toBe(401);

        const paired = await auth.pair(auth.issuePairingToken(), { label: 'a laptop' });
        url.searchParams.set('token', paired!.sessionToken!);
        const allowed = await handleFsFileRequest(new Request(url), url, '192.168.1.20', auth, OPTIONS);
        expect(allowed.status).toBe(200);
    });

    test('a page on another origin is refused before the file is even looked at', async () => {
        expect((await ask('icon.png', '127.0.0.1', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    });

    test('answers 405 for another method, 400 without a path and 404 for another route', async () => {
        expect((await ask('icon.png', '127.0.0.1', { method: 'DELETE' })).status).toBe(405);

        const bare = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}`);
        expect((await handleFsFileRequest(new Request(bare), bare, '127.0.0.1', auth, OPTIONS)).status).toBe(400);

        const elsewhere = new URL('http://127.0.0.1:4210/fs/other');
        expect((await handleFsFileRequest(new Request(elsewhere), elsewhere, '127.0.0.1', auth, OPTIONS)).status).toBe(404);
    });
});
