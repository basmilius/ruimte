import { describe, expect, test } from 'bun:test';
import type { Diagnostic } from '@adecore/lsp';
import { codeLabelOf, markerOf, neighborProblem, problemsAt, shiftPosition, shiftRange, type Problem } from './diagnostics-model';

const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });
const problem = (diagnostic: Diagnostic): Problem => ({ diagnostic, server: 'typescript' });

describe('markerOf', () => {
    test('carries the message for the tick in the scroll track, cut when it is long', () => {
        expect(markerOf({ range: range(0, 0, 1), message: 'Cannot find name' }).message).toBe('Cannot find name');
        expect(markerOf({ range: range(0, 0, 1), message: 'x'.repeat(500) }).message).toBe(`${'x'.repeat(300)}…`);
    });

    test('reads the severity, and a missing one as an error', () => {
        expect(markerOf({ range: range(0, 0, 1), message: 'x' }).severity).toBe('error');
        expect(markerOf({ range: range(0, 0, 1), message: 'x', severity: 2 }).severity).toBe('warning');
        expect(markerOf({ range: range(0, 0, 1), message: 'x', severity: 4, tags: [1, 2] })).toMatchObject({
            severity: 'hint',
            unnecessary: true,
            deprecated: true
        });
    });
});

describe('shiftPosition', () => {
    const insert = (line: number, character: number, text: string) => ({ range: range(line, character, character), text });

    test('leaves what is before a change alone and moves what is after it on the same line', () => {
        expect(shiftPosition(at(0, 2), insert(0, 5, 'abc'))).toEqual(at(0, 2));
        expect(shiftPosition(at(0, 8), insert(0, 5, 'abc'))).toEqual(at(0, 11));
    });

    test('moves a line break through the lines below and the rest of the line it split', () => {
        expect(shiftPosition(at(0, 8), insert(0, 5, 'a\nbc'))).toEqual(at(1, 5));
        expect(shiftPosition(at(3, 4), insert(0, 5, 'a\nbc'))).toEqual(at(4, 4));
    });

    test('puts a position inside a replaced range after the new text', () => {
        expect(shiftPosition(at(0, 6), { range: range(0, 4, 9), text: 'xy' })).toEqual(at(0, 6));
        expect(shiftPosition(at(0, 5), { range: range(0, 4, 9), text: 'x' })).toEqual(at(0, 5));
    });

    test('moves a range through changes in order', () => {
        expect(shiftRange(range(2, 4, 8), [{ range: { start: at(0, 0), end: at(1, 0) }, text: '' }])).toEqual(range(1, 4, 8));
    });
});

describe('problemsAt', () => {
    test('finds the problems on a character, worst first, and leaves hints out', () => {
        const warning = problem({ range: range(0, 4, 9), message: 'w', severity: 2 });
        const error = problem({ range: range(0, 6, 8), message: 'e', severity: 1 });
        const hint = problem({ range: range(0, 4, 9), message: 'h', severity: 4 });
        expect(problemsAt([warning, error, hint], at(0, 7)).map((entry) => entry.diagnostic.message)).toEqual(['e', 'w']);
        expect(problemsAt([warning, error, hint], at(0, 3))).toEqual([]);
    });
});

describe('neighborProblem', () => {
    const list = [problem({ range: range(5, 0, 3), message: 'b' }), problem({ range: range(1, 0, 3), message: 'a' })];

    test('steps forward and wraps past the last one', () => {
        expect(neighborProblem(list, at(0, 0), 1)?.diagnostic.message).toBe('a');
        expect(neighborProblem(list, at(1, 0), 1)?.diagnostic.message).toBe('b');
        expect(neighborProblem(list, at(5, 0), 1)?.diagnostic.message).toBe('a');
    });

    test('steps back and wraps before the first one', () => {
        expect(neighborProblem(list, at(5, 1), -1)?.diagnostic.message).toBe('b');
        expect(neighborProblem(list, at(1, 0), -1)?.diagnostic.message).toBe('b');
        expect(neighborProblem([], at(0, 0), 1)).toBeNull();
    });
});

describe('codeLabelOf', () => {
    test('joins the source and the code as a server writes them in its own panel', () => {
        expect(codeLabelOf({ range: range(0, 0, 1), message: 'x', source: 'ts', code: 2551 })).toBe('ts(2551)');
        expect(codeLabelOf({ range: range(0, 0, 1), message: 'x', code: 'no-undef' })).toBe('no-undef');
        expect(codeLabelOf({ range: range(0, 0, 1), message: 'x', source: 'eslint' })).toBe('eslint');
    });
});
