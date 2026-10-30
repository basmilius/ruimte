import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { appendFile, cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRepos, MAX_REPOS, parseSubmodulePaths, repoLabel } from './repos.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

/* A folder full of checkouts, the arrangement a set of small apps in one place has. */
let workspace: RepoTemplate;
/* A repository with a submodule and a checkout it ignores, which is what a monolith with modules has. */
let parent: RepoTemplate;
const copies = new Set<string>();

async function copy(template: RepoTemplate): Promise<string> {
    const root = await template.copy();
    copies.add(root);
    return root;
}

afterEach(async () => {
    for (const root of copies) {
        await rm(root, { recursive: true, force: true, maxRetries: 5 });
        expect(await stat(root).catch(() => null)).toBeNull();
        copies.delete(root);
    }
});

beforeAll(async () => {
    workspace = await repoTemplate('ruimte-repos-workspace', async (dir) => {
        const folder = join(dir, 'workspace');
        // Copies, since what is listed is that a checkout is there, and every git process costs on Windows.
        await initRepo(join(folder, 'alpha'), { 'a.txt': 'a\n' });
        await cp(join(folder, 'alpha'), join(folder, 'beta'), { recursive: true });
        await cp(join(folder, 'alpha'), join(folder, 'node_modules', 'dep'), { recursive: true });
        await mkdir(join(folder, 'notes'), { recursive: true });
        await writeFile(join(folder, 'notes', 'todo.md'), 'todo\n');
    });
    parent = await repoTemplate('ruimte-repos-parent', async (dir) => {
        await initRepo(join(dir, 'origin'), { 'o.txt': 'o\n' });
        const repo = join(dir, 'parent');
        await initRepo(repo, { 'p.txt': 'p\n', '.gitignore': 'tools/\n' });
        await cp(join(dir, 'origin'), join(repo, 'tools'), { recursive: true });
        // What `git submodule add` leaves behind, without the shell script and the clone it takes on Windows.
        await cp(join(dir, 'origin'), join(repo, 'backend'), { recursive: true });
        await writeFile(join(repo, '.gitmodules'), '[submodule "backend"]\n\tpath = backend\n\turl = ../origin\n');
        const commit = (await gitIn(repo, ['-C', 'backend', 'rev-parse', 'HEAD'])).trim();
        await gitIn(repo, ['update-index', '--add', '--cacheinfo', `160000,${commit},backend`, '.gitmodules']);
        await appendFile(join(repo, '.git', 'config'), '[submodule "backend"]\n\tactive = true\n\turl = ../origin\n');
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
        expect(repoLabel('/work/app', '/work/app/..vendored/ui')).toBe('..vendored/ui');
    });

    test('the folder itself reads as its own name', () => {
        expect(repoLabel('/work/app', '/work/app')).toBe('app');
    });

    test('so does a repository the folder is only a corner of', () => {
        expect(repoLabel('/work/app/apps/client', '/work/app')).toBe('app');
    });

    test('writes the path under a folder on Windows with forward slashes', () => {
        expect(repoLabel('C:\\work\\app', 'C:\\work\\app\\packages\\ui', 'win32')).toBe('packages/ui');
        expect(repoLabel('C:\\work\\app\\apps\\client', 'C:\\work\\app', 'win32')).toBe('app');
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
        const dir = await copy(workspace);
        const folder = join(dir, 'workspace');
        const { repos, truncated } = await listRepos(folder);
        expect(truncated).toBe(false);
        expect(repos).toEqual([
            { path: join(folder, 'alpha'), label: 'alpha', kind: 'nested' },
            { path: join(folder, 'beta'), label: 'beta', kind: 'nested' }
        ]);
    });

    test('a checkout that declares a name carries it beside its label, the Ruimte project over the editor', async () => {
        const dir = await copy(workspace);
        const folder = join(dir, 'workspace');
        await mkdir(join(folder, 'alpha', '.idea'), { recursive: true });
        await writeFile(join(folder, 'alpha', '.idea', '.name'), 'Alpha app\n');
        await mkdir(join(folder, 'beta', '.idea'), { recursive: true });
        await writeFile(join(folder, 'beta', '.idea', '.name'), 'Beta editor\n');
        await mkdir(join(folder, 'beta', '.ruimte'), { recursive: true });
        await writeFile(join(folder, 'beta', '.ruimte', 'project.json'), JSON.stringify({ version: 3, name: 'Beta project', color: '#000', views: [] }));
        const { repos } = await listRepos(folder);
        expect(repos.map((repo) => [repo.label, repo.name])).toEqual([
            ['alpha', 'Alpha app'],
            ['beta', 'Beta project']
        ]);
    });

    test('the folder itself comes first', async () => {
        const dir = await copy(parent);
        const folder = join(dir, 'parent');
        await rm(join(folder, '.gitmodules'));
        const { repos } = await listRepos(folder);
        expect(repos[0]).toEqual({ path: folder, label: 'parent', kind: 'root' });
    });

    test('a checkout the repository ignores is not one the panel offers', async () => {
        const dir = await copy(parent);
        // Without it no `git submodule` runs, the one call here that costs a shell on Windows and has its test above.
        await rm(join(dir, 'parent', '.gitmodules'));
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
        const dir = await copy(parent);
        const { repos } = await listRepos(join(dir, 'parent', 'backend'));
        expect(repos.map((repo) => repo.kind)).toEqual(['root']);
        expect(repos[0]?.label).toBe('backend');
    });
});
