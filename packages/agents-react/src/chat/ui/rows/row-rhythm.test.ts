import { describe, expect, test } from 'bun:test';
import type { ChatAssistantItem, ChatToolItem, ChatUserItem } from '@ruimte/agent-contracts';
import type { TimelineRow } from '../../logic/timeline';
import { rowRhythm } from './row-rhythm';

const user = (id: string): TimelineRow => ({ kind: 'user', id, item: { id, kind: 'user' } as ChatUserItem });
const prose = (id: string): TimelineRow => ({ kind: 'assistant', id, item: { id, kind: 'assistant' } as ChatAssistantItem });
const call = (id: string): TimelineRow => ({ kind: 'work', id, tool: { id, kind: 'tool' } as ChatToolItem });

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
