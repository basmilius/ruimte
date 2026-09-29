import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { bytesResponse, guardBytesRequest, parseByteRange } from './byte-route.ts';

// What the desktop app on this machine presents; a loopback address alone gets nothing.
const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { allowedOrigins: [], localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };
const URL_OF_A_FILE = 'http://127.0.0.1:4210/fs/file?path=%2Ftmp%2Ficon.png';

const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
const SVG = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>']);

let root: string;
let auth: AuthStore;

const local = (init?: RequestInit): Request =>
    new Request(URL_OF_A_FILE, { ...init, headers: { authorization: `Bearer ${LOCAL_SECRET}`, ...(init?.headers as Record<string, string>) } });

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-byte-route-'));
    auth = new AuthStore(join(root, 'home'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('guardBytesRequest', () => {
    test('lets the local secret read with GET and HEAD, and answers 405 for another method', async () => {
        expect(await guardBytesRequest(local(), '127.0.0.1', auth, OPTIONS)).toBeNull();
        expect(await guardBytesRequest(local({ method: 'HEAD' }), '127.0.0.1', auth, OPTIONS)).toBeNull();
        expect((await guardBytesRequest(local({ method: 'DELETE' }), '127.0.0.1', auth, OPTIONS))?.status).toBe(405);
    });

    test('a loopback address without a credential gets nothing', async () => {
        // A tunnel on this machine looks exactly like this.
        expect((await guardBytesRequest(new Request(URL_OF_A_FILE), '127.0.0.1', auth, OPTIONS))?.status).toBe(401);
    });

    test('a client from elsewhere needs the token the socket needs, which a URL carries in its query', async () => {
        expect((await guardBytesRequest(new Request(URL_OF_A_FILE), '192.168.1.20', auth, OPTIONS))?.status).toBe(401);
        expect((await guardBytesRequest(new Request(`${URL_OF_A_FILE}&token=nope`), '192.168.1.20', auth, OPTIONS))?.status).toBe(401);

        const paired = await auth.pair(auth.issuePairingToken(), { label: 'a laptop' });
        expect(await guardBytesRequest(new Request(`${URL_OF_A_FILE}&token=${paired!.sessionToken!}`), '192.168.1.20', auth, OPTIONS)).toBeNull();
    });

    test('a page on another origin is refused, the local secret notwithstanding', async () => {
        expect((await guardBytesRequest(local({ headers: { origin: 'https://evil.example' } }), '127.0.0.1', auth, OPTIONS))?.status).toBe(403);
    });
});

describe('bytesResponse', () => {
    test('answers with headers that keep the bytes inert', async () => {
        const response = bytesResponse({ mime: 'image/png', size: PNG.size, body: PNG }, { inline: true });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toContain('immutable');
        expect(response.headers.get('content-disposition')).toBe('inline');
        // Only an SVG can carry script; a PNG needs no policy of its own.
        expect(response.headers.get('content-security-policy')).toBeNull();
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(await PNG.arrayBuffer()));
    });

    test('an SVG comes with a policy that allows nothing but its own styles', () => {
        const response = bytesResponse({ mime: 'image/svg+xml', size: SVG.size, body: SVG }, { inline: true });
        expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    });
});

describe('parseByteRange', () => {
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
});
