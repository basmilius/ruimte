import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorktreeMergePayload } from '@ruimte/contracts';
import { documentPathInFolder } from '../projects/project-files.ts';
import { forgetBase } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';
import { WorktreeMerge, type WorktreeAgent, type WorktreeAgents } from './worktree-merge.ts';
import { Worktrees } from './worktrees.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let worktrees: Worktrees;
let agents: FakeAgents;
let merges: WorktreeMerge;
let actions = 0;

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

class FakeAgents implements WorktreeAgents {
    rows: WorktreeAgent[] = [];
    asked = 0;
    stopped: string[] = [];
    onStop: (nodeId: string) => Promise<void> = async () => undefined;

    in(): WorktreeAgent[] {
        this.asked += 1;
        return this.rows;
    }

    async stop(nodeId: string): Promise<void> {
        await this.onStop(nodeId);
        this.stopped.push(nodeId);
        this.rows = this.rows.map((row) => (row.nodeId === nodeId ? { ...row, working: false, live: false } : row));
    }
}

const payload = (path: string, extra: Partial<WorktreeMergePayload>): WorktreeMergePayload => ({
    repo,
    path,
    actionId: `merge-${++actions}`,
    strategy: 'merge',
    ...extra
});

const run = (path: string, extra: Partial<WorktreeMergePayload> = {}) => merges.merge(payload(path, extra), () => undefined);

const count = async (range: string, ...flags: string[]): Promise<number> =>
    Number.parseInt((await gitIn(repo, ['rev-list', '--count', ...flags, range])).trim(), 10);

/* A worktree off main with a commit of its own. */
const lexer = async (file = 'lexer.txt', body = 'lexer\n'): Promise<string> => {
    const { worktree } = await worktrees.add(repo, 'lexer', { madeBy: 'verb', nodeId: 'chat-lexer' });
    await writeFile(join(worktree.path, file), body);
    await gitIn(worktree.path, ['add', '.']);
    await gitIn(worktree.path, ['commit', '--quiet', '--message', 'lexer']);
    return worktree.path;
};

beforeAll(async () => {
    template = await repoTemplate('ruimte-merge', async (dir) => {
        const at = join(dir, 'repo');
        await initRepo(at, { 'README.md': 'hi\n', 'shared.txt': 'one\n' });
        // The daemon commits with whatever identity the repository has; the fixture's own is enough.
        await gitIn(at, ['config', 'user.name', 'Ada']);
        await gitIn(at, ['config', 'user.email', 'a@a']);
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    forgetBase();
    root = await template.copy();
    repo = join(root, 'repo');
    worktrees = new Worktrees(join(root, 'home'), () => 1);
    agents = new FakeAgents();
    merges = new WorktreeMerge(worktrees, agents);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('WorktreeMerge', () => {
    test('merge commits the uncommitted work first, lands a merge commit on main and removes the worktree', async () => {
        const path = await lexer();
        await writeFile(join(path, 'notes.txt'), 'new\n');
        const before = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        const result = await run(path, { commitFirst: true, subject: 'Lexer: work of the agent', remove: true });

        expect(result).toMatchObject({ into: 'main', cwd: repo, removed: true, branchDeleted: true });
        expect(result.conflicts).toBeUndefined();
        expect(await readFile(join(repo, 'notes.txt'), 'utf8')).toBe('new\n');
        expect(await count(`${before}..main`, '--merges')).toBe(1);
        expect(await gitIn(repo, ['log', '--format=%s', 'main'])).toContain('Lexer: work of the agent');
        expect(await exists(path)).toBe(false);
        expect(await worktrees.list(repo)).toEqual([]);
    });

    test('squash lands exactly one commit on main and deletes the branch whose commits main does not have', async () => {
        const path = await lexer();
        await writeFile(join(path, 'more.txt'), 'more\n');
        await gitIn(path, ['add', '.']);
        await gitIn(path, ['commit', '--quiet', '--message', 'more']);
        const before = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        const result = await run(path, { strategy: 'squash', subject: 'Lexer', remove: true });

        expect(result).toMatchObject({ removed: true, branchDeleted: true });
        expect(await count(`${before}..main`)).toBe(1);
        expect((await gitIn(repo, ['log', '-1', '--format=%s'])).trim()).toBe('Lexer');
        expect(await exists(join(repo, 'more.txt'))).toBe(true);
        expect((await gitIn(repo, ['branch', '--list', 'lexer'])).trim()).toBe('');
    });

    test('a squash whose content main already has commits nothing and still removes the worktree', async () => {
        const path = await lexer();
        await gitIn(repo, ['cherry-pick', '--quiet', 'lexer']);
        const before = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        const result = await run(path, { strategy: 'squash', subject: 'Lexer', remove: true });

        expect(result).toMatchObject({ summary: 'main already has everything in lexer.', removed: true, branchDeleted: true });
        expect((await gitIn(repo, ['rev-parse', 'main'])).trim()).toBe(before);
    });

    test('without remove the worktree stays, and uncommitted work without commitFirst is refused', async () => {
        const path = await lexer();
        await writeFile(join(path, 'loose.txt'), 'x\n');
        await expect(run(path)).rejects.toMatchObject({ code: 'worktree-has-work' });

        const result = await run(path, { commitFirst: true });
        expect(result.removed).toBeUndefined();
        expect(await exists(path)).toBe(true);
    });

    test('rebase on a main that moved on leaves a linear history', async () => {
        const path = await lexer();
        await writeFile(join(repo, 'later.txt'), 'later\n');
        await gitIn(repo, ['add', '.']);
        await gitIn(repo, ['commit', '--quiet', '--message', 'later on main']);

        await run(path, { strategy: 'rebase' });

        expect(await count('main', '--merges')).toBe(0);
        expect(await exists(join(repo, 'lexer.txt'))).toBe(true);
        expect((await gitIn(repo, ['log', '--format=%s', 'main'])).split('\n').slice(0, 3)).toEqual(['lexer', 'later on main', 'init']);
    });

    test('a conflict in a merge stays in the target with its files, and abort makes the checkout clean again', async () => {
        const path = await lexer('shared.txt', 'from lexer\n');
        await writeFile(join(repo, 'shared.txt'), 'from main\n');
        await gitIn(repo, ['commit', '--quiet', '--all', '--message', 'main edit']);

        const result = await run(path, { remove: true });

        expect(result.conflicts).toEqual(['shared.txt']);
        expect(result.removed).toBeUndefined();
        expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
        expect(await exists(path)).toBe(true);

        await merges.abort(repo);
        expect(await exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
        expect((await gitIn(repo, ['status', '--porcelain'])).trim()).toBe('');
    });

    test('a conflict in a squash is taken back by abort, and the person’s unrelated change stays', async () => {
        const path = await lexer('shared.txt', 'from lexer\n');
        await writeFile(join(repo, 'shared.txt'), 'from main\n');
        await gitIn(repo, ['commit', '--quiet', '--all', '--message', 'main edit']);
        await writeFile(join(repo, 'README.md'), 'my own edit\n');

        const result = await run(path, { strategy: 'squash', subject: 'Lexer' });
        expect(result.conflicts).toEqual(['shared.txt']);

        await merges.abort(repo);
        expect((await gitIn(repo, ['status', '--porcelain'])).trim()).toBe('M README.md');
        expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('my own edit\n');
        expect(await readFile(join(repo, 'shared.txt'), 'utf8')).toBe('from main\n');
    });

    test('a conflict in a rebase leaves the worktree as it was', async () => {
        const path = await lexer('shared.txt', 'from lexer\n');
        const tip = (await gitIn(path, ['rev-parse', 'HEAD'])).trim();
        await writeFile(join(repo, 'shared.txt'), 'from main\n');
        await gitIn(repo, ['commit', '--quiet', '--all', '--message', 'main edit']);

        await expect(run(path, { strategy: 'rebase' })).rejects.toMatchObject({ code: 'merge-conflict' });

        expect((await gitIn(path, ['rev-parse', 'HEAD'])).trim()).toBe(tip);
        expect((await gitIn(path, ['status', '--porcelain'])).trim()).toBe('');
        expect((await worktrees.list(repo, { inspect: true }))[0]?.work?.operation).toBeUndefined();
    });

    test('a target branch checked out nowhere is refused with the branch the project folder is on', async () => {
        const path = await lexer();
        await gitIn(repo, ['checkout', '--quiet', '-b', 'feature-x']);

        await expect(run(path)).rejects.toMatchObject({ code: 'target-not-checked-out', message: expect.stringContaining('on feature-x') });

        const into = await run(path, { into: 'feature-x' });
        expect(into).toMatchObject({ into: 'feature-x', cwd: repo });
    });

    test('a changed file in the target that the merge touches is refused in git’s words and nothing moves', async () => {
        const path = await lexer('shared.txt', 'from lexer\n');
        await writeFile(join(repo, 'shared.txt'), 'uncommitted by the person\n');
        const head = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();

        await expect(run(path)).rejects.toMatchObject({ code: 'git-failed', message: expect.stringContaining('would be overwritten') });

        expect((await gitIn(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
        expect(await readFile(join(repo, 'shared.txt'), 'utf8')).toBe('uncommitted by the person\n');
    });

    test('an agent merges into a target whose only change is the project file, and stops at anything else', async () => {
        await writeFile(join(repo, 'note.txt'), 'one\n');
        await mkdir(join(repo, '.ruimte'), { recursive: true });
        await writeFile(documentPathInFolder(repo), '{ "version": 2, "rev": 1 }\n');
        await gitIn(repo, ['add', '.']);
        await gitIn(repo, ['commit', '--quiet', '--message', 'canvas']);

        // What a person moving a node leaves behind all day, and what a merge is never about.
        await writeFile(documentPathInFolder(repo), '{ "version": 2, "rev": 2 }\n');
        await merges.merge(payload(await lexer(), {}), () => undefined, { cleanTarget: true });
        expect(await readFile(join(repo, 'lexer.txt'), 'utf8')).toBe('lexer\n');

        await writeFile(join(repo, 'note.txt'), 'two\n');
        await expect(merges.merge(payload(await lexer('other.txt'), {}), () => undefined, { cleanTarget: true })).rejects.toMatchObject({
            code: 'target-dirty'
        });
    });

    test('two merges of one worktree run one after the other, and the second finds it gone', async () => {
        const path = await lexer();
        agents.rows = [{ nodeId: 'chat-lexer', working: false, live: true }];
        let release = (): void => undefined;
        let reached = (): void => undefined;
        const atStop = new Promise<void>((resolve) => (reached = resolve));
        agents.onStop = () => {
            reached();
            return new Promise<void>((resolve) => (release = resolve));
        };

        const first = run(path, { stopAgent: true, remove: true });
        await atStop;
        const second = run(path, { remove: true }).catch((error: unknown) => error);
        // A git call of the test's own gives the second merge every chance to get past a lock that did not hold.
        await gitIn(repo, ['status', '--porcelain']);
        expect(agents.asked).toBe(1);
        release();

        expect(await first).toMatchObject({ removed: true });
        expect(await second).toMatchObject({ code: 'worktree-not-found' });
    });

    test('an agent in a turn is refused without stopAgent, and with it is stopped before its work is committed', async () => {
        const path = await lexer();
        agents.rows = [{ nodeId: 'chat-lexer', working: true, live: true }];
        await expect(run(path, { commitFirst: true })).rejects.toMatchObject({ code: 'agent-working' });
        expect(agents.stopped).toEqual([]);

        // What the agent wrote while it was being stopped still lands in the commit.
        agents.onStop = async () => {
            await writeFile(join(path, 'last-words.txt'), 'written while stopping\n');
        };
        await run(path, { commitFirst: true, stopAgent: true });

        expect(agents.stopped).toEqual(['chat-lexer']);
        expect(await readFile(join(repo, 'last-words.txt'), 'utf8')).toBe('written while stopping\n');
    });

    test('a target that switched branches while the agent was stopped is refused and neither branch moves', async () => {
        const path = await lexer();
        agents.rows = [{ nodeId: 'chat-lexer', working: true, live: true }];
        agents.onStop = async () => {
            await gitIn(repo, ['switch', '--quiet', '--create', 'elsewhere']);
        };
        const main = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        await expect(run(path, { stopAgent: true })).rejects.toMatchObject({ code: 'target-not-checked-out' });

        expect((await gitIn(repo, ['rev-parse', 'main'])).trim()).toBe(main);
        expect((await gitIn(repo, ['rev-parse', 'elsewhere'])).trim()).toBe(main);
    });

    test('a second squash of the same branch leaves no prepared message behind, and the next merge is not refused', async () => {
        const path = await lexer();
        await run(path, { strategy: 'squash', subject: 'Lexer' });
        const squashed = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        const again = await run(path, { strategy: 'squash', subject: 'Lexer' });

        expect(again.summary).toBe('main already has everything in lexer.');
        expect(await exists(join(repo, '.git', 'SQUASH_MSG'))).toBe(false);
        expect((await gitIn(repo, ['rev-parse', 'main'])).trim()).toBe(squashed);
        await expect(run(path, { strategy: 'squash', subject: 'Lexer' })).resolves.toMatchObject({ into: 'main' });
    });

    test('a prepared message with nothing staged or unmerged is not a squash that waits', async () => {
        const path = await lexer();
        await writeFile(join(repo, '.git', 'SQUASH_MSG'), 'left behind\n');
        await expect(run(path)).resolves.toMatchObject({ summary: 'Merged lexer into main.' });
    });

    test('a squash that waits with staged work is still refused', async () => {
        const path = await lexer();
        await writeFile(join(repo, '.git', 'SQUASH_MSG'), 'halfway\n');
        await writeFile(join(repo, 'README.md'), 'staged\n');
        await gitIn(repo, ['add', 'README.md']);
        await expect(run(path)).rejects.toMatchObject({ code: 'target-busy' });
    });
});
