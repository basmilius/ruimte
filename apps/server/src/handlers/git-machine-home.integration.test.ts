import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { initRepo } from '../git/test-repo.ts';
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

test("git requests on a file under the home answer machine-state and leave it where it is", async () => {
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

test('the checkout around the home and the worktrees inside it still answer', async () => {
    expect(await ask('git.diff', { cwd: repo, path: 'readme.md', scope: 'worktree' })).toMatchObject({ ok: true });
    expect(await ask('git.status', { cwd: repo })).toMatchObject({ ok: true });
    expect(await ask('git.status', { cwd: join(home, 'worktrees', 'feature') })).toMatchObject({ ok: true });
    expect(await ask('git.stage', { cwd: repo, paths: ['readme.md'], staged: true })).toMatchObject({ ok: true });
});
