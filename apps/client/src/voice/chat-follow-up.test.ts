import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@/state/chats';
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

    test('turns a completion into a bounded instruction for Voice', () => {
        const prompt = completionPrompt({ key: 'local:chat', chat: 'Research', turnId: 'turn-1' }, { state: 'done', answer: 'I found the answer.' });
        expect(prompt).toContain('AI Chat “Research”');
        expect(prompt).toContain('I found the answer.');
        expect(prompt).toContain('Tell the user now');
    });
});
