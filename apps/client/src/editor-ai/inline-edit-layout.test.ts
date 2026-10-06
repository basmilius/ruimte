import { describe, expect, test } from 'bun:test';
import { MAX_PROBLEM_CHIPS, PROBLEM_CHIP_CHARS, problemChips, problemDetail, problemLabel } from './inline-edit-layout';
import type { InlineProblem } from '@adecore/editor-react/models';

function problem(line: number, severity: InlineProblem['severity'], message = `message ${line}`, code = ''): InlineProblem {
    return { line, severity, message, code };
}

describe('problemChips', () => {
    test('shows every problem while they fit', () => {
        const problems = [problem(3, 'error'), problem(5, 'warning')];

        expect(problemChips(problems)).toEqual({ shown: problems, hidden: [] });
    });

    test('puts the worst problems in the chips and counts the rest, whatever order the servers answered in', () => {
        const hint = problem(1, 'hint');
        const warning = problem(2, 'warning');
        const lateError = problem(9, 'error');
        const earlyError = problem(4, 'error');
        const info = problem(3, 'info');

        const { shown, hidden } = problemChips([hint, warning, lateError, info, earlyError]);

        expect(shown).toEqual([earlyError, lateError, warning]);
        expect(hidden).toEqual([info, hint]);
        expect(shown).toHaveLength(MAX_PROBLEM_CHIPS);
    });

    test('takes a different limit', () => {
        expect(problemChips([problem(1, 'error'), problem(2, 'error')], 1).hidden).toHaveLength(1);
    });
});

describe('problemLabel', () => {
    test('is the line and the message', () => {
        expect(problemLabel(problem(18, 'error', "Undefined property '$name'"))).toBe("18: Undefined property '$name'");
    });

    test('keeps the first line of a message that runs over several', () => {
        expect(problemLabel(problem(2, 'error', 'Type A is not assignable\n  to type B'))).toBe('2: Type A is not assignable');
    });

    test('ends a long message in an ellipsis at the limit, which the tooltip then spells out', () => {
        const long = problem(7, 'warning', 'x'.repeat(200));

        const label = problemLabel(long);

        expect(label).toHaveLength(PROBLEM_CHIP_CHARS);
        expect(label.endsWith('…')).toBe(true);
        expect(problemDetail(long)).toBe('x'.repeat(200));
    });

    test('leaves a message that fits exactly as it is', () => {
        const exact = problem(1, 'error', 'y'.repeat(PROBLEM_CHIP_CHARS - 3));

        expect(problemLabel(exact)).toBe(`1: ${'y'.repeat(PROBLEM_CHIP_CHARS - 3)}`);
    });
});

describe('problemDetail', () => {
    test('adds the code the server gave', () => {
        expect(problemDetail(problem(3, 'error', 'on the lines', 'ts(2345)'))).toBe('on the lines (ts(2345))');
    });
});
