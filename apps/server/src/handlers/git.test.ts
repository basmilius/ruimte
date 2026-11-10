import { expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { GitError } from '../git/run.ts';
import { gitArea } from './git.ts';
import { gitDepsWith } from './test-helpers.ts';

test('git.pr-watch refuses a chat the project does not place', async () => {
    const started: string[] = [];
    const watches = { start: (projectId: string, chatId: string) => (started.push(`${projectId}/${chatId}`), Promise.resolve({ chatId })) };
    const dispatcher = new Dispatcher();
    const placeOf = (id: string) => (id === 'chat-in' ? { projectId: 'p' } : null);
    gitArea(gitDepsWith({ prWatches: watches as never, placeOf })).handlers?.(dispatcher);
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

test('git.suggestMessage asks the machine text model with the request hint, so a refusal reaches the client before any CLI runs', async () => {
    const asked: (string | undefined)[] = [];
    const textModels = {
        choice: () => ({ provider: 'codex', model: null }),
        prepare: async (hint?: string) => {
            asked.push(hint);

            throw new GitError('git-failed', 'This machine writes short texts with Codex, which is not Claude.');
        }
    };
    const dispatcher = new Dispatcher();
    gitArea(gitDepsWith({ textModels })).handlers?.(dispatcher);
    const replies: ServerFrame[] = [];
    const client = { id: 'phone', closed: false, send: (frame: ServerFrame) => replies.push(frame) };

    await dispatcher.handle(client, JSON.stringify({ id: 'a', type: 'git.suggestMessage', payload: { cwd: '/repo', actionId: 'run-1', provider: 'claude' } }));

    expect(asked).toEqual(['claude']);
    expect(replies[0]).toMatchObject({ ok: false, error: { code: 'git-failed', message: expect.stringContaining('Codex') } });
});
