import { describe, expect, test } from 'bun:test';
import { blankLineEdits, collapseBlankLines } from './blank-lines';

describe('blank lines on save', () => {
    const text = 'a() {\n    \n\tb();\r\n  \r\n\n}';

    test('empties every line of only spaces and tabs, with either line ending', () => {
        expect(collapseBlankLines(text)).toBe('a() {\n\n\tb();\r\n\r\n\n}');
    });

    test('leaves the line the caret is on', () => {
        expect(blankLineEdits(text, 1)).toEqual([{ range: { start: { line: 3, character: 0 }, end: { line: 3, character: 2 } }, text: '' }]);
        expect(blankLineEdits(text, null)).toHaveLength(2);
    });
});
