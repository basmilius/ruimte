import { describe, expect, test } from 'bun:test';
import { MAX_MESSAGE_HOPS } from '@adecore/agents/coordination';
import type { OutboxWork } from '../outbox/outbox.ts';
import { wakeForWaitingMessages } from './agent-messages.ts';

async function woken(hop: number | undefined, state: 'done' | 'aborted' | 'error', projectId: string | null = 'project'): Promise<OutboxWork[]> {
    const works: OutboxWork[] = [];
    const notices = { waiting: () => [{ projectId: 'project', targetId: 'chat', from: 'other', fromTitle: '', text: 'hi', createdAt: 0, hop }] };

    await wakeForWaitingMessages(notices, 'chat', state, projectId, async (_projectId, work) => {
        works.push(work);
    });

    return works;
}

describe('wakeForWaitingMessages', () => {
    test('a turn that finished is followed by one for what landed during it', async () => {
        expect(await woken(1, 'done')).toEqual([{ kind: 'deliver-message', payload: { from: 'chat' } }]);
    });

    test('a Stop, an error, the hop limit or a message of an older host starts nothing', async () => {
        expect(await woken(1, 'aborted')).toEqual([]);
        expect(await woken(1, 'error')).toEqual([]);
        expect(await woken(MAX_MESSAGE_HOPS + 1, 'done')).toEqual([]);
        expect(await woken(undefined, 'done')).toEqual([]);
        expect(await woken(1, 'done', null)).toEqual([]);
    });
});
