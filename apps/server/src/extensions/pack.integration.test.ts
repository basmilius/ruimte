import { afterAll, describe, expect, test } from 'bun:test';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildExtension, BUILD_FOLDER, packExtension } from './pack.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-pack-'));
const manifest = JSON.stringify({ id: 'acme.builds', name: 'Builds', version: '0.1.0', api: 1 });

function project(name: string, files: Record<string, string>): string {
    const folder = join(root, name);

    for (const [path, content] of Object.entries({ 'manifest.json': manifest, ...files })) {
        mkdirSync(join(folder, path, '..'), { recursive: true });
        writeFileSync(join(folder, path), content);
    }

    return folder;
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('building an extension', () => {
    test('leaves what Ruimte supplies out, keeps a lazy component in a chunk and minifies nothing', async () => {
        const folder = project('both', {
            'client/index.ts': `import { definePanel } from '@ruimte/extension/client';\ndefinePanel({ id: 'builds', title: 'Builds', icon: 'hammer', component: () => import('./Panel') });`,
            'client/Panel.tsx': `import { useState } from 'react';\nexport default function Panel() { const [count] = useState(1); return <div>{count}</div>; }`,
            'server/index.ts': `import { defineServer } from '@ruimte/extension/server';\nexport default defineServer({ async latest() { return 1; } });`
        });
        const { outdir } = await buildExtension(folder);
        const index = readFileSync(join(outdir, 'client', 'index.js'), 'utf8');

        expect(index).toContain('globalThis.__ruimteExtension.for("acme.builds", import.meta.url).client');
        expect(index).toContain('import(');
        expect(index).not.toContain('useState');
        expect(readFileSync(join(outdir, 'server', 'index.js'), 'utf8')).toContain('globalThis.__ruimteExtension.for("acme.builds", import.meta.url).server');
    });

    test('takes charts and the pieces of a chat from Ruimte instead of bundling ADE CORE', async () => {
        const folder = project('hosted', {
            'client/index.ts': `import { Chart } from '@ruimte/extension/charts';\nimport { Markdown } from '@ruimte/extension/agents-ui';\nexport const parts = [Chart, Markdown];`
        });
        const { outdir } = await buildExtension(folder);
        const index = readFileSync(join(outdir, 'client', 'index.js'), 'utf8');

        expect(index).toContain('globalThis.__ruimteExtension.for("acme.builds", import.meta.url).charts');
        expect(index).toContain('globalThis.__ruimteExtension.for("acme.builds", import.meta.url).agentsUi');
        expect(index).not.toContain('d3-scale');
    });

    test('gathers every stylesheet the client imports, also a lazy one, into index.css beside index.js', async () => {
        const folder = project('styles', {
            'client/index.ts': `import './base.css';\nexport const load = () => import('./Panel');`,
            'client/base.css': '.builds-base { color: red; }',
            'client/Panel.tsx': `import './panel.css';\nexport default function Panel() { return null; }`,
            'client/panel.css': '.builds-panel { color: blue; }'
        });
        const { outdir } = await buildExtension(folder);
        const css = readFileSync(join(outdir, 'client', 'index.css'), 'utf8');

        expect(css).toContain('.builds-base');
        expect(css).toContain('.builds-panel');
        expect(readFileSync(join(outdir, 'client', 'index.js'), 'utf8')).toContain('import(');
    });

    test('refuses code of server/ in client/, and takes its types', async () => {
        const refused = project('crossing', {
            'client/index.ts': `import { secret } from '../server/secret';\nconsole.info(secret);`,
            'server/secret.ts': `export const secret = 1;`
        });
        const allowed = project('types', {
            'client/index.ts': `import type server from '../server';\nexport const name: keyof typeof server = 'latest';`,
            'server/index.ts': `export default { latest: async () => 1 };`
        });

        await expect(buildExtension(refused)).rejects.toThrow('may only share types');
        await expect(buildExtension(allowed)).resolves.toBeDefined();
    });

    test('refuses server/ in client/ also through an absolute import, an alias or a link', async () => {
        const absolute = project('absolute', {
            'client/index.ts': `import { secret } from ${JSON.stringify(join(root, 'absolute', 'server', 'secret.ts'))};\nconsole.info(secret);`,
            'server/secret.ts': `export const secret = 'S3CRET';`
        });
        const aliased = project('aliased', {
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@secret': ['./server/secret.ts'] } } }),
            'client/index.ts': `import { secret } from '@secret';\nconsole.info(secret);`,
            'server/secret.ts': `export const secret = 'S3CRET';`
        });
        const linked = project('linked', {
            'client/index.ts': `import { secret } from './shared/secret';\nconsole.info(secret);`,
            'server/secret.ts': `export const secret = 'S3CRET';`
        });

        symlinkSync(join(linked, 'server'), join(linked, 'client', 'shared'));

        await expect(buildExtension(absolute)).rejects.toThrow('may only share types');
        await expect(buildExtension(aliased)).rejects.toThrow('may only share types');
        await expect(buildExtension(linked)).rejects.toThrow('may only share types');
    });

    test('refuses an icon that is no svg', async () => {
        const folder = project('icon', {
            'manifest.json': JSON.stringify({ id: 'acme.icon', name: 'Icon', version: '0.1.0', api: 1, color: '#123456', themes: [] }),
            'client/index.ts': 'export {};',
            'assets/icon.svg': 'not a picture'
        });

        await expect(buildExtension(folder)).rejects.toThrow('not an svg');
    });

    test('a pack is gzipped JSON with the manifest and every built file', async () => {
        const folder = project('packed', { 'client/index.ts': `console.info('hello');`, 'locales/en.json': '{}' });
        const packed = await packExtension(folder);
        const { files } = JSON.parse(gunzipSync(readFileSync(packed.path)).toString('utf8')) as { files: Record<string, string> };

        expect(packed.path.endsWith('acme.builds-0.1.0.rex')).toBe(true);
        expect(Object.keys(files).toSorted()).toEqual(['client/index.js', 'locales/en.json', 'manifest.json']);
        expect(BUILD_FOLDER).toBe('dist');
    });

    test('a build that fails leaves the last one whole', async () => {
        const folder = project('failing', { 'client/index.ts': `console.info('first');`, 'assets/logo.txt': 'logo' });

        await buildExtension(folder);
        writeFileSync(join(folder, 'client', 'index.ts'), 'this is no code {');

        await expect(buildExtension(folder)).rejects.toThrow();
        expect(readFileSync(join(folder, BUILD_FOLDER, 'client', 'index.js'), 'utf8')).toContain('first');
        expect(readFileSync(join(folder, BUILD_FOLDER, 'assets', 'logo.txt'), 'utf8')).toBe('logo');
        expect(readdirSync(folder).filter((name) => name.startsWith('.ruimte-build-'))).toEqual([]);
    });

    test('packs every file a theme names, wherever it is', async () => {
        const theme = JSON.stringify({ name: 'Palette', side: 'dark', thumbnail: 'palette.svg', tokens: {}, css: 'palette.css' });
        const folder = project('themed', {
            'manifest.json': JSON.stringify({ id: 'acme.themed', name: 'Themed', version: '0.1.0', api: 1, themes: ['palette.json'] }),
            'palette.json': theme,
            'palette.svg': '<svg></svg>',
            'palette.css': '.themed { color: red; }'
        });
        const packed = await packExtension(folder);
        const { files } = JSON.parse(gunzipSync(readFileSync(packed.path)).toString('utf8')) as { files: Record<string, string> };

        expect(Object.keys(files).toSorted()).toEqual(['manifest.json', 'palette.css', 'palette.json', 'palette.svg']);
    });

    test('copies what a link inside the project points at, and refuses a link outside it or back into itself', async () => {
        const outside = mkdtempSync(join(tmpdir(), 'ruimte-pack-outside-'));
        const inside = project('linked-assets', { 'client/index.ts': 'export {};', 'shared/logo.txt': 'logo' });
        const leaking = project('leaking-assets', { 'client/index.ts': 'export {};', 'assets/.keep': '' });
        const looping = project('looping-assets', { 'client/index.ts': 'export {};', 'assets/.keep': '' });

        writeFileSync(join(outside, 'secret.txt'), 'secret');
        mkdirSync(join(inside, 'assets'));
        symlinkSync(join(inside, 'shared', 'logo.txt'), join(inside, 'assets', 'logo.txt'));
        symlinkSync(join(outside, 'secret.txt'), join(leaking, 'assets', 'secret.txt'));
        symlinkSync('..', join(looping, 'assets', 'again'));

        const { outdir } = await buildExtension(inside);

        expect(lstatSync(join(outdir, 'assets', 'logo.txt')).isSymbolicLink()).toBe(false);
        expect(readFileSync(join(outdir, 'assets', 'logo.txt'), 'utf8')).toBe('logo');
        await expect(buildExtension(leaking)).rejects.toThrow('outside the project');
        await expect(buildExtension(looping)).rejects.toThrow('links back into a folder it is in');
        rmSync(outside, { recursive: true, force: true });
    });
});
