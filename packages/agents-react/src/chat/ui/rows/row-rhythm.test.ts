import { describe, expect, test } from 'bun:test';
import type { ChatAssistantItem, ChatToolItem, ChatTurnItem, ChatUserItem } from '@ruimte/agent-contracts';
import type { TimelineRow } from '../../logic/timeline';
import { replyHeader, rowRhythm } from './row-rhythm';

function user(id: string, createdAt = 0): TimelineRow {
    return { kind: 'user', id, item: { id, kind: 'user', createdAt } as ChatUserItem };
}
function opener(id: string, createdAt: number): TimelineRow {
    return { kind: 'turn-start', id, label: '', turn: { id, kind: 'turn', createdAt } as ChatTurnItem };
}
function prose(id: string): TimelineRow {
    return { kind: 'assistant', id, item: { id, kind: 'assistant' } as ChatAssistantItem };
}
function call(id: string): TimelineRow {
    return { kind: 'work', id, tool: { id, kind: 'tool' } as ChatToolItem };
}

describe('the gaps a row wears', () => {
    test('a question makes room for the answer under it', () => {
        expect(rowRhythm(user('u1'), null)).toContain('pb-(--chat-answer-gap)');
        expect(rowRhythm(prose('a1'), null)).toBe('');
    });

    test('the seam where tool lines meet prose gets the block gap', () => {
        expect(rowRhythm(prose('a1'), call('w1'))).toBe('pt-(--chat-block-gap)');
        expect(rowRhythm(call('w2'), prose('a1'))).toBe('pt-(--chat-block-gap)');
    });

    test('two rows of one rhythm sit tight against each other', () => {
        expect(rowRhythm(call('w2'), call('w1'))).toBe('');
        expect(rowRhythm(prose('a2'), prose('a1'))).toBe('');
    });

    // A question already carries the gap before it, and the row after one is its answer.
    test('nothing around a question counts as a seam', () => {
        expect(rowRhythm(prose('a1'), user('u1'))).toBe('');
        expect(rowRhythm(user('u1'), prose('a1'))).toBe('pb-(--chat-answer-gap)');
    });
});

describe('where a reply gets its header', () => {
    test('over the first row after the question, dated when it was asked', () => {
        expect(replyHeader(prose('a1'), user('u1', 1000))).toEqual({ at: 1000 });
        expect(replyHeader(call('w1'), user('u1', 1000))).toEqual({ at: 1000 });
    });

    test('over the first row of a turn the agent opened itself', () => {
        expect(replyHeader(prose('a1'), opener('t1', 2000))).toEqual({ at: 2000 });
        expect(replyHeader(opener('t1', 2000), prose('a0'))).toBeNull();
    });

    test('not again further into the reply', () => {
        expect(replyHeader(prose('a2'), call('w1'))).toBeNull();
        expect(replyHeader(prose('a2'), prose('a1'))).toBeNull();
    });

    test('never over a question', () => {
        expect(replyHeader(user('u2'), prose('a1'))).toBeNull();
        expect(replyHeader(user('u1'), null)).toBeNull();
    });

    test('without a time on a thread that starts halfway through a reply', () => {
        expect(replyHeader(prose('a1'), null)).toEqual({ at: null });
    });
});
