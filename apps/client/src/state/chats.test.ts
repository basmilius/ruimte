import { afterEach, describe, expect, test } from 'bun:test';
import { useChats, type ChatState } from '@adecore/agents-react/state';
import type { AgentStatus } from '@ruimte/contracts';
import { subscribeChatStatuses, subscribeChatThreads } from '@/state/chats';
import { chatInfoOf } from '../../testing/chat-info';

function info(status: AgentStatus): ChatState['info'] {
    return chatInfoOf('c1', { status, running: true });
}

function streaming(): void {
    useChats.getState().reset('local:c1', info('running'), [{ id: 'r', kind: 'assistant', createdAt: 0, turnId: null, text: 'Hello', streaming: true }]);
}

function counter(subscribe: (listener: () => void) => () => void): { calls: () => number; stop: () => void } {
    let calls = 0;
    const stop = subscribe(() => {
        calls += 1;
    });
    return { calls: () => calls, stop };
}

afterEach(() => {
    useChats.setState({ byKey: {}, statusByKey: {} });
});

describe('what a chat listener hears', () => {
    test('a streamed word reaches neither kind of listener', () => {
        streaming();
        const statuses = counter(subscribeChatStatuses);
        const threads = counter(subscribeChatThreads);
        useChats.getState().apply('local:c1', { type: 'delta', itemId: 'r', text: ' there' });
        statuses.stop();
        threads.stop();
        expect(useChats.getState().byKey['local:c1']?.items.r).toMatchObject({ text: 'Hello there' });
        expect([statuses.calls(), threads.calls()]).toEqual([0, 0]);
    });

    test('a new status reaches both', () => {
        streaming();
        const statuses = counter(subscribeChatStatuses);
        const threads = counter(subscribeChatThreads);
        useChats.getState().apply('local:c1', { type: 'info', info: info('needs-you') });
        statuses.stop();
        threads.stop();
        expect([statuses.calls(), threads.calls()]).toEqual([1, 1]);
    });

    test('a new row in a thread reaches only what reads the threads', () => {
        streaming();
        const statuses = counter(subscribeChatStatuses);
        const threads = counter(subscribeChatThreads);
        useChats.getState().apply('local:c1', {
            type: 'item',
            item: { id: 'q', kind: 'assistant', createdAt: 1, turnId: null, text: 'Next', streaming: false }
        });
        statuses.stop();
        threads.stop();
        expect([statuses.calls(), threads.calls()]).toEqual([0, 1]);
    });

    test('a chat that goes reaches both', () => {
        streaming();
        const statuses = counter(subscribeChatStatuses);
        const threads = counter(subscribeChatThreads);
        useChats.getState().forget('local:c1');
        statuses.stop();
        threads.stop();
        expect([statuses.calls(), threads.calls()]).toEqual([1, 1]);
    });
});
