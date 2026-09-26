import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/agent-contracts';
import {
    layoutTicks,
    messageAt,
    messagesInView,
    slotInView,
    slotOf,
    stepMessage,
    threadPaddingLeft,
    tickOfRow,
    ticksWithHits,
    tickWidth,
    ticksOf,
    type ScrubberTick,
    type TickKind
} from './scrubber';
import { bookmarkRows } from './bookmarks';
import { deriveTimelineRows } from './timeline';

const options = { expandedGroups: new Set<string>(), expandedTurns: new Set<string>(), expandedSubagents: new Set<string>(), activeTurnId: null };

const thread: ChatItem[] = [
    { id: 't1', kind: 'turn', createdAt: 1000, turnId: 't1', state: 'done', endedAt: 2000, costUsd: 0 },
    { id: 'u1', kind: 'user', createdAt: 1000, turnId: 't1', text: 'fix it' },
    { id: 'a1', kind: 'assistant', createdAt: 1500, turnId: 't1', text: 'Done.', streaming: false },
    { id: 't2', kind: 'turn', createdAt: 3000, turnId: 't2', state: 'done', endedAt: 4000, costUsd: 0, origin: 'agent', taskIds: ['k1', 'k2'] },
    { id: 'a2', kind: 'assistant', createdAt: 3500, turnId: 't2', text: 'Both tasks are in.', streaming: false },
    { id: 't3', kind: 'turn', createdAt: 5000, turnId: 't3', state: 'done', endedAt: 6000, costUsd: 0, origin: 'agent', label: 'lint' },
    { id: 'a3', kind: 'assistant', createdAt: 5500, turnId: 't3', text: 'Lint is clean.', streaming: false },
    { id: 't4', kind: 'turn', createdAt: 7000, turnId: 't4', state: 'done', endedAt: 8000, costUsd: 0 },
    {
        id: 'u4',
        kind: 'user',
        createdAt: 7000,
        turnId: 't4',
        text: '',
        attachments: [{ id: 'f1', name: 'shot.png', mime: 'image/png', size: 10 }]
    } as ChatItem
];

describe('ticksOf', () => {
    test('a message of the person and a wake by tasks get a tick, a turn the CLI opened on its own gets none', () => {
        const rows = deriveTimelineRows(thread, options);
        const ticks = ticksOf(rows);
        expect(ticks.map((tick) => [tick.id, tick.kind])).toEqual([
            ['u1', 'person'],
            ['start-t2', 'wake'],
            ['u4', 'person']
        ]);
        expect(ticks.every((tick) => rows[tick.rowIndex]!.id === tick.id)).toBe(true);
        expect(ticks[1]!.text).toBe('Woken by 2 tasks');
    });

    test('a wake by a message is a place to return to as much as a wake by a task', () => {
        const woken: ChatItem[] = [
            {
                id: 't5',
                kind: 'turn',
                createdAt: 9000,
                turnId: 't5',
                state: 'done',
                endedAt: 10000,
                costUsd: 0,
                origin: 'agent',
                label: 'Message from Lexer',
                messageFrom: ['chat-2']
            },
            { id: 'a5', kind: 'assistant', createdAt: 9500, turnId: 't5', text: 'Noted.', streaming: false }
        ];
        const ticks = ticksOf(deriveTimelineRows(woken, options));
        expect(ticks.map((tick) => [tick.id, tick.kind, tick.text])).toEqual([['start-t5', 'wake', 'Woken by a message: Message from Lexer']]);
    });

    test('a bookmark marks the tick of its message, and a marked reply gets a tick of its own, or its fold does', () => {
        const bookmark = (itemId: string) => ({ itemId, excerpt: `start of ${itemId}`, createdAt: 1 });
        const rows = deriveTimelineRows(thread, options);
        const marks = bookmarkRows(rows, [bookmark('u1'), bookmark('a2')], Object.fromEntries(thread.map((item) => [item.id, item])));
        const ticks = ticksOf(rows, marks);
        expect(ticks.map((tick) => [tick.id, tick.kind, tick.bookmark?.itemId ?? null])).toEqual([
            ['u1', 'person', 'u1'],
            ['start-t2', 'wake', null],
            ['a2', 'bookmark', 'a2'],
            ['u4', 'person', null]
        ]);

        const folded: ChatItem[] = [
            { id: 't9', kind: 'turn', createdAt: 1, turnId: 't9', state: 'done', endedAt: 2, costUsd: 0 },
            { id: 'u9', kind: 'user', createdAt: 1, turnId: 't9', text: 'go' },
            { id: 'a9', kind: 'assistant', createdAt: 1, turnId: 't9', text: 'On it.', streaming: false },
            { id: 'x9', kind: 'tool', createdAt: 1, turnId: 't9', toolUseId: 'x9', name: 'Bash', input: {}, state: 'done', output: '', parentToolUseId: null },
            { id: 'b9', kind: 'assistant', createdAt: 2, turnId: 't9', text: 'Done.', streaming: false }
        ];
        const foldedRows = deriveTimelineRows(folded, options);
        const hidden = ticksOf(foldedRows, bookmarkRows(foldedRows, [bookmark('a9')], Object.fromEntries(folded.map((item) => [item.id, item]))));
        expect(hidden.map((tick) => [tick.id, tick.kind, tick.text])).toEqual([
            ['u9', 'person', 'go'],
            ['fold-t9', 'bookmark', 'start of a9']
        ]);
    });

    test('a message of only attachments reads as their names', () => {
        const ticks = ticksOf(deriveTimelineRows(thread, options));
        expect(ticks[2]!.text).toBe('shot.png');
    });
});

const kinds = (count: number): TickKind[] => Array.from({ length: count }, (_, i) => (i % 5 === 4 ? 'wake' : 'person'));

describe('layoutTicks', () => {
    test('a few messages sit at the full pitch, centered in whole pixels', () => {
        const layout = layoutTicks(kinds(3), 101);
        expect(layout.pitch).toBe(8);
        expect(layout.top).toBe(38);
        expect(layout.slots.map((slot) => slot.y)).toEqual([41, 49, 57]);
        expect(layout.slots.map((slot) => [slot.first, slot.last])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2]
        ]);
    });

    test('more messages than the full pitch allows squeeze the pitch, one tick each', () => {
        const layout = layoutTicks(kinds(30), 180);
        expect(layout.pitch).toBe(6);
        expect(layout.slots).toHaveLength(30);
        expect(Number.isInteger(layout.top)).toBe(true);
    });

    test('more messages than pixels merge into ticks that each cover a run', () => {
        const layout = layoutTicks(kinds(1000), 200);
        expect(layout.pitch).toBe(4);
        expect(layout.slots).toHaveLength(50);
        expect(layout.slots[0]).toMatchObject({ first: 0, last: 19 });
        expect(layout.slots[49]).toMatchObject({ first: 980, last: 999 });
        // Every message is under exactly one tick.
        const covered = layout.slots.reduce((sum, slot) => sum + slot.last - slot.first + 1, 0);
        expect(covered).toBe(1000);
    });

    test("a merged tick is the person's when one message in it is", () => {
        const layout = layoutTicks(['wake', 'wake', 'person', 'wake', 'wake', 'wake'], 12);
        expect(layout.slots.map((slot) => slot.kind)).toEqual(['wake', 'person', 'wake']);
    });

    test('a merged tick is marked when a message in it has a bookmark', () => {
        const layout = layoutTicks(['wake', 'wake', 'bookmark', 'wake', 'person', 'wake'], 12, [false, false, true, false, false, false]);
        expect(layout.slots.map((slot) => [slot.kind, slot.marked])).toEqual([
            ['wake', false],
            ['bookmark', true],
            ['person', false]
        ]);
    });

    test('a strip without room draws nothing', () => {
        expect(layoutTicks(kinds(5), 2).slots).toEqual([]);
    });

    test('a merged tick is found when a find hit falls under a message in it', () => {
        const layout = layoutTicks(['person', 'person', 'person', 'person'], 8, [], [false, false, false, true]);
        expect(layout.slots.map((slot) => slot.found)).toEqual([false, true]);
    });
});

describe('find hits on the strip', () => {
    const tickAt = (rowIndex: number): ScrubberTick => ({
        id: `r${rowIndex}`,
        rowIndex,
        kind: 'person',
        text: '',
        createdAt: 0,
        turnId: null,
        bookmark: null
    });
    const ticks = [tickAt(2), tickAt(10), tickAt(20)];

    test('a row counts under the tick before it, and a row above the first tick under the first', () => {
        expect(tickOfRow(ticks, 0)).toBe(0);
        expect(tickOfRow(ticks, 10)).toBe(1);
        expect(tickOfRow(ticks, 19)).toBe(1);
        expect(tickOfRow(ticks, 99)).toBe(2);
        expect(tickOfRow([], 3)).toBeNull();
    });

    test('marks every tick a hit falls under, once', () => {
        expect(ticksWithHits(ticks, [3, 4, 25])).toEqual([true, false, true]);
    });
});

describe('messageAt and slotOf', () => {
    test('a height picks the tick under it and clamps outside the ticks', () => {
        const layout = layoutTicks(kinds(3), 101);
        expect(messageAt(layout, 0)).toBe(0);
        expect(messageAt(layout, 47)).toBe(1);
        expect(messageAt(layout, 50)).toBe(1);
        expect(messageAt(layout, 100)).toBe(2);
    });

    test('inside a merged tick the height picks the nearest of its messages', () => {
        const layout = layoutTicks(kinds(1000), 200);
        expect(messageAt(layout, 0)).toBe(0);
        expect(messageAt(layout, 2)).toBe(10);
        expect(messageAt(layout, 199)).toBe(995);
        expect(messageAt(layout, 240)).toBe(999);
    });

    test('a message finds the tick it is drawn under', () => {
        const layout = layoutTicks(kinds(1000), 200);
        expect(slotOf(layout, 0)).toBe(0);
        expect(slotOf(layout, 19)).toBe(0);
        expect(slotOf(layout, 20)).toBe(1);
        expect(slotOf(layout, 999)).toBe(49);
        expect(slotOf(layout, 1000)).toBeNull();
    });

    test('without a pointer every tick of a kind has one length', () => {
        expect(tickWidth('person', null)).toBe(8);
        expect(tickWidth('wake', null)).toBe(5);
    });

    test('under a pointer the hovered tick is longest and its neighbors grow a step', () => {
        expect(tickWidth('person', 0)).toBe(16);
        expect(tickWidth('wake', 0)).toBe(16);
        expect(tickWidth('person', 1)).toBeGreaterThan(tickWidth('person', null));
        expect(tickWidth('wake', 1)).toBeGreaterThan(tickWidth('wake', null));
        expect(tickWidth('person', 2)).toBe(tickWidth('person', null));
        expect(tickWidth('wake', 5)).toBe(tickWidth('wake', null));
    });
});

describe('messagesInView', () => {
    const starts = [0, 400, 1200, 1300, 2600];

    test('every message with part of its stretch on screen is in view', () => {
        expect(messagesInView({ starts, scrollTop: 0, visibleHeight: 800 })).toEqual({ first: 0, last: 1 });
        expect(messagesInView({ starts, scrollTop: 1100, visibleHeight: 800 })).toEqual({ first: 1, last: 3 });
    });

    test('a question whose answer fills the screen stays in view after it scrolled out', () => {
        expect(messagesInView({ starts, scrollTop: 1500, visibleHeight: 800 })).toEqual({ first: 3, last: 3 });
    });

    test('a message that starts on the last line is not in view yet', () => {
        expect(messagesInView({ starts, scrollTop: 400, visibleHeight: 800 })).toEqual({ first: 1, last: 1 });
        expect(messagesInView({ starts, scrollTop: 401, visibleHeight: 800 })).toEqual({ first: 1, last: 2 });
    });

    test('no messages, or none reached yet, nothing in view', () => {
        expect(messagesInView({ starts: [], scrollTop: 0, visibleHeight: 800 })).toBeNull();
        expect(messagesInView({ starts: [900], scrollTop: 0, visibleHeight: 800 })).toBeNull();
        expect(messagesInView({ starts, scrollTop: 0, visibleHeight: 0 })).toBeNull();
    });

    test('a merged tick is in view when any of its messages is', () => {
        const slot = { first: 20, last: 39, kind: 'person' as const, marked: false, found: false, y: 0 };
        expect(slotInView(slot, { first: 39, last: 41 })).toBe(true);
        expect(slotInView(slot, { first: 10, last: 20 })).toBe(true);
        expect(slotInView(slot, { first: 40, last: 45 })).toBe(false);
        expect(slotInView(slot, null)).toBe(false);
    });
});

describe('stepMessage', () => {
    const starts = [0, 400, 1200, 1300, 2600];
    const all = (): boolean => true;

    test('back from a message at the top is the one before it, back from inside one is its own start', () => {
        expect(stepMessage(starts, all, 1200, -1)).toBe(1);
        expect(stepMessage(starts, all, 1201, -1)).toBe(1);
        expect(stepMessage(starts, all, 1250, -1)).toBe(2);
        expect(stepMessage(starts, all, 0, -1)).toBeNull();
    });

    test('forward is the first message that starts below the top', () => {
        expect(stepMessage(starts, all, 1200, 1)).toBe(3);
        expect(stepMessage(starts, all, 1199.5, 1)).toBe(3);
        expect(stepMessage(starts, all, 2600, 1)).toBeNull();
    });

    test('only eligible messages are stepped to', () => {
        const even = (index: number): boolean => index % 2 === 0;
        expect(stepMessage(starts, even, 0, 1)).toBe(2);
        expect(stepMessage(starts, even, 2600, -1)).toBe(2);
    });
});

describe('threadPaddingLeft', () => {
    test('a thread without the strip keeps its usual padding', () => {
        expect(threadPaddingLeft(600, false)).toBe(16);
    });

    test('a wide view keeps the usual padding, its centered column already clears the strip', () => {
        expect(threadPaddingLeft(1600, true)).toBe(16);
        expect(threadPaddingLeft(848, true)).toBe(16);
    });

    test('a narrower view pads until the text starts 40 pixels in', () => {
        const textLeft = (width: number): number => {
            const padding = threadPaddingLeft(width, true);
            return padding + Math.max(0, (width - padding - 16 - 768) / 2);
        };
        expect(threadPaddingLeft(600, true)).toBe(40);
        expect(threadPaddingLeft(840, true)).toBe(24);
        for (const width of [500, 824, 830, 841, 843, 847, 850]) {
            expect(textLeft(width)).toBeGreaterThanOrEqual(40);
            expect(Number.isInteger(threadPaddingLeft(width, true))).toBe(true);
        }
    });
});
