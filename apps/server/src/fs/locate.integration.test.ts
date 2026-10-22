import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from '../git/test-repo.ts';
import { cachedRepos, forgetRepos } from '../git/repo-cache.ts';
import { locateFile } from './locate.ts';
import { NO_MACHINE_HOME } from './machine-home.ts';
import { forgetSearchCache, listSearchableFiles, searchFiles } from './search.ts';

let template: RepoTemplate;
let root: string;

beforeAll(async () => {
    template = await repoTemplate('locate', async (dir) => {
        await initRepo(join(dir, 'origin'), { 'README.md': 'lib\n' });
        await mkdir(join(dir, 'origin', 'src'), { recursive: true });
        await writeFile(join(dir, 'origin', 'src', 'a.ts'), 'export const a = 1;\n');
        await gitIn(join(dir, 'origin'), ['add', '.']);
        await gitIn(join(dir, 'origin'), ['commit', '--quiet', '--message', 'a']);
        await initRepo(join(dir, 'project'), { 'package.json': '{}\n' });
        await gitIn(join(dir, 'project'), ['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', join(dir, 'origin'), 'lib']);
        await gitIn(join(dir, 'project'), ['commit', '--quiet', '--message', 'lib']);
    });
});

afterAll(async () => {
    await template.dispose();
});

afterEach(async () => {
    forgetRepos();
    forgetSearchCache();
    await rm(root, { recursive: true, force: true });
});

describe('a project with a submodule', () => {
    test('a link the agent wrote from the root of the submodule opens the file in it', async () => {
        root = await template.copy();
        const project = join(root, 'project');
        expect((await locateFile({ path: 'src/a.ts', cwd: project })).matches).toEqual([join(project, 'lib', 'src', 'a.ts')]);
    });

    test('a chat in a worktree finds the file in the checkout the worktree has no submodule in', async () => {
        root = await template.copy();
        const project = join(root, 'project');
        const worktree = join(root, 'worktree');
        await gitIn(project, ['worktree', 'add', '--quiet', worktree]);
        expect((await locateFile({ path: 'lib/src/a.ts', cwd: worktree, folder: project })).matches).toEqual([join(project, 'lib', 'src', 'a.ts')]);
    });

    test('a link that names only the file opens it deeper in the tree, and never an ignored copy', async () => {
        root = await template.copy();
        const project = join(root, 'project');
        await writeFile(join(project, '.gitignore'), 'dist/\n');
        await mkdir(join(project, 'dist'), { recursive: true });
        await writeFile(join(project, 'dist', 'a.ts'), '');
        const list = async (folder: string): Promise<string[]> => (await listSearchableFiles(folder)).files;
        const deps = { repos: (folder: string) => cachedRepos(folder), policy: NO_MACHINE_HOME, list };
        expect((await locateFile({ path: 'a.ts', cwd: project }, deps)).matches).toEqual([join(project, 'lib', 'src', 'a.ts')]);
    });

    test('the composer finds a file of the submodule by its name', async () => {
        root = await template.copy();
        const result = await searchFiles(join(root, 'project'), 'a.ts');
        expect(result.files).toContain('lib/src/a.ts');
        expect(result.files).not.toContain('lib');
    });
});
