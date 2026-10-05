import { describe, expect, test } from 'bun:test';
import { replacedWords } from './word-diff';

describe('the words a change replaced', () => {
    test('marks the word that differs and nothing around it', () => {
        const removed = ['  const salary = salaryFit(candidate.salary, vacancy.range);'];
        const added = ['  const salary = salaryFit(candidate.expectedSalary, vacancy.range);'];
        const [ranges] = replacedWords(removed, added);
        expect(ranges!.map(([start, end]) => removed[0]!.slice(start, end))).toEqual(['salary']);
    });

    test('marks each separate stretch of a line that changed in two places', () => {
        const [ranges] = replacedWords(['a one b two c'], ['a 1 b 2 c']);
        expect(ranges!.map(([start, end]) => 'a one b two c'.slice(start, end))).toEqual(['one', 'two']);
    });

    test('draws no words where the lines added are not the lines removed, one for one', () => {
        expect(replacedWords(['one', 'two'], ['three'])).toEqual([[], []]);
        expect(replacedWords(['gone'], [])).toEqual([[]]);
    });

    test('a changed line that shares nothing marks the whole line without its leading space', () => {
        const [ranges] = replacedWords(['  old'], ['  new']);
        expect(ranges).toEqual([[2, 5]]);
    });
});
