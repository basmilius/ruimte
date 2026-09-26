import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/agent-contracts';
import { recentChatMessages } from './recent-messages';

const item = (id: string, kind: 'user' | 'assistant', text: string, parentToolUseId?: string): ChatItem =>
    kind === 'user'
        ? { id, kind, text, createdAt: Number(id), turnId: null }
        : { id, kind, text, streaming: false, parentToolUseId: parentToolUseId ?? null, createdAt: Number(id), turnId: null };

describe('recentChatMessages', () => {
    test('keeps only the latest person and top-level assistant messages in order', () => {
        const items: ChatItem[] = [
            item('1', 'user', 'old'),
            item('2', 'assistant', 'answer'),
            { id: '3', kind: 'thinking', text: 'private', streaming: false, endedAt: 3, createdAt: 3, turnId: null },
            item('4', 'assistant', 'subagent', 'tool-1'),
            item('5', 'user', 'latest')
        ];
        const result = recentChatMessages(
            Object.fromEntries(items.map((entry) => [entry.id, entry])),
            items.map((entry) => entry.id),
            2
        );
        expect(result.messages).toEqual([
            { role: 'assistant', text: 'answer', createdAt: 2 },
            { role: 'user', text: 'latest', createdAt: 5 }
        ]);
        expect(result.truncated).toBe(true);
    });

    test('caps one large message and the total text sent to Voice', () => {
        const items = [item('1', 'user', 'a'.repeat(4_000)), item('2', 'assistant', 'b'.repeat(10_000))];
        const result = recentChatMessages(Object.fromEntries(items.map((entry) => [entry.id, entry])), ['1', '2'], 20);
        expect(result.messages.every((message) => message.text.length <= 3_000)).toBe(true);
        expect(result.messages.reduce((total, message) => total + message.text.length, 0)).toBeLessThanOrEqual(12_000);
        expect(result.truncated).toBe(true);
    });
});
