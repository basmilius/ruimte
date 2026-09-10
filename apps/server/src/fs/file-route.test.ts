import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { FS_FILE_PATH, handleFsFileRequest } from './file-route.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const OPTIONS = { allowedOrigins: [], requireToken: false };

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

    test('serves nothing that is not an image', async () => {
        await writeFile(join(root, 'notes.md'), '# hello');
        await writeFile(join(root, 'paper.pdf'), '%PDF-1.7\n');
        expect((await ask('notes.md')).status).toBe(404);
        expect((await ask('paper.pdf')).status).toBe(404);
        expect((await ask('nothing.png')).status).toBe(404);
    });

    test('a client from elsewhere needs the token the socket needs', async () => {
        const url = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}?path=${encodeURIComponent(join(root, 'icon.png'))}`);
        const refused = await handleFsFileRequest(new Request(url), url, '192.168.1.20', auth, OPTIONS);
        expect(refused.status).toBe(401);

        const paired = await auth.pair(auth.issuePairingToken(), 'a laptop');
        url.searchParams.set('token', paired!.sessionToken);
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
