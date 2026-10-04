import { expect, test } from 'bun:test';
import { memoryUsage } from 'bun:jsc';
import { diffLines } from './diff.ts';

/*
 * An integration test, since the peak is the whole process's: in the parallel default run another
 * file's work counts along. Run on its own a high peak from elsewhere could hide a regression, never
 * fake one.
 */
function sides(length: number): [string[], string[]] {
    return [
        Array.from({ length }, (_, index) => (index % 2 === 0 ? `same ${index}` : `left ${index}`)),
        Array.from({ length }, (_, index) => (index % 2 === 0 ? `same ${index}` : `right ${index}`))
    ];
}

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
