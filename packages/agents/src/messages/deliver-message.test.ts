import { describe, expect, test } from 'bun:test';
import type { WakeChat } from '../chat/wake-chat.ts';
import { deliverMessageHandler, type DeliverMessageEntry } from './deliver-message.ts';
import type { Notice } from './notice-store.ts';

const entry: DeliverMessageEntry = {
    kind: 'deliver-message',
    payload: { from: 'chat-1' },
    id: 'deliver-message-1',
    projectId: 'project',
    target: 'chat-2',
    createdAt: 1,
    attempts: 0,
    notBefore: 1
};

function notice(from: string, fromTitle: string): Notice {
    return { projectId: 'project', targetId: 'chat-2', from, fromTitle, text: 'hello', createdAt: 1 };
}

const words = {
    prompt: (count: number): string => `${count} messages above`,
    label: (notices: readonly Notice[]): string => `From ${notices.map((one) => one.fromTitle).join(', ')}`
};

/* A queue and a chat that writes down every turn it is woken for. */
function fixture(waiting: Notice[], options: { placed?: boolean; chat?: boolean } = {}) {
    const woken: Parameters<WakeChat['wake']>[0][] = [];
    const chat: WakeChat = {
        items: () => [],
        wake: (wake) => {
            woken.push(wake);
            return true;
        }
    };
    const handler = deliverMessageHandler({
        notices: { waiting: () => waiting },
        chat: async () => (options.chat === false ? null : chat),
        placed: () => options.placed ?? true,
        words
    });
    return { woken, handler };
}

describe('deliverMessageHandler', () => {
    test('opens one turn for everything waiting, with the senders on it and the words of the host', async () => {
        const { woken, handler } = fixture([notice('chat-1', 'Lead'), notice('chat-3', 'Builder'), notice('chat-1', 'Lead')]);
        expect(await handler(entry)).toBeUndefined();
        expect(woken).toEqual([{ text: '3 messages above', label: 'From Lead, Builder, Lead', taskIds: [], messageFrom: ['chat-1', 'chat-3'] }]);
    });

    test('wakes nobody when the messages were taken already, the node went or it has no thread', async () => {
        for (const { woken, handler } of [
            fixture([]),
            fixture([notice('chat-1', 'Lead')], { placed: false }),
            fixture([notice('chat-1', 'Lead')], { chat: false })
        ]) {
            expect(await handler(entry)).toBeUndefined();
            expect(woken).toEqual([]);
        }
    });
});
