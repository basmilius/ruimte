import { describe, expect, test } from 'bun:test';
import type { RoutineRun } from '@ruimte/contracts';
import { OPEN_H, OPEN_MIN_H } from '@/canvas/beside-metrics';
import { besideLayout } from '@/routines/beside-layout';

const NODE = { x: 0, y: 0, w: 400, h: 560 };

function run(runId: string): RoutineRun {
    return { runId, routineId: 'morning', projectId: 'atlas', kind: 'scheduled', due: 0, at: 0, state: 'done', chatId: `chat-${runId}` };
}

const RUNS = [run('b'), run('a')];

function rectOf(cards: ReturnType<typeof besideLayout>, key: string) {
    return cards.find((card) => card.key === key)!.rect;
}

describe('the cards beside a routine node', () => {
    test('open a run not measured yet at the smallest height', () => {
        expect(rectOf(besideLayout(NODE, RUNS, undefined, 'art'), 'run:b').h).toBe(OPEN_MIN_H);
    });

    test('give the open run its measured height on the grid, up to the largest, and stack the rest under it', () => {
        const cards = besideLayout(NODE, RUNS, undefined, 'art', { openHeights: { b: 203 } });
        expect(rectOf(cards, 'run:b').h).toBe(208);
        expect(rectOf(cards, 'run:a').y).toBe(208 + 8);
        expect(rectOf(besideLayout(NODE, RUNS, undefined, 'art', { openHeights: { b: 2000 } }), 'run:b').h).toBe(OPEN_H);
    });

    test('use the height a run measured only for that run', () => {
        expect(rectOf(besideLayout(NODE, RUNS, 'a', 'art', { openHeights: { b: 300 } }), 'run:a').h).toBe(OPEN_MIN_H);
    });

    test('with the runs hidden, hold only the Output, in the first column at the newest version with its line from the node', () => {
        const kept = { ...run('a'), versionId: 'v1' };
        const cards = besideLayout(NODE, [run('b'), kept], undefined, 'art', { runsHidden: true, runsWidth: 536 });
        expect(cards).toHaveLength(1);
        expect(cards[0]).toMatchObject({ kind: 'output', versionId: 'v1', from: null, fallback: null, rect: { x: 400 + 72, y: 0 } });
    });

    test('set the width of every run with the column, and move the Output with it', () => {
        const cards = besideLayout(NODE, RUNS, undefined, 'art', { runsWidth: 536 });
        expect(rectOf(cards, 'run:b').w).toBe(536);
        expect(rectOf(cards, 'run:a').w).toBe(536);
        expect(rectOf(cards, 'output').x).toBe(400 + 72 + 536 + 72);
    });
});
