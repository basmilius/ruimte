import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn } from '../git/test-repo.ts';
import { forgetSearchCache, searchFiles } from './search.ts';

describe('searchFiles in a repository', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-search-'));
        await mkdir(join(root, 'src'), { recursive: true });
        await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
        await mkdir(join(root, '.hidden'), { recursive: true });
        await writeFile(join(root, 'src', 'index.ts'), '');
        await writeFile(join(root, 'secret.log'), '');
        await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '');
        await writeFile(join(root, '.hidden', 'x.ts'), '');
        await gitIn(root, ['init', '--quiet']);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('sees untracked files and what .gitignore keeps out, minus dot names and build output', async () => {
        await mkdir(join(root, 'reports', 'old'), { recursive: true });
        await writeFile(join(root, 'reports', 'old', 'summary.html'), '');
        await writeFile(join(root, '.env.local'), '');
        await writeFile(join(root, '.gitignore'), '*.log\nnode_modules\nreports/\n.hidden\n*.local\n');
        const { files } = await searchFiles(root, '', 200);
        expect(files).toContain('src/index.ts');
        expect(files).toContain('.gitignore');
        expect(files).toContain('secret.log');
        expect(files).toContain('reports/old/summary.html');
        expect(files).not.toContain('.env.local');
        expect(files.some((file) => file.startsWith('node_modules'))).toBe(false);
        expect(files.some((file) => file.startsWith('.hidden'))).toBe(false);
    });

    test('an ignored file ranks behind a kept one on the same score', async () => {
        await writeFile(join(root, 'notes.log'), '');
        await writeFile(join(root, 'notes.md'), '');
        await writeFile(join(root, '.gitignore'), '*.log\n');
        const { files } = await searchFiles(root, 'notes', 2);
        expect(files).toEqual(['notes.md', 'notes.log']);
    });
});
