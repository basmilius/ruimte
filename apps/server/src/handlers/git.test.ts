import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { initRepo } from '../git/test-repo.ts';
import { registerGitHandlers } from './git.ts';

let root: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-git-handlers-')));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test('a client that closed while its git.watch was set up leaves no watcher behind', async () => {
    const repo = join(root, 'repo');
    await initRepo(repo, { 'a.txt': 'a\n' });
    const fake = new FakeWatch();
    const statuses = new GitStatusWatcher('darwin', fake);
    const dispatcher = new Dispatcher();
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never);
    const client = { id: 'phone', closed: false, send: (_frame: ServerFrame) => undefined };

    const handled = dispatcher.handle(client, JSON.stringify({ id: 'watch', type: 'git.watch', payload: { cwd: repo } }));
    // The socket goes before git answered, and its cleanup ran with nothing to clean yet.
    client.closed = true;
    statuses.detachAll('phone');
    await handled;

    expect(fake.openOn(repo)).toHaveLength(0);
});

test('a git.watch that asks for the status answers it once the watch is up', async () => {
    const repo = join(root, 'repo');
    await initRepo(repo, { 'a.txt': 'a\n' });
    const fake = new FakeWatch();
    const statuses = new GitStatusWatcher('darwin', fake);
    const dispatcher = new Dispatcher();
    registerGitHandlers(dispatcher, {} as never, {} as never, statuses, {} as never);
    const replies: ServerFrame[] = [];
    const client = { id: 'phone', closed: false, send: (frame: ServerFrame) => replies.push(frame) };

    await dispatcher.handle(client, JSON.stringify({ id: 'plain', type: 'git.watch', payload: { cwd: repo } }));
    await dispatcher.handle(client, JSON.stringify({ id: 'asked', type: 'git.watch', payload: { cwd: join(repo, '.'), status: true } }));

    const answers = replies.filter((frame) => 'ok' in frame);
    expect(answers[0]).toMatchObject({ ok: true, result: {} });
    expect(answers[1]).toMatchObject({ ok: true, result: { status: { root: repo } } });
    statuses.detachAll('phone');
});

test('git.pr-watch refuses a chat the project does not place', async () => {
    const started: string[] = [];
    const watches = { start: (projectId: string, chatId: string) => (started.push(`${projectId}/${chatId}`), Promise.resolve({ chatId })) };
    const dispatcher = new Dispatcher();
    const placeOf = (id: string) => (id === 'chat-in' ? { projectId: 'p' } : null);
    registerGitHandlers(dispatcher, {} as never, {} as never, {} as never, {} as never, watches as never, placeOf);
    const replies: ServerFrame[] = [];
    const client = { id: 'phone', closed: false, send: (frame: ServerFrame) => replies.push(frame) };
    const ask = (id: string, chatId: string, projectId: string) =>
        dispatcher.handle(client, JSON.stringify({ id, type: 'git.pr-watch', payload: { projectId, chatId, cwd: '/repo' } }));

    await ask('a', 'chat-in', 'p');
    await ask('b', 'chat-in', 'other');
    await ask('c', 'chat-out', 'p');

    expect(started).toEqual(['p/chat-in']);
    expect(replies.map((frame) => ('ok' in frame ? frame.ok : null))).toEqual([true, false, false]);
    expect(replies[1]).toMatchObject({ error: { code: 'pr-watch-refused' } });
});

test("git.identity answers for a repository and never for the machine's own state", async () => {
    const repo = join(root, 'repo');
    await initRepo(repo, { 'a.txt': 'a\n' });
    const home = join(root, 'home');
    const dispatcher = new Dispatcher();
    registerGitHandlers(dispatcher, {} as never, {} as never, {} as never, {} as never, undefined, undefined, new MachineHome(home));
    const ask = async (paths: string[]): Promise<ServerFrame> => {
        const frames: ServerFrame[] = [];
        await dispatcher.handle(
            { id: 'phone', send: (frame) => frames.push(frame) },
            JSON.stringify({ id: 'identity', type: 'git.identity', payload: { paths } })
        );
        return frames[0]!;
    };

    expect(await ask([repo])).toMatchObject({ ok: true, result: { identities: [{ path: repo, branch: 'main' }] } });
    expect(await ask([repo, join(home, 'auth')])).toMatchObject({ ok: false, error: { code: 'machine-state' } });
});
