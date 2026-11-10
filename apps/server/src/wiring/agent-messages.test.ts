import { describe, expect, spyOn, test } from 'bun:test';
import type { OutboxWork } from '../outbox/outbox.ts';
import { wakeForWaitingMessages } from './agent-messages.ts';

async function woken(count: number, state: 'done' | 'aborted' | 'error', projectId: string | null = 'project'): Promise<OutboxWork[]> {
    const works: OutboxWork[] = [];
    const notices = {
        waiting: () => Array.from({ length: count }, () => ({ projectId: 'project', targetId: 'chat', from: 'other', fromTitle: '', text: 'hi', createdAt: 0 }))
    };

    await wakeForWaitingMessages(notices, 'chat', state, projectId, async (_projectId, work) => {
        works.push(work);
    });

    return works;
}

describe('wakeForWaitingMessages', () => {
    test('a turn that finished is followed by one for what landed during it', async () => {
        expect(await woken(1, 'done')).toEqual([{ kind: 'deliver-message', payload: { from: 'chat' } }]);
    });

    test('a Stop, an error, nothing waiting or a chat outside a project starts nothing', async () => {
        expect(await woken(1, 'aborted')).toEqual([]);
        expect(await woken(1, 'error')).toEqual([]);
        expect(await woken(0, 'done')).toEqual([]);
        expect(await woken(1, 'done', null)).toEqual([]);
    });

    test('an outbox that cannot write, such as on a full disk, is logged and never rejects', async () => {
        const logged = spyOn(console, 'error').mockImplementation(() => undefined);
        const notices = { waiting: () => [{ projectId: 'project', targetId: 'chat', from: 'other', fromTitle: '', text: 'hi', createdAt: 0, hop: 1 }] };

        try {
            await wakeForWaitingMessages(notices, 'chat', 'done', 'project', async () => {
                throw new Error('ENOSPC: no space left on device');
            });

            expect(logged).toHaveBeenCalledWith(expect.stringContaining('chat'), expect.stringContaining('ENOSPC'));
        } finally {
            logged.mockRestore();
        }
    });
});
