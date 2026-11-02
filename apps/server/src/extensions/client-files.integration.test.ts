import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ExtensionPack } from '@ruimte/contracts';
import { clientFilesOf } from './client-files.ts';
import { ExtensionHost } from './extension-host.ts';
import { packExtension } from './pack.ts';
import { ExtensionStore } from './store.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-client-files-'));
const theme = { name: 'Palette', side: 'dark', thumbnail: 'palette.svg', css: 'palette.css', tokens: { '--background': '#000000' } };

function project(name: string, files: Record<string, string>): string {
    const folder = join(root, name);

    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(folder, path, '..'), { recursive: true });
        writeFileSync(join(folder, path), content);
    }

    return folder;
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the files a client with no shell loads', () => {
    test('are every file of the pack but its server part, also a theme and what it names outside the usual folders', async () => {
        const folder = project('palette', {
            'manifest.json': JSON.stringify({ id: 'acme.palette', name: 'Palette', version: '0.1.0', api: 1, themes: ['palette.json'] }),
            'palette.json': JSON.stringify(theme),
            'palette.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
            'palette.css': '.palette { color: red; }',
            'client/index.ts': 'export const ready = true;',
            'server/index.ts': `import { defineServer } from '@ruimte/extension/server';\nexport default defineServer({ async ping() { return 1; } });`,
            'locales/en.json': '{}'
        });
        const { path } = await packExtension(folder);
        const bytes = readFileSync(path);
        const pack = JSON.parse(gunzipSync(bytes).toString('utf8')) as ExtensionPack;
        const host = new ExtensionHost({ store: new ExtensionStore(join(root, 'home')) });

        try {
            await host.install(bytes.toString('base64'));

            const { files } = await host.clientFiles('acme.palette');
            const expected = Object.keys(pack.files).filter((file) => !file.startsWith('server/'));

            expect(Object.keys(files).sort()).toEqual(expected.sort());
            expect(expected).toEqual(expect.arrayContaining(['palette.json', 'palette.svg', 'palette.css', 'client/index.js', 'locales/en.json']));
        } finally {
            host.stopAll();
        }
    });

    test('hand out nothing a link points at outside the folder', async () => {
        const outside = project('outside', { 'secret.txt': 'secret', 'notes/secret.txt': 'secret' });
        const folder = project('linked', {
            'manifest.json': '{}',
            'palette.json': JSON.stringify({ ...theme, thumbnail: 'palette.svg', css: 'palette.css' }),
            'client/index.js': 'export {};'
        });

        symlinkSync(join(outside, 'secret.txt'), join(folder, 'client', 'secret.txt'));
        symlinkSync(join(outside, 'notes'), join(folder, 'assets'));
        symlinkSync(join(outside, 'secret.txt'), join(folder, 'palette.svg'));
        symlinkSync(join(folder, 'client'), join(folder, 'client', 'again'));

        const files = await clientFilesOf(folder, { id: 'acme.linked', name: 'Linked', version: '0.1.0', api: 1, themes: ['palette.json'] });

        expect(Object.keys(files).sort()).toEqual(['client/index.js', 'manifest.json', 'palette.json']);
    });
});
