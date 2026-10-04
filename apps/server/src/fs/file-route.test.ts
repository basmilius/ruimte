import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_FILE_PATH, handleFsFileRequest } from './file-route.ts';
import { MachineHome } from './machine-home.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

// An MP4 head (a box length, `ftyp`, the brand) with enough bytes behind it to ask for a slice of.
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(100, 0x2a)]);

// What the desktop app on this machine presents; a loopback address alone gets nothing.
const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };

let root: string;
let machineHome: MachineHome;

const ask = (path: string, remote = '127.0.0.1', init?: RequestInit): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}?v=1-1&path=${encodeURIComponent(join(root, path))}`);
    return handleFsFileRequest(new Request(url, asLocal(init)), url, remote, OPTIONS, machineHome);
};
// Every request below carries the local secret unless a test says otherwise, the way the desktop app's does.
const asLocal = (init?: RequestInit): RequestInit => ({
    ...init,
    headers: { authorization: `Bearer ${LOCAL_SECRET}`, ...(init?.headers as Record<string, string>) }
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-fs-file-route-'));
    await writeFile(join(root, 'icon.png'), PNG);
    machineHome = new MachineHome(join(root, 'home'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the file route', () => {
    test('serves a picture to the local secret, to be shown inline', async () => {
        const response = await ask('icon.png');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('content-disposition')).toBe('inline');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PNG));
    });

    test('serves an SVG as one, which is what gives it its policy', async () => {
        await writeFile(join(root, 'mark.svg'), SVG);
        expect((await ask('mark.svg')).headers.get('content-type')).toBe('image/svg+xml');
    });

    test('serves nothing but the media and the text the viewer shows', async () => {
        await writeFile(join(root, 'a.out'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
        expect((await ask('a.out')).status).toBe(404);
        expect((await ask('nothing.png')).status).toBe(404);
    });

    test('serves an HTML file as plain text, so it never runs in the origin that asked', async () => {
        await writeFile(join(root, 'page.html'), '<script>alert(1)</script>');
        const response = await ask('page.html');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await response.text()).toBe('<script>alert(1)</script>');
    });

    test('a PDF comes typed and in ranges, so a reader can fetch a page at a time', async () => {
        const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x2a)]);
        await writeFile(join(root, 'paper.pdf'), pdf);
        const whole = await ask('paper.pdf');
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('application/pdf');
        expect(whole.headers.get('accept-ranges')).toBe('bytes');
        expect(whole.headers.get('x-content-type-options')).toBe('nosniff');

        const slice = await ask('paper.pdf', '127.0.0.1', { headers: { range: 'bytes=0-7' } });
        expect(slice.status).toBe(206);
        expect(slice.headers.get('content-range')).toBe(`bytes 0-7/${pdf.length}`);
        expect(Buffer.from(await slice.arrayBuffer()).toString('latin1')).toBe('%PDF-1.7');
    });

    test('sound comes typed and in ranges like a video', async () => {
        await writeFile(join(root, 'voice.wav'), Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(64)]));
        const slice = await ask('voice.wav', '127.0.0.1', { headers: { range: 'bytes=0-11' } });
        expect(slice.status).toBe(206);
        expect(slice.headers.get('content-type')).toBe('audio/wav');
        expect(Buffer.from(await slice.arrayBuffer()).toString('latin1')).toBe('RIFF\x24\x00\x00\x00WAVE');
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

    test('a client from elsewhere needs the ticket its channel handed out', async () => {
        const url = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}?path=${encodeURIComponent(join(root, 'icon.png'))}`);
        const refused = await handleFsFileRequest(new Request(url), url, '192.168.1.20', OPTIONS, machineHome);
        expect(refused.status).toBe(401);
        // A tunnel on this machine looks exactly like this.
        expect((await handleFsFileRequest(new Request(url), url, '127.0.0.1', OPTIONS, machineHome)).status).toBe(401);

        const ticketed = { ...OPTIONS, tickets: { ticketAccess: async (ticket: string) => (ticket === 'a-ticket' ? { sessionId: 'laptop' } : null) } };
        url.searchParams.set('token', 'a-ticket');
        const allowed = await handleFsFileRequest(new Request(url), url, '192.168.1.20', ticketed, machineHome);
        expect(allowed.status).toBe(200);
    });

    test('serves no picture of the machine home outside the shots agents take', async () => {
        await mkdir(join(root, 'home', 'screenshots'), { recursive: true });
        await writeFile(join(root, 'home', 'portrait.png'), PNG);
        await writeFile(join(root, 'home', 'screenshots', 'shot.png'), PNG);
        expect((await ask('home/portrait.png')).status).toBe(403);
        expect((await ask('home/screenshots/shot.png')).status).toBe(200);
    });

    test('answers 400 without a path and 404 for another route', async () => {
        const bare = new URL(`http://127.0.0.1:4210${FS_FILE_PATH}`);
        expect((await handleFsFileRequest(new Request(bare, asLocal()), bare, '127.0.0.1', OPTIONS, machineHome)).status).toBe(400);

        const elsewhere = new URL('http://127.0.0.1:4210/fs/other');
        expect((await handleFsFileRequest(new Request(elsewhere, asLocal()), elsewhere, '127.0.0.1', OPTIONS, machineHome)).status).toBe(404);
    });
});
