import { afterAll, expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDevServer, runSmoke, smokeBrowser, smokeNode, warmSmoke } from './testing/dev-smoke';

const sharedEditorRuntime = [
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/language',
    '@codemirror/commands',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/markdown'
];

const dev = smokeBrowser === null || smokeNode === null ? null : await openDevServer({ optimizeDeps: { exclude: sharedEditorRuntime } });

if (dev !== null) {
    await warmSmoke(dev.url, 'editor-labels');
}

afterAll(async () => {
    await dev?.close();
});

test.skipIf(dev === null)(
    'linked chat composer extensions render and editor labels follow the app language in a browser',
    async () => {
        const { server, url } = dev!;
        const editor = Bun.resolveSync('@adecore/editor', import.meta.dir);
        const core = Bun.resolveSync('@adecore/editor-core', dirname(editor));
        expect((await fetch(`${url}/@fs${core}`)).status).toBe(200);
        const result = await runSmoke(url, 'editor-labels');
        expect(result.ok).toBe(true);
        const composerSource = Bun.resolveSync('@adecore/agents-react/chat/ui', import.meta.dir);
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
    },
    30000
);
