import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readProjectSettings, sharedPathOf, updateProjectSettings } from '../projects/project-settings.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';
import { Worktrees } from './worktrees.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let worktrees: Worktrees;
let logged: string[];

const exists = (path: string): Promise<boolean> =>
    lstat(path).then(
        () => true,
        () => false
    );

beforeAll(async () => {
    // A directory pattern, the way most projects ignore node_modules, which git does not apply to a symlink.
    template = await repoTemplate('ruimte-share', (dir) => initRepo(join(dir, 'repo'), { 'README.md': 'hi\n', '.gitignore': 'node_modules/\n.env\n' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    repo = join(root, 'repo');
    logged = [];
    worktrees = new Worktrees(
        join(root, 'home'),
        () => 1,
        (line) => logged.push(line)
    );
    await mkdir(join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('shared paths', () => {
    test('an ignored node_modules is linked into a new worktree, git status there says nothing, and removing the worktree leaves the original', async () => {
        await updateProjectSettings(repo, { worktrees: { share: ['node_modules'] } });

        const { worktree } = await worktrees.add(repo, 'lexer');

        const link = join(worktree.path, 'node_modules');
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        expect(await readlink(link)).toBe(join(repo, 'node_modules'));
        expect(await gitIn(worktree.path, ['status', '--porcelain'])).toBe('');
        expect((await worktrees.list(repo, { inspect: true }))[0]?.work).toEqual({ changed: 0, untracked: 0, ahead: 0 });

        await worktrees.remove(repo, worktree.path, { force: true });
        expect(await readFile(join(repo, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
        // The project folder still ignores what it ignored.
        expect(await gitIn(repo, ['status', '--porcelain'])).toContain('.ruimte/');
        expect(await gitIn(repo, ['status', '--porcelain'])).not.toContain('node_modules');
    });

    test('a path that does not exist is skipped, and a tracked or unignored one is not linked and says why', async () => {
        await writeFile(join(repo, 'loose.txt'), 'not ignored\n');
        await updateProjectSettings(repo, { worktrees: { share: ['missing', 'README.md', 'loose.txt', 'node_modules'] } });

        const { worktree } = await worktrees.add(repo, 'lexer');

        expect(await exists(join(worktree.path, 'missing'))).toBe(false);
        expect((await lstat(join(worktree.path, 'README.md'))).isSymbolicLink()).toBe(false);
        expect(await exists(join(worktree.path, 'loose.txt'))).toBe(false);
        expect((await lstat(join(worktree.path, 'node_modules'))).isSymbolicLink()).toBe(true);
        expect(logged).toEqual([
            `Not sharing README.md with ${worktree.path}: git tracks it, so a link would show as a change there.`,
            `Not sharing loose.txt with ${worktree.path}: git does not ignore it, so a link would count as a new file there. Add it to .gitignore.`
        ]);
    });

    test('without settings nothing is linked', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        expect(await exists(join(worktree.path, 'node_modules'))).toBe(false);
        expect(await stat(join(repo, '.git', 'info', 'exclude')).then((file) => file.isFile())).toBe(true);
        expect(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')).not.toContain('Ruimte');
    });
});

describe('project settings', () => {
    test('an update writes the fields it names, keeps keys it does not know, and a new daemon reads it back', async () => {
        await mkdir(join(repo, '.ruimte'), { recursive: true });
        await writeFile(join(repo, '.ruimte', 'settings.json'), JSON.stringify({ terminal: { mode: 'plan' }, worktrees: { later: true } }));

        expect(await updateProjectSettings(repo, { worktrees: { share: ['node_modules/', './.env', 'node_modules'] } })).toEqual({
            worktrees: { share: ['node_modules', '.env'] }
        });
        const raw = JSON.parse(await readFile(join(repo, '.ruimte', 'settings.json'), 'utf8'));
        expect(raw).toEqual({ terminal: { mode: 'plan' }, worktrees: { later: true, share: ['node_modules', '.env'] } });
        expect(await readProjectSettings(repo)).toEqual({ worktrees: { share: ['node_modules', '.env'] } });
    });

    test('a shared path stays inside the project folder', () => {
        expect(sharedPathOf('node_modules/')).toBe('node_modules');
        expect(sharedPathOf('apps\\web\\node_modules')).toBe('apps/web/node_modules');
        expect(sharedPathOf('../elsewhere')).toBeNull();
        expect(sharedPathOf('/etc')).toBeNull();
        expect(sharedPathOf('.')).toBeNull();
        expect(sharedPathOf('.git/hooks')).toBeNull();
    });
});
