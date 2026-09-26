import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatToolItem } from '@ruimte/contracts';
import { EMPTY_FIND_QUERY, type FindQuery } from '@/find/query';
import { hitRow, indexRows, placeOfHit, searchChat } from './search';
import { deriveTimelineRows } from '@ruimte/agents-react/chat/logic/timeline';

const tool = (id: string, input: unknown, output: string, extra: Partial<ChatToolItem> = {}): ChatToolItem => ({
    id,
    kind: 'tool',
    createdAt: 1,
    turnId: 't1',
    toolUseId: id,
    name: 'Bash',
    input,
    output,
    state: 'done',
    parentToolUseId: null,
    ...extra
});

const thread: ChatItem[] = [
    { id: 't1', kind: 'turn', createdAt: 1000, turnId: 't1', state: 'done', endedAt: 13_000, costUsd: 0 },
    { id: 'u1', kind: 'user', createdAt: 1000, turnId: 't1', text: 'Where does the Sidebar read its rows?' },
    tool('b1', { command: 'grep -rn sidebar src' }, 'src/sidebar-rows.ts\nsrc/shell/Sidebar.tsx'),
    tool('b2', { command: 'ls' }, 'sidebars.md'),
    { id: 'a1', kind: 'assistant', createdAt: 5000, turnId: 't1', text: 'The sidebar reads sidebar-rows.ts.', streaming: false }
];

const query = (text: string, options: Partial<FindQuery> = {}): FindQuery => ({ ...EMPTY_FIND_QUERY, text, ...options });

const keys = (items: readonly ChatItem[], asked: FindQuery): string[] =>
    searchChat(items, asked).hits.map((hit) => `${hit.itemId}:${hit.field}:${hit.occurrence}`);

describe('searchChat', () => {
    test('finds in messages, in the line of a tool call and in its output, in thread order', () => {
        expect(keys(thread, query('sidebar'))).toEqual(['u1:text:0', 'b1:summary:0', 'b1:output:0', 'b1:output:1', 'b2:output:0', 'a1:text:0', 'a1:text:1']);
    });

    test('ignores case unless asked to match it', () => {
        expect(keys(thread, query('Sidebar', { caseSensitive: true }))).toEqual(['u1:text:0', 'b1:output:0']);
    });

    test('a whole word stops at letters and digits, not at a dash or a dot', () => {
        expect(keys(thread, query('sidebar', { wholeWord: true }))).toEqual([
            'u1:text:0',
            'b1:summary:0',
            'b1:output:0',
            'b1:output:1',
            'a1:text:0',
            'a1:text:1'
        ]);
        expect(keys(thread, query('rows', { wholeWord: true }))).toEqual(['u1:text:0', 'b1:output:0', 'a1:text:0']);
    });

    test('a regular expression is read as one, and an invalid one says so and finds nothing', () => {
        expect(keys(thread, query('sidebar(-rows)?\\.ts', { regex: true }))).toEqual(['b1:output:0', 'b1:output:1', 'a1:text:0']);
        expect(keys(thread, query('sidebar(-rows)?'))).toEqual([]);
        expect(searchChat(thread, query('sidebar(', { regex: true }))).toEqual({ hits: [], invalid: true });
        expect(searchChat(thread, query('sidebar('))).toEqual({ hits: [], invalid: false });
    });

    test('the three toggles together', () => {
        expect(keys(thread, query('^src/\\w+', { regex: true, wholeWord: true, caseSensitive: true }))).toEqual(['b1:output:0', 'b1:output:1']);
    });

    test('an empty query finds nothing and is not invalid', () => {
        expect(searchChat(thread, query(''))).toEqual({ hits: [], invalid: false });
    });

    test("a sub-agent's own steps stay out, its row and its report do not", () => {
        const items: ChatItem[] = [
            tool('c1', { command: 'grep sidebar' }, 'sidebar', { parentToolUseId: 'agent-1' }),
            {
                id: 's1',
                kind: 'subagent',
                createdAt: 1,
                turnId: 't1',
                toolUseId: 'agent-1',
                description: 'Map the sidebar',
                subagentType: null,
                prompt: null,
                background: false,
                status: 'done',
                startedAt: 1,
                finishedAt: 2,
                summary: null,
                result: 'The sidebar is one hook.',
                usage: null,
                lastTool: null,
                itemsTruncated: false
            } as ChatItem
        ];
        expect(keys(items, query('sidebar'))).toEqual(['s1:summary:0', 's1:output:0']);
    });
});

describe('where a hit is shown', () => {
    test('a hit in a folded turn opens the turn, then the run of tool calls, then lands on its row', () => {
        const options = { expandedGroups: new Set<string>(), expandedTurns: new Set<string>(), expandedSubagents: new Set<string>(), activeTurnId: null };
        const b1 = thread.find((item) => item.id === 'b1');

        const folded = deriveTimelineRows(thread, options);
        expect(placeOfHit(folded, indexRows(folded), b1)).toEqual({ kind: 'turn', turnId: 't1' });
        expect(hitRow(indexRows(folded), b1)).toBe(1);

        const unfolded = deriveTimelineRows(thread, { ...options, expandedTurns: new Set(['t1']) });
        const group = placeOfHit(unfolded, indexRows(unfolded), b1);
        expect(group).toEqual({ kind: 'group', id: 'group-b1' });

        const open = deriveTimelineRows(thread, { ...options, expandedTurns: new Set(['t1']), expandedGroups: new Set(['group-b1']) });
        const place = placeOfHit(open, indexRows(open), b1);
        expect(place).toEqual({ kind: 'row', index: open.findIndex((row) => row.id === 'b1') });
    });
});
