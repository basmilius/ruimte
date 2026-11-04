import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from './machine-home.ts';
import { forgetSearchCache, listSearchableFiles, rankFiles, searchFiles } from './search.ts';

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

describe('rankFiles', () => {
    test('needs every character in order and ignores case', () => {
        expect(rankFiles(['src/chat/Composer.ts'], 'cmp', 1)).toEqual(['src/chat/Composer.ts']);
        expect(rankFiles(['src/chat/composer.ts'], 'pmc', 1)).toEqual([]);
    });

    test('prefers the file name over a directory hit and a prefix over a scattered match', () => {
        expect(rankFiles(['chat/x.ts', 'src/chat.ts', 'src/changes/hat.ts'], 'chat', 3)).toEqual(['src/chat.ts', 'chat/x.ts', 'src/changes/hat.ts']);
    });

    test('matches words apart on their own and in any order', () => {
        const path = 'app-alpha/src/greeting.ts';
        expect(rankFiles([path], 'alpha greeting', 1)).toEqual([path]);
        expect(rankFiles([path], 'greeting  alpha', 1)).toEqual([path]);
        expect(rankFiles([path], 'alpha farewell', 1)).toEqual([]);
        expect(rankFiles([path], ' greeting ', 1)).toEqual([path]);
    });

    test('still prefers the file name for a word of a query with several', () => {
        const files = ['app-alpha/greeting/notes.ts', 'app-alpha/src/greeting.ts', 'app-alpha/src/farewell.ts'];
        expect(rankFiles(files, 'alpha greeting', 3)).toEqual(['app-alpha/src/greeting.ts', 'app-alpha/greeting/notes.ts']);
    });

    test('rankFiles keeps the limit and breaks ties on length', () => {
        expect(rankFiles(['b/index.ts', 'index.ts', 'a/index.ts'], '', 2)).toEqual(['index.ts', 'a/index.ts']);
    });

    test('limited ranking keeps tracked files ahead of ignored ties and returns every remaining match in order', () => {
        const files = ['file-h.ts', 'file-c.ts', 'file-f.ts', 'file-a.ts', 'file-g.ts', 'file-d.ts', 'file-b.ts', 'file-e.ts'];
        const ignored = ['file-2.ts', 'file-0.ts', 'file-1.ts'];
        const ordered = [
            'file-a.ts',
            'file-b.ts',
            'file-c.ts',
            'file-d.ts',
            'file-e.ts',
            'file-f.ts',
            'file-g.ts',
            'file-h.ts',
            'file-0.ts',
            'file-1.ts',
            'file-2.ts'
        ];
        for (const limit of [0, 1, 3, 8, 9, 20]) {
            expect(rankFiles(files, 'file', limit, ignored)).toEqual(ordered.slice(0, limit));
        }
    });
});

describe('searchFiles', () => {
    let root: string;

    beforeEach(async () => {
        forgetSearchCache();
        root = await mkdtemp(join(tmpdir(), 'ruimte-search-'));
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
        root = await mkdtemp(join(tmpdir(), 'ruimte-search-cache-'));
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
