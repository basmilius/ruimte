import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { GitBundleResult, GitDiffResult, GitStatus, ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { BundleStore } from '../git/bundles.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { readStatusAt } from '../git/status.ts';
import { gitIn, initRepo } from '../git/test-repo.ts';
import { registerGitHandlers } from './git.ts';
import { askOnce } from './test-helpers.ts';

const refused = { ok: false, error: { code: 'machine-state' } };

let root: string;
let repo: string;
let home: string;
let dispatcher: Dispatcher;

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-home-')));
    // The checkout holds the home, the way a person whose home folder is a repository has it.
    repo = join(root, 'repo');
    home = join(repo, 'ruimte-home');
    await initRepo(repo, { 'readme.md': 'read me\n' });
    await mkdir(join(home, 'worktrees'), { recursive: true });
    await writeFile(join(home, 'local.key'), 'the local secret');
    await writeFile(join(repo, 'readme.md'), 'read me again\n');
    await initRepo(join(home, 'worktrees', 'feature'), { 'a.txt': 'a\n' });
    dispatcher = new Dispatcher();
    const statuses = new GitStatusWatcher('darwin', new FakeWatch());
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never, undefined, undefined, new MachineHome(home));
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

const ask = (type: string, payload: unknown) => askOnce(dispatcher, { id: 'phone' }, type, payload);

test('git requests on a file under the home answer machine-state and leave it where it is', async () => {
    const secret = join('ruimte-home', 'local.key');

    expect(await ask('git.diff', { cwd: repo, path: secret, scope: 'worktree' })).toMatchObject(refused);
    expect(await ask('git.blame', { cwd: repo, path: secret })).toMatchObject(refused);
    expect(await ask('git.stage', { cwd: repo, paths: [secret], staged: true })).toMatchObject(refused);
    expect(await ask('git.discard', { cwd: repo, paths: [secret] })).toMatchObject(refused);
    expect(await ask('git.conflict', { cwd: repo, path: secret })).toMatchObject(refused);
    expect(await ask('git.discard', { cwd: repo, paths: ['.'] })).toMatchObject(refused);
    expect(await readFile(join(home, 'local.key'), 'utf8')).toBe('the local secret');
});

test('git requests whose folder is the home answer machine-state', async () => {
    expect(await ask('git.status', { cwd: home })).toMatchObject(refused);
    expect(await ask('git.log', { cwd: home })).toMatchObject(refused);
    expect(await ask('git.watch', { cwd: home })).toMatchObject(refused);
    expect(await ask('git.repos', { folder: home })).toMatchObject(refused);
    expect(await ask('git.worktree-list', { repo: home })).toMatchObject(refused);
});

interface Checkout {
    repo: string;
    home: string;
    ask(type: string, payload: unknown): Promise<{ ok: boolean; result?: unknown; error?: { code: string } }>;
}

// Each request over the whole working tree gets a checkout of its own, since several of them change it.
async function checkoutAroundHome(name: string): Promise<Checkout> {
    const repo = join(root, name);
    const home = join(repo, 'ruimte-home');
    await initRepo(repo, { 'readme.md': 'read me\n' });
    await mkdir(join(home, 'chats', 'chat-1.visuals'), { recursive: true });
    await mkdir(join(home, 'scratch'), { recursive: true });
    await writeFile(join(home, 'local.key'), 'the local secret');
    await writeFile(join(home, 'chats', 'chat-1.jsonl'), 'the thread of a chat');
    await writeFile(join(home, 'chats', 'chat-1.visuals', 'chart.html'), 'a chart');
    await writeFile(join(home, 'scratch', 'note.md'), 'a note');
    await writeFile(join(repo, 'readme.md'), 'read me again\n');
    await writeFile(join(repo, 'new.txt'), 'new\n');
    const machineHome = new MachineHome(home);
    const dispatcher = new Dispatcher();
    const statuses = new GitStatusWatcher('darwin', new FakeWatch(), Date.now, (top) => readStatusAt(top, (folder) => machineHome.stateWithin(folder)));
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never, undefined, undefined, machineHome, {
        bundles: new BundleStore(home),
        checkpoints: new Checkpoints(home),
        folderOf: async () => repo
    });

    return {
        repo,
        home,
        ask: async (type, payload) => {
            const frames: ServerFrame[] = [];
            await dispatcher.handle({ id: 'phone', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
            return frames.find((frame) => 'id' in frame && frame.id === 'request') as never;
        }
    };
}

const MACHINE_STATE = ['ruimte-home/local.key', 'ruimte-home/chats/chat-1.jsonl'];
const OPEN_WORK = ['ruimte-home/chats/chat-1.visuals/chart.html', 'ruimte-home/scratch/note.md'];

async function expectHomeInPlace(checkout: Checkout): Promise<void> {
    expect(await readFile(join(checkout.home, 'local.key'), 'utf8')).toBe('the local secret');
    expect(await readFile(join(checkout.home, 'chats', 'chat-1.jsonl'), 'utf8')).toBe('the thread of a chat');
}

async function treeOf(checkout: Checkout, rev: string): Promise<string[]> {
    return (await gitIn(checkout.repo, ['ls-tree', '-r', '--name-only', rev])).trim().split('\n');
}

test('git.diff of the whole checkout leaves the machine state out and keeps the open folders', async () => {
    const checkout = await checkoutAroundHome('diff-base');

    const reply = await checkout.ask('git.diff', { cwd: checkout.repo, scope: 'base' });
    const files = (reply.result as GitDiffResult).files ?? [];
    const paths = files.map((file) => file.path);

    expect(reply.ok).toBe(true);
    expect(paths).toEqual(expect.arrayContaining(['readme.md', 'new.txt', ...OPEN_WORK]));
    expect(paths).not.toEqual(expect.arrayContaining([MACHINE_STATE[0]]));
    expect(paths).not.toEqual(expect.arrayContaining([MACHINE_STATE[1]]));
    expect(JSON.stringify(reply)).not.toContain('the local secret');
});

test('git.diff of a commit that holds the home leaves it out', async () => {
    const checkout = await checkoutAroundHome('diff-commit');
    await gitIn(checkout.repo, ['add', '--all']);
    await gitIn(checkout.repo, ['commit', '--quiet', '--message', 'everything']);

    const reply = await checkout.ask('git.diff', { cwd: checkout.repo, scope: 'commit' });
    const paths = ((reply.result as GitDiffResult).files ?? []).map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining(['readme.md', ...OPEN_WORK]));
    expect(JSON.stringify(reply)).not.toContain('the local secret');
});

test('git.status of the checkout lists no machine state', async () => {
    const checkout = await checkoutAroundHome('status');

    const reply = await checkout.ask('git.status', { cwd: checkout.repo });
    const paths = (reply.result as GitStatus).files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining(['readme.md', 'new.txt', ...OPEN_WORK]));
    expect(paths.filter((path) => MACHINE_STATE.includes(path))).toEqual([]);
});

test('git.action stash leaves the machine state where it is', async () => {
    const checkout = await checkoutAroundHome('stash');

    expect(await checkout.ask('git.action', { cwd: checkout.repo, actionId: 'stash', kind: 'stash' })).toMatchObject({ ok: true });
    await expectHomeInPlace(checkout);
    expect(await readFile(join(checkout.repo, 'readme.md'), 'utf8')).toBe('read me\n');
    expect(await treeOf(checkout, 'stash@{0}^3')).toEqual(['new.txt', ...OPEN_WORK.toSorted()]);
});

test('git.action checkout with a stash leaves the machine state where it is', async () => {
    const checkout = await checkoutAroundHome('checkout');
    await gitIn(checkout.repo, ['branch', 'other']);

    const reply = await checkout.ask('git.action', { cwd: checkout.repo, actionId: 'switch', kind: 'checkout', ref: 'other', stash: true });

    expect(reply).toMatchObject({ ok: true });
    await expectHomeInPlace(checkout);
    expect(await treeOf(checkout, 'stash@{0}^3')).not.toEqual(expect.arrayContaining([MACHINE_STATE[0]]));
});

test('git.action commit and commit-push with stageAll commit no machine state', async () => {
    const checkout = await checkoutAroundHome('commit');
    const remote = join(root, 'commit-remote.git');
    await gitIn(root, ['init', '--quiet', '--bare', remote]);
    await gitIn(checkout.repo, ['remote', 'add', 'origin', remote]);
    await gitIn(checkout.repo, ['push', '--quiet', '--set-upstream', 'origin', 'main']);

    const committed = await checkout.ask('git.action', { cwd: checkout.repo, actionId: 'commit', kind: 'commit', subject: 'All', stageAll: true });

    expect(committed).toMatchObject({ ok: true });
    expect(await treeOf(checkout, 'HEAD')).toEqual(['new.txt', 'readme.md', ...OPEN_WORK.toSorted()]);

    await writeFile(join(checkout.home, 'local.key'), 'the local secret, changed');
    await writeFile(join(checkout.repo, 'readme.md'), 'read me once more\n');
    const pushed = await checkout.ask('git.action', { cwd: checkout.repo, actionId: 'push', kind: 'commit-push', subject: 'More', stageAll: true });

    expect(pushed).toMatchObject({ ok: true });
    expect((await gitIn(remote, ['ls-tree', '-r', '--name-only', 'main'])).trim().split('\n')).toEqual(['new.txt', 'readme.md', ...OPEN_WORK.toSorted()]);
});

test('git.bundle of the files of the checkout bundles no machine state', async () => {
    const checkout = await checkoutAroundHome('bundle');

    const reply = await checkout.ask('git.bundle', { path: checkout.repo, from: 'files', haves: [], name: 'Handoff' });

    expect(reply).toMatchObject({ ok: true });
    expect(await treeOf(checkout, (reply.result as GitBundleResult).commit)).toEqual(['new.txt', 'readme.md', ...OPEN_WORK.toSorted()]);
});

test('the checkout around the home and the worktrees inside it still answer', async () => {
    expect(await ask('git.diff', { cwd: repo, path: 'readme.md', scope: 'worktree' })).toMatchObject({ ok: true });
    expect(await ask('git.status', { cwd: repo })).toMatchObject({ ok: true });
    expect(await ask('git.status', { cwd: join(home, 'worktrees', 'feature') })).toMatchObject({ ok: true });
    expect(await ask('git.stage', { cwd: repo, paths: ['readme.md'], staged: true })).toMatchObject({ ok: true });
});
