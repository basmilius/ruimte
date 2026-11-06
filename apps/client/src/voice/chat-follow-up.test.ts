import { describe, expect, test } from 'bun:test';
import { applyEvent, type ChatState } from '@adecore/agents-react/state';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { FollowedTurn } from '@ruimte/voice';
import { chatCompletion, followedState } from '@/voice/chat-follow-up';

function state(items: ChatItem[]): ChatState {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info: {} as ChatInfo, items: byId, structure: byId, order: items.map((item) => item.id) };
}

describe('voice AI Chat follow-up in this window', () => {
    test('settles a long turn whose own item sits before the page this client holds', () => {
        const info = { activeTurnId: 'tracked', status: 'running' } as ChatInfo;
        // The newest page of a thread whose turn item is too far back to be on it.
        const page: ChatItem[] = [
            ...Array.from({ length: 59 }, (_, i): ChatItem => ({
                id: `read-${i}`,
                kind: 'tool',
                createdAt: i,
                turnId: 'tracked',
                toolUseId: `read-${i}`,
                name: 'Read',
                input: {},
                output: 'ok',
                state: 'done',
                parentToolUseId: null
            })),
            { id: 'answer', kind: 'assistant', createdAt: 60, turnId: 'tracked', text: 'All done.', streaming: false }
        ];
        let chat: ChatState = { ...state(page), info, history: { start: 1, cursor: 'g:1' } };
        expect(chatCompletion(chat, 'tracked')).toBeNull();

        // The turn settles at its own place in the thread, before the page, and the chat goes idle.
        const settled: ChatItem = { id: 'tracked', kind: 'turn', createdAt: 0, turnId: 'tracked', state: 'done', endedAt: 61, costUsd: 0 };
        chat = applyEvent(chat, { type: 'item', item: settled, historyIndex: 0 });
        chat = applyEvent(chat, { type: 'info', info: { ...info, activeTurnId: null, status: 'idle' } });
        expect(chatCompletion(chat, 'tracked')).toEqual({ state: 'done', answer: 'All done.' });
        const offPageItems = { ...chat.items, tracked: { ...settled, state: 'aborted' as const } };
        chat = { ...chat, items: offPageItems, structure: offPageItems };
        expect(chat.order).not.toContain('tracked');
        expect(chatCompletion(chat, 'tracked')).toEqual({ state: 'aborted', answer: 'All done.' });
    });

    test('a turn whose item is not on the page and that left nothing yet is not settled', () => {
        const chat: ChatState = { ...state([]), info: { activeTurnId: null, status: 'idle' } as ChatInfo };
        expect(chatCompletion(chat, 'queued')).toBeNull();
        expect(chatCompletion(undefined, 'queued')).toBeNull();
    });

    test('a long turn that ended on an error says so', () => {
        const chat: ChatState = {
            ...state([
                {
                    id: 'read',
                    kind: 'tool',
                    createdAt: 1,
                    turnId: 'tracked',
                    toolUseId: 'read',
                    name: 'Read',
                    input: {},
                    output: 'ok',
                    state: 'done',
                    parentToolUseId: null
                },
                { id: 'failed', kind: 'note', createdAt: 2, turnId: 'tracked', level: 'error', text: 'Claude Code exited with code 1' }
            ]),
            info: { activeTurnId: null, status: 'error' } as ChatInfo
        };
        expect(chatCompletion(chat, 'tracked')).toEqual({ state: 'error', answer: '' });
    });

    test('a chat names only the requests that still wait, in the order this window holds them', () => {
        const chat = state([
            { id: 'ask', kind: 'question', createdAt: 1, turnId: 't', state: 'pending', questions: [{ question: 'Which file?' }] } as never,
            { id: 'second', kind: 'question', createdAt: 2, turnId: 't', state: 'pending', questions: [{ question: 'Which branch?' }] } as never,
            { id: 'orphan', kind: 'question', createdAt: 3, turnId: 't', state: 'pending', questions: [{ question: 'Do not show this' }] } as never,
            { id: 'done', kind: 'note', createdAt: 2, turnId: 't', level: 'info', text: 'Noted' }
        ]);
        chat.order = ['second', 'missing', 'ask', 'done'];
        chat.info = { activeTurnId: 't', status: 'needs-you' } as ChatInfo;
        expect(new FollowedTurn('t').observe(followedState(chat, 't'))).toEqual({
            kind: 'waits',
            count: 1,
            waits: ['question: Which branch?', 'question: Which file?']
        });
    });
});
