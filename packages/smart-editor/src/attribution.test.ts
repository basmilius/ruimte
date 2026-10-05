import { describe, expect, test } from 'bun:test';
import { AttributionRuns, colorValue } from './attribution.ts';

const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
const starts = lines.reduce<number[]>((all, _line, i) => [...all, i === 0 ? 0 : all[i - 1]! + lines[i - 1]!.length + 1], []);
const bounds = (line: number) => ({ start: starts[line]!, end: starts[line]! + lines[line]!.length });
const lineOf = (offset: number): number => starts.findLastIndex((start) => start <= offset);

describe('AttributionRuns', () => {
    test('reads the marks as one-based lines and clamps what lies outside the document', () => {
        const runs = new AttributionRuns();
        runs.set(
            [
                { id: 'a', startLine: 2, endLine: 3, color: '--agent-1' },
                { id: 'b', startLine: 199, endLine: 900, color: '--agent-2' }
            ],
            200,
            bounds
        );
        expect([...runs.linesIn(0, 199, 0, bounds(199).end, lineOf)].map(([line, run]) => `${line}:${run.id}`)).toEqual(['1:a', '2:a', '198:b', '199:b']);
    });

    test('lets the mark set last win where two overlap', () => {
        const runs = new AttributionRuns();
        runs.set(
            [
                { id: 'first', startLine: 1, endLine: 4, color: '--agent-1' },
                { id: 'second', startLine: 3, endLine: 4, color: '--agent-2' }
            ],
            200,
            bounds
        );
        expect([...runs.linesIn(0, 5, 0, bounds(5).end, lineOf)].map(([line, run]) => `${line}:${run.id}`)).toEqual([
            '0:first',
            '1:first',
            '2:second',
            '3:second'
        ]);
    });

    test('follows an edit and only reads the lines asked for', () => {
        const runs = new AttributionRuns();
        runs.set([{ id: 'a', startLine: 10, endLine: 12, color: '--agent-1' }], 200, bounds);
        runs.map([{ from: 0, to: 0, insertedLength: 0 }]);
        expect([...runs.linesIn(0, 8, 0, bounds(8).end, lineOf).keys()]).toEqual([]);
        expect([...runs.linesIn(10, 11, bounds(10).start, bounds(11).end, lineOf).keys()]).toEqual([10, 11]);
        expect([...runs.linesIn(0, 99, 0, bounds(99).end, lineOf).keys()]).toEqual([9, 10, 11]);
    });

    test('names a custom property as a var() and passes any other color through', () => {
        expect(colorValue('--agent-3')).toBe('var(--agent-3)');
        expect(colorValue('#c4602f')).toBe('#c4602f');
    });
});
