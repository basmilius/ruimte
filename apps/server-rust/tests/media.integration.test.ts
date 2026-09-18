import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { repositoryRoot, startDaemon } from './wire-client';

test('file media enforces its path jail, detects content and serves bounded ranges', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-media-'));
    const home = join(directory, 'home');
    await mkdir(home);
    const svg = join(directory, 'image.svg');
    const noExtension = join(directory, 'noext');
    const spoofed = join(directory, 'spoof.png');
    const linked = join(directory, 'linked.svg');
    const empty = join(directory, 'empty.mp4');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>界</text></svg>');
    await writeFile(noExtension, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    await writeFile(spoofed, 'plain text');
    await writeFile(empty, '');
    await symlink(svg, linked);
    const daemon = await startDaemon({ home });

    try {
        const image = await media(daemon, svg);
        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')).toBe('image/svg+xml');
        expect(image.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
        expect(image.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await image.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>界</text></svg>');

        expect((await media(daemon, noExtension)).headers.get('content-type')).toBe('image/png');
        expect((await media(daemon, spoofed)).headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect((await media(daemon, linked)).status).toBe(404);
        expect((await media(daemon, relative(repositoryRoot, svg))).status).toBe(404);
        expect((await media(daemon, join(directory, 'missing.svg'))).status).toBe(404);
        expect((await media(daemon, undefined)).status).toBe(400);
        expect((await media(daemon, '')).status).toBe(400);

        const head = await media(daemon, svg, { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');

        expect((await fetch(mediaUrl(daemon, svg))).status).toBe(401);
        expect((await fetch(mediaUrl(daemon, svg), { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
        expect((await media(daemon, svg, { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
        expect((await media(daemon, svg, { method: 'POST' })).status).toBe(405);

        await expectRange(daemon, svg, 'bytes=0-0', 206, 'bytes 0-0/62', '<');
        await expectRange(daemon, svg, 'bytes=2-10', 206, 'bytes 2-10/62', 'vg xmlns=');
        await expectRange(daemon, svg, 'bytes=2-', 206, 'bytes 2-61/62');
        await expectRange(daemon, svg, 'bytes=-8', 206, 'bytes 54-61/62', 't></svg>');
        await expectRange(daemon, svg, 'bytes=0-999', 206, 'bytes 0-61/62');
        await expectRange(daemon, svg, 'bytes=999-', 416, 'bytes */62');
        await expectRange(daemon, svg, 'bytes=8-2', 416, 'bytes */62');
        await expectRange(daemon, svg, 'bytes=-0', 416, 'bytes */62');
        await expectRange(daemon, svg, 'bytes=-', 416, 'bytes */62');
        await expectRange(daemon, svg, 'bytes=0-1,3-4', 200, null);
        await expectRange(daemon, svg, 'items=0-1', 200, null);
        await expectRange(daemon, svg, `bytes=${'9'.repeat(36)}-`, 416, 'bytes */62');
        await expectRange(daemon, svg, `bytes=-${'9'.repeat(36)}`, 206, 'bytes 0-61/62');
        await expectRange(daemon, empty, 'bytes=0-', 404, null);
    } finally {
        await daemon.stop();
        await rm(directory, { recursive: true, force: true });
    }
});

type Daemon = Awaited<ReturnType<typeof startDaemon>>;

const mediaUrl = (daemon: Daemon, path?: string): URL => {
    const url = new URL('/fs/file', daemon.base);
    if (path !== undefined) {
        url.searchParams.set('path', path);
    }
    return url;
};

const media = (daemon: Daemon, path?: string, init?: RequestInit): Promise<Response> =>
    daemon.request(mediaUrl(daemon, path).pathname + mediaUrl(daemon, path).search, init);

const expectRange = async (daemon: Daemon, path: string, range: string, status: number, contentRange: string | null, body?: string): Promise<void> => {
    const response = await media(daemon, path, { headers: { range } });
    expect(response.status).toBe(status);
    expect(response.headers.get('content-range')).toBe(contentRange);
    if (body !== undefined) {
        expect(await response.text()).toBe(body);
    }
};
