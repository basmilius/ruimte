import { expect, test } from 'bun:test';
import { memoryUsage } from 'bun:jsc';
import { diffLines } from './diff.ts';

/*
 * A file of its own, so the process has not peaked higher on another test before this one runs: the
 * peak only ever grows, so a high one from elsewhere could hide a regression, never fake one.
 */
const sides = (length: number): [string[], string[]] => [
    Array.from({ length }, (_, index) => (index % 2 === 0 ? `same ${index}` : `left ${index}`)),
    Array.from({ length }, (_, index) => (index % 2 === 0 ? `same ${index}` : `right ${index}`))
];

for (const [length, count] of [
    [5000, 1],
    [3000, 1500]
] as const) {
    test(`a diff of two files of ${length} lines that differ on every other line stays under 20 MB`, () => {
        const [left, right] = sides(length);
        Bun.gc(true);
        const before = memoryUsage().current;
        const changes = diffLines(left, right);
        expect(memoryUsage().peak - before).toBeLessThan(20 * 1024 * 1024);
        expect(changes.length).toBe(count);
    });
}
