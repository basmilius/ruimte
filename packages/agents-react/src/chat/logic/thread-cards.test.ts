import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatToolItem } from '@ruimte/agent-contracts';
import type { ThreadCard } from '../../host';
import { withThreadCards } from './thread-cards';
import { deriveTimelineRows, type TimelineRow } from './timeline';

function tool(id: string, createdAt: number, turnId: string, state: ChatToolItem['state'] = 'done'): ChatToolItem {
    return {
        id,
        kind: 'tool',
        createdAt,
        turnId,
        toolUseId: id,
        name: 'Bash',
        input: { command: 'ls' },
        output: '',
        state,
        parentToolUseId: null
    };
}

const settled: ChatItem[] = [
    { id: 't1', kind: 'turn', createdAt: 1000, turnId: 't1', state: 'done', endedAt: 9000, costUsd: 0 },
    { id: 'u1', kind: 'user', createdAt: 1000, turnId: 't1', text: 'make a cut' },
    tool('b1', 2000, 't1'),
    { id: 'n1', kind: 'assistant', createdAt: 3000, turnId: 't1', text: 'Rendering.', streaming: false },
    tool('b2', 4000, 't1'),
    { id: 'a1', kind: 'assistant', createdAt: 8000, turnId: 't1', text: 'Done.', streaming: false }
];

const options = { expandedGroups: new Set<string>(), expandedTurns: new Set<string>(), expandedSubagents: new Set<string>(), activeTurnId: null };

function card(id: string, at: number): ThreadCard {
    return { id, at, render: () => null };
}

function shape(rows: readonly TimelineRow[]): string[] {
    return rows.map((row) => (row.kind === 'app-card' ? row.id : row.kind));
}

describe('withThreadCards', () => {
    test('without cards the thread keeps the very rows it derived', () => {
        const rows = deriveTimelineRows(settled, options);
        expect(withThreadCards(rows, [])).toBe(rows);
    });

    test('a card from inside a folded turn waits under the fold, above the answer that closed it', () => {
        const rows = deriveTimelineRows(settled, options);
        expect(shape(withThreadCards(rows, [card('v1', 3500)]))).toEqual(['user', 'turn-fold', 'app-card-v1', 'assistant']);
    });

    test('an open turn shows the card between the calls it came between', () => {
        const rows = deriveTimelineRows(settled, { ...options, expandedTurns: new Set(['t1']) });
        expect(shape(withThreadCards(rows, [card('v1', 3500)]))).toEqual(['user', 'turn-fold', 'work', 'assistant', 'app-card-v1', 'work', 'assistant']);
    });

    test('a card from before the thread opens it, and one from after closes it', () => {
        const rows = deriveTimelineRows(settled, options);
        expect(shape(withThreadCards(rows, [card('late', 20_000), card('early', 10)]))).toEqual([
            'app-card-early',
            'user',
            'turn-fold',
            'assistant',
            'app-card-late'
        ]);
    });

    test('a running turn keeps its working row last, under every card', () => {
        const running: ChatItem[] = [
            { id: 't2', kind: 'turn', createdAt: 1000, turnId: 't2', state: 'running', endedAt: null, costUsd: 0 },
            { id: 'u2', kind: 'user', createdAt: 1000, turnId: 't2', text: 'again' },
            tool('b3', 2000, 't2', 'running')
        ];
        const rows = deriveTimelineRows(running, { ...options, activeTurnId: 't2' });
        expect(shape(withThreadCards(rows, [card('v2', 50_000)]))).toEqual(['user', 'work-live', 'app-card-v2', 'working']);
    });

    test('cards of the same moment keep the order the app gave them', () => {
        const rows = deriveTimelineRows(settled, options);
        expect(shape(withThreadCards(rows, [card('b', 20_000), card('a', 20_000)])).slice(-2)).toEqual(['app-card-b', 'app-card-a']);
    });

    test('a card keeps its row key apart from the chat items, whatever id the app gave it', () => {
        const rows = deriveTimelineRows(settled, options);
        const merged = withThreadCards(rows, [card('u1', 20_000)]);
        expect(new Set(merged.map((row) => row.id)).size).toBe(merged.length);
    });
});
