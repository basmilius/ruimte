import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRepos, MAX_REPOS, parseSubmodulePaths, repoLabel } from './repos.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

/* A folder full of checkouts, the arrangement a set of small apps in one place has. */
let workspace: RepoTemplate;
/* A repository with a submodule and a checkout it ignores, which is what a monolith with modules has. */
let parent: RepoTemplate;

beforeAll(async () => {
    workspace = await repoTemplate('ruimte-repos-workspace', async (dir) => {
        const folder = join(dir, 'workspace');
        await initRepo(join(folder, 'alpha'), { 'a.txt': 'a\n' });
        await initRepo(join(folder, 'beta'), { 'b.txt': 'b\n' });
        await initRepo(join(folder, 'node_modules', 'dep'), { 'd.txt': 'd\n' });
        await mkdir(join(folder, 'notes'), { recursive: true });
        await writeFile(join(folder, 'notes', 'todo.md'), 'todo\n');
    });
    parent = await repoTemplate('ruimte-repos-parent', async (dir) => {
        await initRepo(join(dir, 'origin'), { 'o.txt': 'o\n' });
        const repo = join(dir, 'parent');
        await initRepo(repo, { 'p.txt': 'p\n', '.gitignore': 'tools/\n' });
        await initRepo(join(repo, 'tools'), { 't.txt': 't\n' });
        await gitIn(repo, ['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', join(dir, 'origin'), 'backend']);
        await gitIn(repo, ['commit', '--quiet', '--message', 'add backend']);
    });
});

afterAll(async () => {
    await workspace.dispose();
    await parent.dispose();
});

describe('repoLabel', () => {
    test('a repository under the folder reads as its path there', () => {
        expect(repoLabel('/work/app', '/work/app/packages/ui')).toBe('packages/ui');
    });

    test('the folder itself reads as its own name', () => {
        expect(repoLabel('/work/app', '/work/app')).toBe('app');
    });

    test('so does a repository the folder is only a corner of', () => {
        expect(repoLabel('/work/app/apps/client', '/work/app')).toBe('app');
    });
});

describe('parseSubmodulePaths', () => {
    test('reads the path out of every line, whatever state it reports', () => {
        const output = [' 93e23dd backend (heads/main)', '+941f79a frontend (heads/main)', 'U0000000 broken'].join('\n');
        expect(parseSubmodulePaths(output)).toEqual(['backend', 'frontend', 'broken']);
    });

    test('a submodule that was never initialized has no checkout to read', () => {
        expect(parseSubmodulePaths('-93e23dd backend\n')).toEqual([]);
    });

    test('a nested submodule keeps the path the recursion reports', () => {
        expect(parseSubmodulePaths(' abc packages/ui/vendor/theme (v1.0)\n')).toEqual(['packages/ui/vendor/theme']);
    });
});

describe('listRepos', () => {
    test('a folder that is no repository still has the ones sitting in it', async () => {
        const dir = await workspace.copy();
        const folder = join(dir, 'workspace');
        const { repos, truncated } = await listRepos(folder);
        expect(truncated).toBe(false);
        expect(repos).toEqual([
            { path: join(folder, 'alpha'), label: 'alpha', kind: 'nested' },
            { path: join(folder, 'beta'), label: 'beta', kind: 'nested' }
        ]);
    });

    test('the folder itself comes first, then its submodules', async () => {
        const dir = await parent.copy();
        const folder = join(dir, 'parent');
        const { repos } = await listRepos(folder);
        expect(repos[0]).toEqual({ path: folder, label: 'parent', kind: 'root' });
        expect(repos.map((repo) => repo.label)).toContain('backend');
        expect(repos.find((repo) => repo.label === 'backend')?.kind).toBe('submodule');
    });

    test('a checkout the repository ignores is not one the panel offers', async () => {
        const dir = await parent.copy();
        const { repos } = await listRepos(join(dir, 'parent'));
        expect(repos.map((repo) => repo.label)).not.toContain('tools');
    });

    test('more repositories than the list carries says so', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-repos-many-'));
        try {
            // A `.git` is all a checkout is recognized by, so this needs no git at all.
            for (let index = 0; index <= MAX_REPOS; index += 1) {
                await mkdir(join(folder, `repo-${String(index).padStart(2, '0')}`, '.git'), { recursive: true });
            }
            const { repos, truncated } = await listRepos(folder);
            expect(repos).toHaveLength(MAX_REPOS);
            expect(truncated).toBe(true);
            expect(repos[0]?.label).toBe('repo-00');
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });

    test('a repository the folder is only a corner of is the one it acts on', async () => {
        const dir = await parent.copy();
        const { repos } = await listRepos(join(dir, 'parent', 'backend'));
        expect(repos.map((repo) => repo.kind)).toEqual(['root']);
        expect(repos[0]?.label).toBe('backend');
    });
});
