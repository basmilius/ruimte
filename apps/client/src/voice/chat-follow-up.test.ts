import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { applyEvent, type ChatState } from '@ruimte/agents-react/state/chats';
import { chatCompletion, completionPrompt } from '@/voice/chat-follow-up';

const state = (items: ChatItem[]): ChatState => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info: {} as ChatInfo, items: byId, structure: byId, order: items.map((item) => item.id) };
};

describe('voice AI Chat follow-up', () => {
    test('waits for the exact tracked turn to settle', () => {
        const chat = state([
            { id: 'old', kind: 'turn', createdAt: 1, turnId: 'old', state: 'done', endedAt: 2, costUsd: 0 },
            { id: 'old-answer', kind: 'assistant', createdAt: 2, turnId: 'old', text: 'Old result', streaming: false },
            { id: 'tracked', kind: 'turn', createdAt: 3, turnId: 'tracked', state: 'running', endedAt: null, costUsd: 0 }
        ]);
        expect(chatCompletion(chat, 'tracked')).toBeNull();
    });

    test('returns only top-level final answers from the tracked turn', () => {
        const chat = state([
            { id: 'tracked', kind: 'turn', createdAt: 1, turnId: 'tracked', state: 'done', endedAt: 4, costUsd: 0 },
            { id: 'child', kind: 'assistant', createdAt: 2, turnId: 'tracked', text: 'Subagent detail', streaming: false, parentToolUseId: 'tool-1' },
            { id: 'answer', kind: 'assistant', createdAt: 3, turnId: 'tracked', text: 'The requested report is ready.', streaming: false }
        ]);
        expect(chatCompletion(chat, 'tracked')).toEqual({ state: 'done', answer: 'The requested report is ready.' });
    });

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
    });

    test('a turn whose item is not on the page and that left nothing yet is not settled', () => {
        const chat: ChatState = { ...state([]), info: { activeTurnId: null, status: 'idle' } as ChatInfo };
        expect(chatCompletion(chat, 'queued')).toBeNull();
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

    test('turns a completion into a bounded instruction for Voice', () => {
        const prompt = completionPrompt(
            { key: 'local:chat', project: 'Original project', chat: 'Research', turnId: 'turn-1' },
            { state: 'done', answer: 'I found the answer.' }
        );
        expect(prompt).toContain('AI Chat “Research”');
        expect(prompt).toContain('Project: Original project');
        expect(prompt).toContain('I found the answer.');
        expect(prompt).toContain('ended with state done');
        expect(prompt).toContain('End of quoted AI Chat result.');
    });
});
