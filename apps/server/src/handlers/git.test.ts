import { expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { registerGitHandlers } from './git.ts';

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
