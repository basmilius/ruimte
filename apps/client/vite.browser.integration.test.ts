import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = existsSync(macChrome) ? macChrome : (Bun.which('google-chrome') ?? Bun.which('chromium') ?? Bun.which('chromium-browser'));
const node = Bun.which('node');
const sharedEditorRuntime = [
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/language',
    '@codemirror/commands',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/markdown'
];

test.skipIf(browser === null || node === null)(
    'linked chat composer extensions render and editor labels follow the app language in a browser',
    async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'ruimte-vite-import-'));
        const server = await createServer({
            root: fileURLToPath(new URL('.', import.meta.url)),
            configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
            cacheDir: join(temporary, 'cache'),
            logLevel: 'silent',
            optimizeDeps: { exclude: sharedEditorRuntime },
            server: { port: 0, warmup: { clientFiles: [] } }
        });
        try {
            await server.listen();
            const address = server.httpServer?.address();
            if (address === null || address === undefined || typeof address === 'string') {
                throw new Error('Vite did not bind a TCP port');
            }
            const editor = Bun.resolveSync('@adecore/editor', import.meta.dir);
            const core = Bun.resolveSync('@adecore/editor-core', dirname(editor));
            const source = await fetch(`http://localhost:${address.port}/@fs${core}`);
            expect(source.status).toBe(200);
            const process = Bun.spawn(
                [
                    node!,
                    fileURLToPath(new URL('./testing/dev-import-smoke.mjs', import.meta.url)),
                    `http://localhost:${address.port}`,
                    browser!,
                    'editor-labels'
                ],
                { stdout: 'pipe', stderr: 'pipe' }
            );
            const [output, errors, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
            expect(exitCode, `${output}\n${errors}`).toBe(0);
            const result = JSON.parse(output).probe;
            expect(result.ok).toBe(true);
            const composerSource = Bun.resolveSync('@adecore/agents-react/chat/ui/composer/editor', import.meta.dir);
            const appSource = fileURLToPath(new URL('./src/dictation/editor.ts', import.meta.url));
            for (const name of sharedEditorRuntime) {
                const [appModule, sharedModule] = await Promise.all([
                    server.environments.client.pluginContainer.resolveId(name, appSource),
                    server.environments.client.pluginContainer.resolveId(name, composerSource)
                ]);
                expect(sharedModule?.id, `${name} must have one runtime identity in the app and linked composer`).toBe(appModule?.id);
            }
            expect(result.labels).toEqual({
                composer: { text: 'Write a reply.', range: { from: 6, to: 13 }, preview: 'draft' },
                english: 'Code file /work/app/example.ts',
                dutch: 'Codebestand /work/app/example.ts',
                sameEditor: true,
                sameWords: true,
                featureWords: 'Niet gebruikt'
            });
        } finally {
            await server.close();
            await rm(temporary, { recursive: true, force: true });
        }
    },
    30000
);
