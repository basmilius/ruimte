import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { completionPrompt, spokenExcerpt, turnCompletion } from './follow-up.ts';

describe('voice AI Chat follow-up', () => {
    test('waits for the exact tracked turn to settle', () => {
        const items: ChatItem[] = [
            { id: 'old', kind: 'turn', createdAt: 1, turnId: 'old', state: 'done', endedAt: 2, costUsd: 0 },
            { id: 'old-answer', kind: 'assistant', createdAt: 2, turnId: 'old', text: 'Old result', streaming: false },
            { id: 'tracked', kind: 'turn', createdAt: 3, turnId: 'tracked', state: 'running', endedAt: null, costUsd: 0 }
        ];
        expect(turnCompletion({ items, activeTurnId: 'tracked' }, 'tracked')).toBeNull();
    });

    test('returns only top-level final answers from the tracked turn', () => {
        const items: ChatItem[] = [
            { id: 'tracked', kind: 'turn', createdAt: 1, turnId: 'tracked', state: 'done', endedAt: 4, costUsd: 0 },
            { id: 'child', kind: 'assistant', createdAt: 2, turnId: 'tracked', text: 'Subagent detail', streaming: false, parentToolUseId: 'tool-1' },
            { id: 'answer', kind: 'assistant', createdAt: 3, turnId: 'tracked', text: 'The requested report is ready.', streaming: false }
        ];
        expect(turnCompletion({ items, activeTurnId: null }, 'tracked')).toEqual({ state: 'done', answer: 'The requested report is ready.' });
    });

    test('a turn whose item is not held settles once the chat no longer runs it, and an error note says how', () => {
        const items: ChatItem[] = [
            { id: 'answer', kind: 'assistant', createdAt: 1, turnId: 'tracked', text: 'All done.', streaming: false },
            { id: 'failed', kind: 'note', createdAt: 2, turnId: 'tracked', level: 'error', text: 'Claude Code exited with code 1' }
        ];
        expect(turnCompletion({ items, activeTurnId: 'tracked' }, 'tracked')).toBeNull();
        expect(turnCompletion({ items, activeTurnId: null }, 'tracked')).toEqual({ state: 'error', answer: 'All done.' });
        expect(turnCompletion({ items: [], activeTurnId: null }, 'queued')).toBeNull();
    });

    test('turns a completion into a bounded instruction for Voice', () => {
        const prompt = completionPrompt(
            { key: 'local:chat', chatId: 'chat', project: 'Original project', chat: 'Research', turnId: 'turn-1' },
            { state: 'done', answer: 'I found the answer.' }
        );
        expect(prompt).toContain('AI Chat “Research”');
        expect(prompt).toContain('Project: Original project');
        expect(prompt).toContain('I found the answer.');
        expect(prompt).toContain('ended with state done');
        expect(prompt).toContain('End of quoted AI Chat result.');
        expect(prompt).not.toContain('only the start');
    });

    test('gives the voice only the start of a long answer, cut where a sentence ends', () => {
        const answer = `${'The first finding is solid. '.repeat(30)}${'More detail follows here. '.repeat(100)}`;
        const { text, cut } = spokenExcerpt(answer);
        expect(cut).toBe(true);
        expect(text.length).toBeLessThanOrEqual(1200);
        expect(text.endsWith('.')).toBe(true);
        const prompt = completionPrompt({ key: 'local:chat-1', chatId: 'chat-1', chat: 'Research', turnId: 'turn-1' }, { state: 'done', answer });
        expect(prompt).toContain('This is only the start of a longer answer. chat.read on chat-1 reads the rest when the user asks.');
    });

    test('cuts a long answer without a sentence end where it fits, and says so', () => {
        const { text, cut } = spokenExcerpt('x'.repeat(5000));
        expect(cut).toBe(true);
        expect(text).toBe(`${'x'.repeat(1200)}…`);
    });
});
