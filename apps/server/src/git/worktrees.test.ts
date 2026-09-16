import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent } from '../sessions/manager.ts';
import { checkpointIndexFile, Checkpoints } from './checkpoints.ts';
import { forgetBase } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';
import { countStatus, Worktrees } from './worktrees.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let home: string;
let worktrees: Worktrees;

const git = (args: string[]): Promise<string> => gitIn(repo, args);
const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );
const branchList = async (): Promise<string[]> => (await git(['branch', '--list', '--format=%(refname:short)'])).split('\n').filter(Boolean).sort();

beforeAll(async () => {
    template = await repoTemplate('ruimte-git', (dir) => initRepo(join(dir, 'repo'), { 'README.md': 'hi', '.gitignore': 'build/\n' }));
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    forgetBase();
    root = await template.copy();
    repo = join(root, 'repo');
    home = join(root, 'home');
    worktrees = new Worktrees(home, () => 1789999999);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('Worktrees', () => {
    test('adds a worktree for a new branch under the app data dir, lists it, answers the same one again, removes it', async () => {
        const added = await worktrees.add(repo, 'feature/x');
        expect(added.created).toBe(true);
        expect(added.worktree.branch).toBe('feature/x');
        expect(added.worktree.path.startsWith(join(root, 'home', 'worktrees'))).toBe(true);
        expect((await stat(join(added.worktree.path, 'README.md'))).isFile()).toBe(true);

        expect(await worktrees.list(repo)).toEqual([added.worktree]);
        expect(await worktrees.add(repo, 'feature/x')).toEqual({ worktree: added.worktree, created: false });

        expect(await worktrees.remove(repo, added.worktree.path)).toMatchObject({ branchDeleted: true });
        expect(await worktrees.list(repo)).toEqual([]);
        await expect(worktrees.remove(repo, added.worktree.path)).rejects.toMatchObject({ code: 'worktree-not-found' });
    });

    test('an existing branch gets a worktree without a new branch, and removing it leaves that branch alone', async () => {
        await git(['branch', 'existing']);
        const added = await worktrees.add(repo, 'existing');
        expect(added.created).toBe(true);
        expect((await worktrees.list(repo)).map((entry) => entry.branch)).toEqual(['existing']);

        expect(await worktrees.remove(repo, added.worktree.path)).toEqual({ branchDeleted: false });
        expect(await branchList()).toEqual(['existing', 'main']);
    });

    test('a folder outside a repository is refused', async () => {
        await expect(worktrees.add(root, 'x')).rejects.toMatchObject({ code: 'not-a-repo' });
    });

    test('the register holds the branch and commit the checkout was on, and a new daemon over the same home reads it', async () => {
        await git(['checkout', '--quiet', '-b', 'feature']);
        await git(['commit', '--quiet', '--allow-empty', '--message', 'on feature']);
        const head = (await git(['rev-parse', 'HEAD'])).trim();
        const added = await worktrees.add(repo, 'lexer', { madeBy: 'client', projectId: 'project-1' });
        await worktrees.claim(repo, added.worktree.path, 'chat-lexer');

        const restarted = new Worktrees(home);
        expect(await restarted.list(repo)).toEqual([
            {
                path: added.worktree.path,
                branch: 'lexer',
                from: { branch: 'feature', commit: head },
                projectId: 'project-1',
                nodeId: 'chat-lexer',
                madeAt: 1789999999
            }
        ]);
        const file = restarted.registerOf(repo).file;
        expect(file.startsWith(join(home, 'worktrees', 'repo-'))).toBe(true);
        const onDisk = JSON.parse(await readFile(file, 'utf8'));
        expect(onDisk.worktrees[added.worktree.path]).toMatchObject({ madeBy: 'client', branchMade: true });
    });

    test('a path inside a worktree names the same repository as the project folder', async () => {
        const added = await worktrees.add(repo, 'lexer');
        expect(await worktrees.list(added.worktree.path)).toEqual(await worktrees.list(repo));
    });

    test('inspecting counts changed files, untracked files one by one without the ignored ones, and commits the from branch lacks', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await mkdir(join(worktree.path, 'src', 'deep'), { recursive: true });
        await writeFile(join(worktree.path, 'src', 'a.ts'), 'a');
        await writeFile(join(worktree.path, 'src', 'deep', 'b.ts'), 'b');
        await mkdir(join(worktree.path, 'build'));
        await writeFile(join(worktree.path, 'build', 'out.js'), 'ignored');
        await writeFile(join(worktree.path, 'README.md'), 'changed');
        await gitIn(worktree.path, ['commit', '--quiet', '--allow-empty', '--message', 'one']);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed?.work).toEqual({ changed: 1, untracked: 2, ahead: 1 });
    });

    test('removing without force refuses an untracked file with the counts and leaves the folder', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await writeFile(join(worktree.path, 'notes.md'), 'draft');

        const refused = worktrees.remove(repo, worktree.path);
        await expect(refused).rejects.toMatchObject({ code: 'worktree-has-work' });
        await expect(refused).rejects.toThrow('lexer holds 0 uncommitted files, 1 new file and 0 commits that main lacks');
        expect(await exists(join(worktree.path, 'notes.md'))).toBe(true);
        expect((await worktrees.list(repo)).map((entry) => entry.branch)).toEqual(['lexer']);
    });

    test('with force the folder, the branch, the register entry and the checkpoint index all go, and the answer says where the branch was', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await writeFile(join(worktree.path, 'work.md'), 'work');
        await gitIn(worktree.path, ['add', '.']);
        await gitIn(worktree.path, ['commit', '--quiet', '--message', 'work']);
        const tip = (await gitIn(worktree.path, ['rev-parse', 'HEAD'])).trim();
        await writeFile(join(worktree.path, 'more.md'), 'more');
        await new Checkpoints(home).take(worktree.path);
        const index = join(home, 'checkpoints', checkpointIndexFile(worktree.path));
        expect(await exists(index)).toBe(true);

        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-has-work' });
        expect(await worktrees.remove(repo, worktree.path, { force: true })).toEqual({ branchDeleted: true, branchCommit: tip });

        expect(await exists(worktree.path)).toBe(false);
        expect(await branchList()).toEqual(['main']);
        expect((await worktrees.registerOf(repo).read()).size).toBe(0);
        expect(await exists(index)).toBe(false);
    });

    test('a branch whose commits are merged into the from branch goes without force', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await gitIn(worktree.path, ['commit', '--quiet', '--allow-empty', '--message', 'done']);
        await git(['merge', '--quiet', '--no-edit', '--no-ff', 'lexer']);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed?.work).toEqual({ changed: 0, untracked: 0, ahead: 0, behind: 1 });
        expect(await worktrees.remove(repo, worktree.path)).toMatchObject({ branchDeleted: true });
        expect(await branchList()).toEqual(['main']);
    });

    test('a worktree whose folder was deleted by hand is missing, and removing it prunes it', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await rm(worktree.path, { recursive: true, force: true });

        expect(await git(['worktree', 'list', '--porcelain'])).toContain('prunable');
        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed).toMatchObject({ branch: 'lexer', missing: true, work: { changed: 0, untracked: 0, ahead: 0 } });

        expect(await worktrees.remove(repo, worktree.path)).toMatchObject({ branchDeleted: true });
        expect(await git(['worktree', 'list', '--porcelain'])).not.toContain(worktree.path);
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('a branch left behind by a worktree removed with git itself is listed as missing and only goes with force when it holds commits', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await gitIn(worktree.path, ['commit', '--quiet', '--allow-empty', '--message', 'kept']);
        await git(['worktree', 'remove', worktree.path]);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed).toMatchObject({ path: worktree.path, branch: 'lexer', missing: true, work: { ahead: 1 } });
        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-has-work' });
        expect(await worktrees.remove(repo, worktree.path, { force: true })).toMatchObject({ branchDeleted: true });
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('a locked worktree is refused without force and removed with it', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await git(['worktree', 'lock', worktree.path]);

        expect((await worktrees.list(repo))[0]).toMatchObject({ locked: true });
        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-locked' });
        await worktrees.remove(repo, worktree.path, { force: true });
        expect(await exists(worktree.path)).toBe(false);
    });

    test('a worktree whose agent switched to another branch keeps both branches', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await gitIn(worktree.path, ['checkout', '--quiet', '-b', 'other']);

        expect(await worktrees.remove(repo, worktree.path)).toEqual({ branchDeleted: false });
        expect(await branchList()).toEqual(['lexer', 'main', 'other']);
    });

    test('a merge that stopped on a conflict is work', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        await writeFile(join(worktree.path, 'README.md'), 'lexer');
        await gitIn(worktree.path, ['commit', '--quiet', '--all', '--message', 'lexer']);
        await writeFile(join(repo, 'README.md'), 'main');
        await git(['commit', '--quiet', '--all', '--message', 'main']);
        await gitIn(worktree.path, ['merge', 'main']).catch(() => undefined);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed?.work).toMatchObject({ operation: 'merge' });
        await expect(worktrees.remove(repo, worktree.path)).rejects.toThrow('a merge stopped halfway');
    });

    test('every subscriber hears that the worktrees changed', async () => {
        const events: SessionEvent[] = [];
        const stop = worktrees.subscribe('client-1', (event) => events.push(event));
        const { worktree } = await worktrees.add(repo, 'lexer');
        await worktrees.remove(repo, worktree.path);
        stop();
        await worktrees.add(repo, 'parser');
        expect(events).toEqual([
            { event: 'git.worktrees', payload: { repo } },
            { event: 'git.worktrees', payload: { repo } }
        ]);
    });

    test('two removals of the same worktree run one after the other, and whichever comes second finds it gone', async () => {
        const { worktree } = await worktrees.add(repo, 'lexer');
        const results = await Promise.allSettled([worktrees.remove(repo, worktree.path), worktrees.remove(repo, worktree.path)]);
        // Each call reads the repository before it queues, so which of the two queues first is not fixed; that one removes it.
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'worktree-not-found' } });
    });
});

describe('countStatus', () => {
    test('a rename is one change and its old path is not read as an entry of its own', () => {
        const output = [
            '1 .M N... 100644 100644 100644 a b README.md',
            '2 R. N... 100644 100644 100644 a b R100 new.md',
            '? looks-untracked.md',
            '? notes.md',
            'u UU N... 1 2 3 4 a b c x.md',
            '! build/out.js',
            ''
        ].join('\0');
        expect(countStatus(output)).toEqual({ changed: 3, untracked: 1 });
    });
});
