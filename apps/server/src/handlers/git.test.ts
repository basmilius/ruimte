import { expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { GitError } from '../git/run.ts';
import { gitArea } from './git.ts';
import { gitDepsWith } from './test-helpers.ts';

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
