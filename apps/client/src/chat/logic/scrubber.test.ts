import { describe, expect, test } from 'bun:test';
import type { ChatItem } from '@ruimte/contracts';
import { layoutTicks, messageAt, messageInView, slotOf, stepMessage, stripLeft, tickWidth, ticksOf, type TickKind } from './scrubber';
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

    test('a strip without room draws nothing', () => {
        expect(layoutTicks(kinds(5), 2).slots).toEqual([]);
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

    test('ticks grow toward the message being read, one step out', () => {
        expect(tickWidth('person', 0)).toBe(16);
        expect(tickWidth('wake', 0)).toBe(16);
        expect(tickWidth('person', 1)).toBeGreaterThan(tickWidth('person', 2));
        expect(tickWidth('person', 2)).toBe(tickWidth('person', null));
        expect(tickWidth('wake', 5)).toBeLessThan(tickWidth('person', 5));
    });
});

describe('messageInView', () => {
    const starts = [0, 400, 1200, 1300, 2600];

    test('the message being read is the last to start above a quarter down the thread', () => {
        expect(messageInView({ starts, scrollTop: 0, visibleHeight: 800, atEnd: false })).toBe(0);
        expect(messageInView({ starts, scrollTop: 250, visibleHeight: 800, atEnd: false })).toBe(1);
        expect(messageInView({ starts, scrollTop: 1150, visibleHeight: 800, atEnd: false })).toBe(3);
    });

    test('at the end a last message low on screen is the one being read', () => {
        expect(messageInView({ starts, scrollTop: 2000, visibleHeight: 800, atEnd: false })).toBe(3);
        expect(messageInView({ starts, scrollTop: 2000, visibleHeight: 800, atEnd: true })).toBe(4);
    });

    test('no messages, nothing in view', () => {
        expect(messageInView({ starts: [], scrollTop: 0, visibleHeight: 800, atEnd: true })).toBeNull();
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

describe('stripLeft', () => {
    test('a node never gets a strip, however wide', () => {
        expect(stripLeft(1600, false)).toBeNull();
    });

    test('a view puts the strip in the free space left of the column', () => {
        expect(stripLeft(1216, true)).toBe(192);
        expect(stripLeft(848, true)).toBe(8);
    });

    test('a view without room for the strip left of the column gets none', () => {
        expect(stripLeft(847, true)).toBeNull();
        expect(stripLeft(700, true)).toBeNull();
    });
});
