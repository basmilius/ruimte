import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { chatRunsTurn, chatTurnProgress, FollowedTurn, type VoiceChatState } from './chat-turn.ts';

const running: ChatItem = { id: 'turn-1', kind: 'turn', createdAt: 1, turnId: 'turn-1', state: 'running', endedAt: null, costUsd: 0 };
const done: ChatItem = { ...running, state: 'done', endedAt: 5 };
const answer: ChatItem = { id: 'answer', kind: 'assistant', createdAt: 3, turnId: 'turn-1', text: 'All set.', streaming: false };
const approval: ChatItem = {
    id: 'approval',
    kind: 'approval',
    createdAt: 2,
    turnId: 'turn-1',
    toolUseId: 'tool-1',
    toolName: 'Bash',
    input: { description: 'Run the tests' },
    decision: 'pending'
} as ChatItem;

function chat(items: ChatItem[], status: VoiceChatState['info']['status'], activeTurnId: string | null): VoiceChatState {
    return { items, info: { status, activeTurnId } };
}

describe('chatTurnProgress', () => {
    test('a turn that ended settles with what it answered', () => {
        expect(chatTurnProgress(chat([done, answer], 'idle', null), 'turn-1')).toEqual({
            kind: 'settled',
            completion: { state: 'done', answer: 'All set.' }
        });
    });

    test('an idle chat is no finished turn', () => {
        expect(chatTurnProgress(chat([running], 'idle', 'turn-1'), 'turn-1')).toEqual({ kind: 'running', waiting: false });
    });

    test('waits only while the chat runs this very turn and asks for the person', () => {
        expect(chatTurnProgress(chat([running, approval], 'needs-you', 'turn-1'), 'turn-1')).toEqual({ kind: 'running', waiting: true });
        expect(chatTurnProgress(chat([running, approval], 'needs-you', 'turn-2'), 'turn-1')).toEqual({ kind: 'running', waiting: false });
    });

    test('the chat that runs the turn has not settled it', () => {
        expect(chatRunsTurn({ activeTurnId: 'turn-1' }, 'turn-1')).toBe(true);
        expect(chatRunsTurn({ activeTurnId: null }, 'turn-1')).toBe(false);
    });
});

describe('FollowedTurn', () => {
    test('tells each wait once and a later wait again', () => {
        const turn = new FollowedTurn('turn-1');
        const waiting = chat([running, approval], 'needs-you', 'turn-1');
        const working = chat([running], 'running', 'turn-1');

        expect(turn.observe(waiting)).toEqual({ kind: 'waits', count: 1, waits: ['approval for Bash: Run the tests'] });
        expect(turn.observe(waiting)).toEqual({ kind: 'quiet' });
        expect(turn.observe(working)).toEqual({ kind: 'quiet' });
        expect(turn.observe(waiting)).toMatchObject({ kind: 'waits', count: 2 });
    });

    test('ends at the settled turn', () => {
        const turn = new FollowedTurn('turn-1');

        expect(turn.observe(chat([done, answer], 'idle', null))).toEqual({ kind: 'settled', completion: { state: 'done', answer: 'All set.' } });
    });
});
