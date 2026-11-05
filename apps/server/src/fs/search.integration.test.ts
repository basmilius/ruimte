import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn } from '../git/test-repo.ts';
import { MachineHome } from './machine-home.ts';
import { forgetSearchCache, listSearchableFiles, searchFiles } from './search.ts';

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

async function seed(root: string): Promise<void> {
    await mkdir(join(root, 'src', 'chat'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await mkdir(join(root, '.hidden'), { recursive: true });
    await writeFile(join(root, 'src', 'chat', 'composer.ts'), '');
    await writeFile(join(root, 'src', 'chat', 'drafts.ts'), '');
    await writeFile(join(root, 'src', 'index.ts'), '');
    await writeFile(join(root, 'README.md'), '');
    await writeFile(join(root, 'secret.log'), '');
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '');
    await writeFile(join(root, '.hidden', 'x.ts'), '');
}

// A folder outside any repository, where git answers no and the walk stands in for it.
describe('searchFiles in a plain folder', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-search-plain-'));
        await seed(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('walks a plain folder, skipping dot folders and node_modules', async () => {
        const { files, truncated } = await searchFiles(root, '');
        expect(truncated).toBe(false);
        expect(files).toContain('src/chat/composer.ts');
        expect(files).toContain('README.md');
        expect(files.some((file) => file.startsWith('node_modules'))).toBe(false);
        expect(files.some((file) => file.startsWith('.hidden'))).toBe(false);
    });

    test('names nothing of a home below the folder searched, apart from the folders that stay open', async () => {
        const home = join(root, 'machine');
        await mkdir(join(home, 'scratch'), { recursive: true });
        await mkdir(join(home, 'chats', 'c1.visuals'), { recursive: true });
        await writeFile(join(home, 'local.key'), '');
        await writeFile(join(home, 'chats', 'c1.jsonl'), '');
        await writeFile(join(home, 'scratch', 'notes.md'), '');
        await writeFile(join(home, 'chats', 'c1.visuals', 'page.html'), '');
        const { files } = await searchFiles(root, '', 200, await new MachineHome(home).policy());
        expect(files).toEqual(expect.arrayContaining(['machine/scratch/notes.md', 'machine/chats/c1.visuals/page.html', 'README.md']));
        expect(files.some((file) => file.endsWith('local.key') || file.endsWith('c1.jsonl'))).toBe(false);
    });

    test('ranks the query and honors the limit', async () => {
        const { files } = await searchFiles(root, 'comp', 1);
        expect(files).toEqual(['src/chat/composer.ts']);
    });

    test('fills the result limit after the best cached matches disappeared', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `item-${String(index).padStart(2, '0')}.ts`);
        await Promise.all(names.map((name) => writeFile(join(root, name), '')));
        await listSearchableFiles(root);
        await Promise.all(names.slice(0, 8).map((name) => rm(join(root, name))));
        expect((await searchFiles(root, 'item', 3)).files).toEqual(['item-08.ts', 'item-09.ts', 'item-10.ts']);
    });
});

describe('the listing cache', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-search-cache-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('keystrokes that come while a folder is listed share that listing', () => {
        expect(listSearchableFiles(root)).toBe(listSearchableFiles(root));
    });

    test('a change drops the folders around it and keeps the rest', async () => {
        const [first, second] = [join(root, 'first'), join(root, 'second')];
        await Promise.all([mkdir(join(first, 'src'), { recursive: true }), mkdir(second)]);
        await Promise.all([listSearchableFiles(first), listSearchableFiles(second), listSearchableFiles(root)]);
        await Promise.all([writeFile(join(first, 'src', 'new.ts'), ''), writeFile(join(second, 'new.ts'), '')]);

        forgetSearchCache([join(first, 'src')]);

        expect((await listSearchableFiles(first)).files).toEqual(['src/new.ts']);
        expect((await listSearchableFiles(root)).files.sort()).toEqual(['first/src/new.ts', 'second/new.ts']);
        expect((await listSearchableFiles(second)).files).toEqual([]);
    });

    test('keeps the folders used last and lets the oldest go', async () => {
        const folders = Array.from({ length: 33 }, (_, index) => join(root, `folder-${index}`));
        await Promise.all(folders.map((folder) => mkdir(folder)));
        const oldest = listSearchableFiles(folders[0]!);
        const kept = listSearchableFiles(folders[1]!);
        await Promise.all(folders.slice(2).map((folder) => listSearchableFiles(folder)));
        expect(listSearchableFiles(folders[1]!)).toBe(kept);

        await listSearchableFiles(join(root, 'one-more'));

        expect(listSearchableFiles(folders[1]!)).toBe(kept);
        expect(listSearchableFiles(folders[0]!)).not.toBe(oldest);
    });
});
