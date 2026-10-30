import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from '@adecore/agents';
import type { Worktree } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { checkpointIndexFile, Checkpoints } from './checkpoints.ts';
import { forgetBase } from './status.ts';
import { gitIn, initRepo, repoSnapshots, type RepoSnapshots, NO_WORKTREE_AGENTS } from './test-repo.ts';
import { countStatus, Worktrees } from './worktrees.ts';
import * as runner from './run.ts';

let snapshots: RepoSnapshots;
let madeLexer: Worktree;
let root: string;
let repo: string;
let home: string;
let worktrees: Worktrees;

function git(args: string[]): Promise<string> {
    return gitIn(repo, args);
}

async function branchList(): Promise<string[]> {
    return (await git(['branch', '--list', '--format=%(refname:short)'])).split('\n').filter(Boolean).sort();
}

/* Writes a file into the worktree just before git is asked to remove it, the gap between the count and the removal. */
function writeBeforeRemoval(path: string): { spy: ReturnType<typeof spyOn>; reached(): boolean } {
    const runGit = runner.runGit;
    let reached = false;
    const spy = spyOn(runner, 'runGit').mockImplementation(async (args, cwd, options) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
            reached = true;
            await writeFile(join(path, 'late.md'), 'late');
        }
        return runGit(args, cwd, options);
    });
    return { spy, reached: () => reached };
}

/* The worktree most tests are about, as `worktrees.add(repo, 'lexer')` made it once for the file. */
async function lexer(): Promise<Worktree> {
    await snapshots.restore('lexer');
    return madeLexer;
}

beforeAll(async () => {
    snapshots = await repoSnapshots('ruimte-git');
    root = snapshots.root;
    repo = join(root, 'repo');
    home = join(root, 'home');
    await initRepo(repo, { 'README.md': 'hi', '.gitignore': 'build/\n' });
    await snapshots.take('main');
    madeLexer = (await new Worktrees(home, NO_WORKTREE_AGENTS, () => 1789999999).add(repo, 'lexer')).worktree;
    await snapshots.take('lexer');
});

afterAll(async () => {
    await snapshots.dispose();
});

beforeEach(async () => {
    forgetBase();
    await snapshots.restore('main');
    worktrees = new Worktrees(home, NO_WORKTREE_AGENTS, () => 1789999999);
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

    test('a new branch starts at the base it was given, a tag or a commit, and the register names it', async () => {
        const first = (await git(['rev-parse', 'HEAD'])).trim();
        await git(['tag', 'v1']);
        await writeFile(join(repo, 'later.txt'), 'later');
        await git(['add', '.']);
        await git(['commit', '-q', '-m', 'later']);

        const tagged = await worktrees.add(repo, 'from-tag', { madeBy: 'client' }, { base: 'v1' });
        expect((await gitIn(tagged.worktree.path, ['rev-parse', 'HEAD'])).trim()).toBe(first);
        expect(tagged.worktree.from).toEqual({ branch: 'main', commit: first });

        const onMain = await worktrees.add(repo, 'from-main', { madeBy: 'client' }, { base: 'main' });
        expect(onMain.worktree.from?.branch).toBe('main');
        expect(await fileExists(join(onMain.worktree.path, 'later.txt'))).toBe(true);
    });

    test('a base that is no ref makes nothing, and neither does a base for a branch that exists', async () => {
        await expect(worktrees.add(repo, 'nope', { madeBy: 'client' }, { base: 'no-such-ref' })).rejects.toMatchObject({ code: 'ref-not-found' });
        expect(await fileExists(join(home, 'worktrees'))).toBe(false);
        expect(await branchList()).toEqual(['main']);

        await git(['branch', 'old']);
        await expect(worktrees.add(repo, 'old', { madeBy: 'client' }, { base: 'main' })).rejects.toMatchObject({ code: 'branch-exists' });
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('after the worktree folder changes an old worktree stays listed and removable while a new one lands in the new folder', async () => {
        let elsewhere: string | null = null;
        worktrees = new Worktrees(
            home,
            NO_WORKTREE_AGENTS,
            () => 1789999999,
            () => elsewhere
        );
        const old = await lexer();
        elsewhere = join(root, 'wt');
        const fresh = await worktrees.add(repo, 'fresh');

        expect(old.path.startsWith(join(home, 'worktrees'))).toBe(true);
        expect(fresh.worktree.path.startsWith(join(await realpath(root), 'wt'))).toBe(true);
        expect((await worktrees.list(repo)).map((entry) => entry.branch).sort()).toEqual(['fresh', 'lexer']);
        expect(await worktrees.registeredPaths(repo)).toEqual(expect.arrayContaining([old.path, fresh.worktree.path]));

        await worktrees.remove(repo, old.path);
        await worktrees.remove(repo, fresh.worktree.path);
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('two clients asking for the same branch and base get one checkout', async () => {
        const [first, second] = await Promise.all([
            worktrees.add(repo, 'same', { madeBy: 'client' }, { base: 'main' }),
            worktrees.add(repo, 'same', { madeBy: 'client' }, { base: 'main' })
        ]);
        expect([first.created, second.created].sort()).toEqual([false, true]);
        expect(second.worktree.path).toBe(first.worktree.path);
        expect(await worktrees.list(repo)).toHaveLength(1);
    });

    test('two fresh worktrees asked for at once under one name get a branch and a folder each', async () => {
        const [first, second] = await Promise.all([
            worktrees.addFresh(repo, 'claude', { madeBy: 'verb', nodeId: 'chat-a' }),
            worktrees.addFresh(repo, 'claude', { madeBy: 'verb', nodeId: 'chat-b' })
        ]);
        expect([first.branch, second.branch].sort()).toEqual(['claude', 'claude-2']);
        expect(first.path).not.toBe(second.path);
        expect(await branchList()).toEqual(['claude', 'claude-2', 'main']);
    });

    test('a named branch is taken again, except by an agent when its worktree was made for another node', async () => {
        const made = await worktrees.add(repo, 'shared', { madeBy: 'verb' });
        // Nobody claimed it yet, so an agent that names the branch lands in it.
        expect(await worktrees.add(repo, 'shared', { madeBy: 'verb' })).toEqual({ worktree: made.worktree, created: false });

        await worktrees.claim(repo, made.worktree.path, 'chat-a');
        await expect(worktrees.add(repo, 'shared', { madeBy: 'verb' })).rejects.toMatchObject({ code: 'worktree-taken' });
        await expect(worktrees.add(repo, 'shared', { madeBy: 'fork', nodeId: 'chat-b' })).rejects.toMatchObject({ code: 'worktree-taken' });
        expect((await worktrees.add(repo, 'shared', { madeBy: 'fork', nodeId: 'chat-a' })).created).toBe(false);
        // A person opens whichever worktree they like.
        expect((await worktrees.add(repo, 'shared')).created).toBe(false);
    });

    test('an agent that lands in a worktree a person made never becomes its owner', async () => {
        const made = await worktrees.add(repo, 'feature', { madeBy: 'client', projectId: 'project-1' });
        expect((await worktrees.add(repo, 'feature', { madeBy: 'verb', projectId: 'project-1' })).created).toBe(false);

        await worktrees.claim(repo, made.worktree.path, 'chat-a');
        expect((await worktrees.list(repo))[0]).not.toHaveProperty('nodeId');
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
        const added = await worktrees.add(repo, 'lexer', { madeBy: 'verb', projectId: 'project-1' });
        await worktrees.claim(repo, added.worktree.path, 'chat-lexer');

        const restarted = new Worktrees(home, NO_WORKTREE_AGENTS);
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
        expect(onDisk.worktrees[added.worktree.path]).toMatchObject({ madeBy: 'verb', branchMade: true });
    });

    test('a path inside a worktree names the same repository as the project folder', async () => {
        const added = await worktrees.add(repo, 'lexer');
        expect(await worktrees.list(added.worktree.path)).toEqual(await worktrees.list(repo));
    });

    test('inspecting counts changed files, untracked files one by one without the ignored ones, and commits the from branch lacks', async () => {
        const worktree = await lexer();
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
        const worktree = await lexer();
        await writeFile(join(worktree.path, 'notes.md'), 'draft');

        const refused = worktrees.remove(repo, worktree.path);
        await expect(refused).rejects.toMatchObject({ code: 'worktree-has-work' });
        await expect(refused).rejects.toThrow('lexer holds 0 uncommitted files, 1 new file and 0 commits that main lacks');
        expect(await fileExists(join(worktree.path, 'notes.md'))).toBe(true);
        expect((await worktrees.list(repo)).map((entry) => entry.branch)).toEqual(['lexer']);
    });

    test('a file written after the count but before the removal is refused by git itself, with the fresh numbers', async () => {
        const worktree = await lexer();
        const late = writeBeforeRemoval(worktree.path);
        try {
            const refused = worktrees.remove(repo, worktree.path);
            await expect(refused).rejects.toMatchObject({ code: 'worktree-has-work' });
            await expect(refused).rejects.toThrow('lexer holds 0 uncommitted files, 1 new file and 0 commits that main lacks');
            expect(late.reached()).toBe(true);
            expect(await readFile(join(worktree.path, 'late.md'), 'utf8')).toBe('late');
        } finally {
            late.spy.mockRestore();
        }
    });

    test('force still removes a worktree that gained a file in that gap', async () => {
        const worktree = await lexer();
        const late = writeBeforeRemoval(worktree.path);
        try {
            await worktrees.remove(repo, worktree.path, { force: true });
            expect(late.reached()).toBe(true);
            expect(await fileExists(worktree.path)).toBe(false);
        } finally {
            late.spy.mockRestore();
        }
    });

    test('an agent in a turn in the worktree refuses the removal, and stopAgent stops it first', async () => {
        const stopped: string[] = [];
        let working = true;
        worktrees = new Worktrees(
            home,
            {
                in: () => [{ nodeId: 'chat-a', working, live: true }],
                stop: async (nodeId) => {
                    stopped.push(nodeId);
                    working = false;
                }
            },
            () => 1789999999
        );
        const worktree = await lexer();

        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'agent-working' });
        expect(stopped).toEqual([]);

        await worktrees.remove(repo, worktree.path, { stopAgent: true });
        expect(stopped).toEqual(['chat-a']);
        expect(await fileExists(worktree.path)).toBe(false);
    });

    test('with force the folder, the branch, the register entry and the checkpoint index all go, and the answer says where the branch was', async () => {
        const worktree = await lexer();
        await writeFile(join(worktree.path, 'work.md'), 'work');
        await gitIn(worktree.path, ['add', '.']);
        await gitIn(worktree.path, ['commit', '--quiet', '--message', 'work']);
        const tip = (await gitIn(worktree.path, ['rev-parse', 'HEAD'])).trim();
        await writeFile(join(worktree.path, 'more.md'), 'more');
        await new Checkpoints(home).take(worktree.path);
        const index = join(home, 'checkpoints', checkpointIndexFile(worktree.path));
        expect(await fileExists(index)).toBe(true);

        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-has-work' });
        expect(await worktrees.remove(repo, worktree.path, { force: true })).toEqual({ branchDeleted: true, branchCommit: tip });

        expect(await fileExists(worktree.path)).toBe(false);
        expect(await branchList()).toEqual(['main']);
        expect((await worktrees.registerOf(repo).read()).size).toBe(0);
        expect(await fileExists(index)).toBe(false);
    });

    test('a branch whose commits are merged into the from branch goes without force', async () => {
        const worktree = await lexer();
        await gitIn(worktree.path, ['commit', '--quiet', '--allow-empty', '--message', 'done']);
        await git(['merge', '--quiet', '--no-edit', '--no-ff', 'lexer']);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed?.work).toEqual({ changed: 0, untracked: 0, ahead: 0, behind: 1 });
        expect(await worktrees.remove(repo, worktree.path)).toMatchObject({ branchDeleted: true });
        expect(await branchList()).toEqual(['main']);
    });

    test('a worktree whose folder was deleted by hand is missing, and removing it prunes it', async () => {
        const worktree = await lexer();
        await rm(worktree.path, { recursive: true, force: true });

        expect(await git(['worktree', 'list', '--porcelain'])).toContain('prunable');
        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed).toMatchObject({ branch: 'lexer', missing: true, work: { changed: 0, untracked: 0, ahead: 0 } });

        expect(await worktrees.remove(repo, worktree.path)).toMatchObject({ branchDeleted: true });
        expect(await git(['worktree', 'list', '--porcelain'])).not.toContain(worktree.path);
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('a branch left behind by a worktree removed with git itself is listed as missing and only goes with force when it holds commits', async () => {
        const worktree = await lexer();
        await gitIn(worktree.path, ['commit', '--quiet', '--allow-empty', '--message', 'kept']);
        await git(['worktree', 'remove', worktree.path]);

        const [listed] = await worktrees.list(repo, { inspect: true });
        expect(listed).toMatchObject({ path: worktree.path, branch: 'lexer', missing: true, work: { ahead: 1 } });
        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-has-work' });
        expect(await worktrees.remove(repo, worktree.path, { force: true })).toMatchObject({ branchDeleted: true });
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('a locked worktree is refused without force and removed with it', async () => {
        const worktree = await lexer();
        await git(['worktree', 'lock', worktree.path]);

        expect((await worktrees.list(repo))[0]).toMatchObject({ locked: true });
        await expect(worktrees.remove(repo, worktree.path)).rejects.toMatchObject({ code: 'worktree-locked' });
        await worktrees.remove(repo, worktree.path, { force: true });
        expect(await fileExists(worktree.path)).toBe(false);
    });

    test('a worktree whose agent switched to another branch keeps both branches', async () => {
        const worktree = await lexer();
        await gitIn(worktree.path, ['checkout', '--quiet', '-b', 'other']);

        expect(await worktrees.remove(repo, worktree.path)).toEqual({ branchDeleted: false });
        expect(await branchList()).toEqual(['lexer', 'main', 'other']);
    });

    test('a merge that stopped on a conflict is work', async () => {
        const worktree = await lexer();
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
        const worktree = await lexer();
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
