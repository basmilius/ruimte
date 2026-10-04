import { describe, expect, test } from 'bun:test';
import { changeMarksOf } from '@/shell/panels/change-marks';

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

describe('changeMarksOf', () => {
    test('has no marks for the same text, whatever its line endings', () => {
        expect(changeMarksOf(lines('a', 'b'), lines('a', 'b'))).toEqual([]);
        expect(changeMarksOf('a\r\nb\r\n', lines('a', 'b'))).toEqual([]);
    });

    test('marks added lines, changed lines and where lines were removed', () => {
        const base = lines('one', 'two', 'three', 'four', 'five');
        expect(changeMarksOf(base, lines('one', 'two', 'new', 'three', 'four', 'five'))).toEqual([{ kind: 'added', startLine: 3, endLine: 3 }]);
        expect(changeMarksOf(base, lines('one', 'TWO', 'three', 'four', 'five'))).toEqual([{ kind: 'modified', startLine: 2, endLine: 2 }]);
        expect(changeMarksOf(base, lines('one', 'two', 'four', 'five'))).toEqual([{ kind: 'deleted', startLine: 3, endLine: 3 }]);
    });

    test('splits a replacement that grows into changed lines and added ones', () => {
        expect(changeMarksOf(lines('a', 'b', 'c'), lines('a', 'X', 'Y', 'Z', 'c'))).toEqual([
            { kind: 'modified', startLine: 2, endLine: 2 },
            { kind: 'added', startLine: 3, endLine: 4 }
        ]);
    });

    test('marks everything of a file the base does not have and a removal at the end', () => {
        expect(changeMarksOf('', lines('a', 'b'))).toEqual([{ kind: 'added', startLine: 1, endLine: 2 }]);
        expect(changeMarksOf(lines('a', 'b'), lines('a'))).toEqual([{ kind: 'deleted', startLine: 2, endLine: 2 }]);
    });
});
