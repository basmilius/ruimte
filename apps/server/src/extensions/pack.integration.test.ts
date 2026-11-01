import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

        expect(index).toContain('globalThis.__ruimteExtension.for("acme.builds").client');
        expect(index).toContain('import(');
        expect(index).not.toContain('useState');
        expect(readFileSync(join(outdir, 'server', 'index.js'), 'utf8')).toContain('globalThis.__ruimteExtension.for("acme.builds").server');
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
        expect(BUILD_FOLDER).toBe('.ruimte-build');
    });
});
