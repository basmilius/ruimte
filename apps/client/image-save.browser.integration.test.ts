import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = existsSync(macChrome) ? macChrome : (Bun.which('google-chrome') ?? Bun.which('chromium'));
const node = Bun.which('node');

test.skipIf(browser === null || node === null)(
    'the image save dialog selects project folders and replaces only after the explicit button',
    async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'ruimte-image-dialog-'));
        const server = await createServer({
            root: fileURLToPath(new URL('.', import.meta.url)),
            configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
            cacheDir: join(temporary, 'cache'),
            logLevel: 'silent',
            server: { port: 0, warmup: { clientFiles: [] } }
        });
        try {
            await server.listen();
            const address = server.httpServer?.address();
            if (address === null || address === undefined || typeof address === 'string') {
                throw new Error('Vite did not bind a port');
            }
            const process = Bun.spawn(
                [node!, fileURLToPath(new URL('./testing/dev-import-smoke.mjs', import.meta.url)), `http://localhost:${address.port}`, browser!, 'image-save'],
                { stdout: 'pipe', stderr: 'pipe' }
            );
            const [output, errors, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
            expect(exitCode, `${output}\n${errors}`).toBe(0);
            expect(JSON.parse(output).probe.saved).toEqual({
                saveDisabled: true,
                pathShown: true,
                saveBeforeReplace: 0,
                busyStaysOpen: true,
                savedPath: '/project/assets/rabbit.png',
                writes: [
                    {
                        type: 'chat.saveImage',
                        payload: { chatId: 'chat-original', attachmentId: 'image-original', path: '/project/assets/rabbit.png', replace: 'checked-image' }
                    }
                ]
            });
        } finally {
            await server.close();
            await rm(temporary, { recursive: true, force: true });
        }
    },
    30000
);
