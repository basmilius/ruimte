import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot, startDaemon } from './wire-client';

test('attachments retain verified metadata, ranges, SVG policy and safe Unicode filenames', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'ruimte-attachment-cli-'));
    const executable = join(bin, 'claude');
    await Bun.write(
        executable,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'fixture 1.0.0'; exit 0; fi
exec ${shellQuote(process.execPath)} ${shellQuote(join(repositoryRoot, 'apps/server-rust/tests/providers/fake-claude.ts'))} "$@"
`
    );
    await chmod(executable, 0o755);
    const daemon = await startDaemon({ env: { PATH: `${bin}:${process.env.PATH ?? ''}` } });
    const client = await daemon.connect();

    try {
        const chatId = 'attachment-fixture';
        await client.call('chat.create', {
            chatId,
            provider: 'claude',
            cwd: daemon.home,
            runtimeMode: 'supervised'
        });
        await client.call('chat.send', {
            chatId,
            text: 'inspect',
            attachments: [
                {
                    name: '../report "界".txt',
                    mime: 'text/plain',
                    data: Buffer.from('hello 界\n').toString('base64')
                },
                { name: 'image.png', mime: 'application/octet-stream', data: 'iVBORw0KGgo=' },
                {
                    name: 'drawing.svg',
                    mime: 'image/svg+xml',
                    data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
                }
            ]
        });

        const snapshot = await completedSnapshot(client, chatId);
        const user = snapshot.items.find((item: any) => item.kind === 'user');
        expect(user.attachments.map(({ id: _id, path: _path, ...attachment }: any) => attachment)).toEqual([
            { name: '../report "界".txt', mime: 'text/plain', size: 10 },
            { name: 'image.png', mime: 'image/png', size: 8 },
            { name: 'drawing.svg', mime: 'image/svg+xml', size: 41 }
        ]);
        const [text, png, svg] = user.attachments;

        const downloaded = await attachment(daemon, chatId, text.id);
        expect(downloaded.status).toBe(200);
        expect(downloaded.headers.get('content-type')).toBe('text/plain');
        expect(downloaded.headers.get('content-disposition')).toBe(`inline; filename="report _.txt"; filename*=UTF-8''report%20%E7%95%8C%2Etxt`);
        expect(downloaded.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
        expect(await downloaded.text()).toBe('hello 界\n');

        const image = await attachment(daemon, chatId, png.id);
        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe('iVBORw0KGgo=');

        const drawing = await attachment(daemon, chatId, svg.id);
        expect(drawing.status).toBe(200);
        expect(drawing.headers.get('content-type')).toBe('image/svg+xml');
        expect(drawing.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");

        const head = await attachment(daemon, chatId, text.id, { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
        expect(head.headers.get('content-disposition')).toBe(downloaded.headers.get('content-disposition'));

        const range = await attachment(daemon, chatId, text.id, { headers: { range: 'bytes=1-4' } });
        expect(range.status).toBe(206);
        expect(range.headers.get('content-range')).toBe('bytes 1-4/10');
        expect(await range.text()).toBe('ello');

        expect((await fetch(attachmentUrl(daemon, chatId, text.id))).status).toBe(401);
        expect(
            (
                await daemon.request(attachmentPath(chatId, text.id), {
                    headers: { origin: 'https://untrusted.invalid' }
                })
            ).status
        ).toBe(403);
        expect((await attachment(daemon, chatId, 'missing')).status).toBe(404);
        expect((await attachment(daemon, chatId, text.id, { method: 'POST' })).status).toBe(405);

        await client.call('chat.clear', { chatId });
        expect((await attachment(daemon, chatId, text.id)).status).toBe(404);
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
        await rm(bin, { recursive: true, force: true });
    }
}, 30_000);

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const attachmentPath = (chatId: string, attachmentId: string): string => `/attachments/${encodeURIComponent(chatId)}/${encodeURIComponent(attachmentId)}`;

const attachmentUrl = (daemon: Awaited<ReturnType<typeof startDaemon>>, chatId: string, attachmentId: string): URL =>
    new URL(attachmentPath(chatId, attachmentId), daemon.base);

const attachment = (daemon: Awaited<ReturnType<typeof startDaemon>>, chatId: string, attachmentId: string, init?: RequestInit): Promise<Response> =>
    daemon.request(attachmentPath(chatId, attachmentId), init);

const completedSnapshot = async (client: Awaited<ReturnType<Awaited<ReturnType<typeof startDaemon>>['connect']>>, chatId: string) => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
        const snapshot = await client.call('chat.attach', { chatId });
        if (snapshot.info.activeTurnId === null) {
            return snapshot;
        }
        await Bun.sleep(25);
    }
    throw new Error('Chat turn did not complete');
};
