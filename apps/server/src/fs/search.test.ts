import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetSearchCache, fuzzyScore, rankFiles, searchFiles } from './search.ts';

const git = async (cwd: string, ...args: string[]): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });
    await proc.exited;
};

const seed = async (root: string): Promise<void> => {
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
};

describe('fuzzyScore', () => {
    test('needs every character in order and ignores case', () => {
        expect(fuzzyScore('cmp', 'src/chat/Composer.ts')).not.toBeNull();
        expect(fuzzyScore('pmc', 'src/chat/composer.ts')).toBeNull();
        expect(fuzzyScore('', 'anything')).toBe(0);
    });

    test('prefers the file name over a directory hit and a prefix over a scattered match', () => {
        expect(rankFiles(['chat/x.ts', 'src/chat.ts', 'src/changes/hat.ts'], 'chat', 3)).toEqual(['src/chat.ts', 'chat/x.ts', 'src/changes/hat.ts']);
    });

    test('rankFiles keeps the limit and breaks ties on length', () => {
        expect(rankFiles(['b/index.ts', 'index.ts', 'a/index.ts'], '', 2)).toEqual(['index.ts', 'a/index.ts']);
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

    test('inside a repo it follows .gitignore and sees untracked files', async () => {
        await git(root, 'init', '-q');
        await writeFile(join(root, '.gitignore'), '*.log\nnode_modules\n');
        const { files } = await searchFiles(root, '');
        expect(files).toContain('src/index.ts');
        expect(files).toContain('.gitignore');
        expect(files).not.toContain('secret.log');
        expect(files.some((file) => file.startsWith('node_modules'))).toBe(false);
    });

    test('ranks the query and honors the limit', async () => {
        const { files } = await searchFiles(root, 'comp', 1);
        expect(files).toEqual(['src/chat/composer.ts']);
    });
});
