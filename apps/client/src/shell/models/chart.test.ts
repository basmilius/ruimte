import { describe, expect, test } from 'bun:test';
import {
    chartModels,
    costAxis,
    frontier,
    intelligenceAxis,
    MARK_SHAPES,
    markPath,
    modelMarks,
    movePoint,
    nearestPoint,
    overlaps,
    placeLabels,
    type ChartModel
} from '@/shell/models/chart';

const point = (costPerTask: number, intelligence: number) => ({ costPerTask, intelligence });

const model = (id: string, provider: 'claude' | 'codex', legacy = false): ChartModel => ({ id, name: id, provider, legacy, points: [] });

describe('the band', () => {
    test('runs through the points nothing beats on both axes, cheapest first', () => {
        const cheap = point(0.004, 20.9);
        const beaten = point(0.26, 33.5);
        const middle = point(0.13, 33.9);
        const dear = point(5.98, 57.6);
        const dearAndWorse = point(7.63, 53.4);
        expect(frontier([dear, beaten, cheap, dearAndWorse, middle])).toEqual([cheap, middle, dear]);
    });

    test('keeps one of two points at the same cost, the better one', () => {
        const worse = point(1, 40);
        const better = point(1, 45);
        expect(frontier([worse, better])).toEqual([better]);
    });

    test('drops a point that only ties on intelligence and costs more', () => {
        const cheaper = point(1, 40);
        expect(frontier([point(2, 40), cheaper])).toEqual([cheaper]);
    });

    test('is empty without points', () => {
        expect(frontier([])).toEqual([]);
    });
});

describe('the axes', () => {
    test('a log axis runs over whole decades around the costs', () => {
        const axis = costAxis([0.004, 0.55, 7.63], 'log');
        expect(axis.ticks).toEqual([0.001, 0.01, 0.1, 1, 10]);
        expect(axis.at(0.001)).toBe(0);
        expect(axis.at(10)).toBe(1);
        expect(axis.at(0.1)).toBeCloseTo(0.5);
    });

    test('a linear axis starts at zero and ends on a round number', () => {
        const axis = costAxis([0.004, 7.63], 'linear');
        expect(axis.ticks[0]).toBe(0);
        expect(axis.ticks.at(-1)).toBeGreaterThanOrEqual(7.63);
        expect(axis.at(0)).toBe(0);
    });

    test('the index runs in steps of ten around the scores', () => {
        expect(intelligenceAxis([20.9, 57.6]).ticks).toEqual([20, 30, 40, 50, 60]);
        expect(intelligenceAxis([50]).ticks).toEqual([50, 60]);
    });
});

describe('the marks', () => {
    test("give every model its provider's color and a shape of its own within that provider, legacy ones after them", () => {
        const marks = modelMarks([model('old', 'claude', true), model('opus', 'claude'), model('sonnet', 'claude'), model('sol', 'codex')]);
        expect(marks.get('opus')).toEqual({ color: 'var(--chart-claude)', shape: 'circle' });
        expect(marks.get('sonnet')).toEqual({ color: 'var(--chart-claude)', shape: 'square' });
        expect(marks.get('old')).toEqual({ color: 'var(--chart-claude)', shape: 'triangle' });
        expect(marks.get('sol')).toEqual({ color: 'var(--chart-codex)', shape: 'circle' });
    });

    test('draw every shape as one closed path', () => {
        for (const shape of MARK_SHAPES) {
            expect(markPath(shape, 10, 10, 4)).toMatch(/^M.* Z$/);
        }
    });

    test('leave out a provider this client has no color for', () => {
        expect(chartModels([model('opus', 'claude'), { ...model('other', 'claude'), provider: 'someone' }]).map((entry) => entry.id)).toEqual(['opus']);
    });
});

describe('the labels of the lines', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 300 };

    test('sit beside and above the last point when nothing is in the way', () => {
        const [place] = placeLabels(
            [
                [
                    { x: 100, y: 200 },
                    { x: 200, y: 100 }
                ]
            ],
            [60],
            bounds
        );
        expect(place).toMatchObject({ x: 210, y: 90, anchor: 'start' });
    });

    test('stay inside the chart', () => {
        const [place] = placeLabels(
            [
                [
                    { x: 100, y: 200 },
                    { x: 390, y: 100 }
                ]
            ],
            [60],
            bounds
        );
        expect(place!.box.right).toBeLessThanOrEqual(bounds.right);
    });

    test('never land on a label placed before them', () => {
        const places = placeLabels([[{ x: 300, y: 100 }], [{ x: 290, y: 104 }]], [60, 60], bounds);
        const [first, second] = places.map((place) => place!.box);
        expect(overlaps(first!, second!)).toBe(false);
    });

    test('leave a line without points out', () => {
        expect(placeLabels([[]], [60], bounds)).toEqual([null]);
    });
});

describe('the pointer', () => {
    test('finds the closest point within reach', () => {
        const lines = [
            [
                { x: 10, y: 10 },
                { x: 50, y: 50 }
            ],
            [{ x: 58, y: 50 }]
        ];
        expect(nearestPoint(lines, 55, 50, 20)).toEqual({ line: 1, index: 0 });
        expect(nearestPoint(lines, 200, 200, 20)).toBeNull();
    });
});

describe('the arrow keys', () => {
    test('walk a line and jump to the next line that has points', () => {
        const counts = [5, 0, 2];
        expect(movePoint(counts, { line: 0, index: 3 }, 'ArrowRight')).toEqual({ line: 0, index: 4 });
        expect(movePoint(counts, { line: 0, index: 4 }, 'ArrowRight')).toBeNull();
        expect(movePoint(counts, { line: 0, index: 3 }, 'ArrowDown')).toEqual({ line: 2, index: 1 });
        expect(movePoint(counts, { line: 2, index: 1 }, 'ArrowUp')).toEqual({ line: 0, index: 1 });
        expect(movePoint(counts, { line: 0, index: 0 }, 'ArrowUp')).toBeNull();
        expect(movePoint(counts, { line: 0, index: 0 }, 'Enter')).toBeNull();
    });
});
