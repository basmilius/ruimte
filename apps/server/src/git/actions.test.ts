import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitActionPayload, GitActionPhase } from '@ruimte/contracts';
import { GitActions, checkoutArgs, isDirty } from './actions.ts';
import { readLog } from './log.ts';
import { listRefs } from './refs.ts';
import { forgetBase, readStatus } from './status.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

let template: RepoTemplate;
let root: string;
let repo: string;
let remote: string;
let actions: GitActions;

const run = (args: string[], cwd: string = repo): Promise<string> => gitIn(cwd, args);

const write = (name: string, body: string): Promise<void> => writeFile(join(repo, name), body);

interface Progress {
    phases: GitActionPhase[];
    lines: string[];
}

const act = async (payload: Omit<GitActionPayload, 'cwd' | 'actionId'> & { cwd?: string }, progress?: Progress) => {
    return await actions.run({ cwd: repo, actionId: `action-${Math.random()}`, ...payload }, (phase, line) => {
        progress?.phases.push(phase);
        if (line !== '') {
            progress?.lines.push(line);
        }
    });
};

beforeAll(async () => {
    template = await repoTemplate('ruimte-actions', async (dir) => {
        await gitIn(dir, ['init', '--quiet', '--bare', '--initial-branch=main', join(dir, 'remote.git')]);
        await initRepo(join(dir, 'repo'), { 'one.txt': 'one\n' });
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    remote = join(root, 'remote.git');
    repo = join(root, 'repo');
    // Added per copy rather than in the template, so every test pushes to a bare repository of its own.
    await run(['remote', 'add', 'origin', remote]);
    actions = new GitActions();
    forgetBase();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('branches', () => {
    test('a branch is created, renamed and deleted', async () => {
        await act({ kind: 'create-branch', name: 'feature' });
        expect((await listRefs(repo)).current).toBe('feature');

        await act({ kind: 'rename-branch', name: 'feature-2' });
        const refs = await listRefs(repo);
        expect(refs.current).toBe('feature-2');
        expect(refs.refs.map((ref) => ref.name)).toContain('main');

        await act({ kind: 'checkout', ref: 'main' });
        await act({ kind: 'delete-branch', ref: 'feature-2' });
        expect((await listRefs(repo)).refs.map((ref) => ref.name)).not.toContain('feature-2');
    });

    test('a branch with commits of its own only goes away with force', async () => {
        await act({ kind: 'create-branch', name: 'work' });
        await write('two.txt', 'two\n');
        await act({ kind: 'commit', subject: 'add two', stageAll: true });
        await act({ kind: 'checkout', ref: 'main' });

        await expect(act({ kind: 'delete-branch', ref: 'work' })).rejects.toThrow();
        await act({ kind: 'delete-branch', ref: 'work', force: true });
        expect((await listRefs(repo)).refs.map((ref) => ref.name)).not.toContain('work');
    });

    test('a dirty tree switches branch by parking its changes in a stash', async () => {
        await act({ kind: 'create-branch', name: 'other' });
        await act({ kind: 'checkout', ref: 'main' });
        await write('one.txt', 'changed\n');
        expect(await isDirty(repo)).toBe(true);

        await act({ kind: 'checkout', ref: 'other', stash: true });
        expect((await listRefs(repo)).current).toBe('other');
        expect(await isDirty(repo)).toBe(false);

        await act({ kind: 'stash-pop' });
        expect(await isDirty(repo)).toBe(true);
    });

    test('a remote branch is checked out as a local one that follows it', async () => {
        await run(['push', '--quiet', 'origin', 'main']);
        await run(['branch', 'published']);
        await run(['push', '--quiet', 'origin', 'published']);
        await run(['branch', '--delete', 'published']);
        await run(['fetch', '--quiet', 'origin']);

        expect(await checkoutArgs(repo, 'origin/published')).toEqual(['checkout', '--track', 'origin/published']);
        await act({ kind: 'checkout', ref: 'origin/published' });
        expect((await listRefs(repo)).current).toBe('published');
    });
});

describe('stashing', () => {
    test('a stash takes the changes and a pop brings them back', async () => {
        await write('one.txt', 'changed\n');
        await act({ kind: 'stash', subject: 'later' });
        expect((await readStatus(repo)).files).toHaveLength(0);

        await act({ kind: 'stash-pop' });
        expect((await readStatus(repo)).files).toHaveLength(1);
    });

    test('the stash list names what can be popped', async () => {
        await write('one.txt', 'changed\n');
        await act({ kind: 'stash', subject: 'later' });
        const { stashes } = await listRefs(repo);

        expect(stashes[0]?.ref).toBe('stash@{0}');
        expect(stashes[0]?.message).toContain('later');
    });
});

describe('committing', () => {
    test('a commit stages everything when asked and answers the hash it wrote', async () => {
        await write('two.txt', 'two\n');
        const result = await act({ kind: 'commit', subject: 'feat: two', body: 'because', stageAll: true });

        expect(result.commit?.hash).toMatch(/^[0-9a-f]{40}$/);
        expect(result.summary).toContain('feat: two');
        const log = await readLog(repo, 5);
        expect(log.commits[0]?.subject).toBe('feat: two');
        expect((await readStatus(repo)).files).toHaveLength(0);
    });

    test('a commit without anything staged fails with what git said', async () => {
        await expect(act({ kind: 'commit', subject: 'nothing' })).rejects.toThrow(/nothing to commit/i);
    });
});

describe('the remote', () => {
    test('a push without an upstream publishes the branch, and a pull takes the other side back', async () => {
        const progress: Progress = { phases: [], lines: [] };
        const published = await act({ kind: 'publish' }, progress);

        expect(published.summary).toContain('Published main');
        expect(progress.phases).toContain('push');
        expect(progress.phases).toContain('done');
        expect(await run(['rev-parse', 'HEAD'])).toBe(await run(['rev-parse', 'main'], remote));

        // A second checkout of the same remote is what a commit from elsewhere looks like.
        const other = join(root, 'other');
        await run(['clone', '--quiet', remote, other], root);
        await writeFile(join(other, 'three.txt'), 'three\n');
        await run(['add', '.'], other);
        await run(['commit', '--quiet', '--message', 'from elsewhere'], other);
        await run(['push', '--quiet'], other);

        await act({ kind: 'fetch' });
        expect((await readStatus(repo)).behind).toBe(1);
        await act({ kind: 'pull' });
        expect((await readStatus(repo)).behind).toBe(0);
        expect((await readLog(repo, 5)).commits[0]?.subject).toBe('from elsewhere');
    });

    test('a commit and push does both and streams a phase for each', async () => {
        await act({ kind: 'publish' });
        await write('four.txt', 'four\n');
        const progress: Progress = { phases: [], lines: [] };
        const result = await act({ kind: 'commit-push', subject: 'feat: four', stageAll: true }, progress);

        expect(progress.phases).toEqual(expect.arrayContaining(['stage', 'commit', 'push', 'done']));
        expect(result.summary).toContain('feat: four');
        expect(await run(['rev-parse', 'HEAD'])).toBe(await run(['rev-parse', 'main'], remote));
    });

    test('a failure carries what git wrote', async () => {
        const progress: Progress = { phases: [], lines: [] };
        await expect(act({ kind: 'merge', ref: 'nope' }, progress)).rejects.toThrow(/nope/);
        expect(progress.phases).toContain('failed');
    });
});
