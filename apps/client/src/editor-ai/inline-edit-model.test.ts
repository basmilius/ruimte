import { describe, expect, test } from 'bun:test';
import { inlineMessage } from './inline-message';
import {
    diffSegments,
    emphasisOf,
    endOfInsertion,
    fitReplacement,
    inlineRangeOf,
    lineSpanOf,
    locateSelection,
    parseAnswer,
    problemsOnLines,
    replaceRange,
    textInRange
} from '@adecore/editor-react/models';

const at = (line: number, character: number) => ({ line, character });

describe('the answer of an inline edit', () => {
    test('is the replacement block and what was said around it', () => {
        const answer = parseAnswer('Here you go.\n\n```replacement\nconst a = 1;\nconst b = 2;\n```\n\nI renamed both.');

        expect(answer.replacement).toBe('const a = 1;\nconst b = 2;');
        expect(answer.rest).toBe('Here you go.\n\nI renamed both.');
    });

    test('is plain text without a block, and a fence of another label is not the proposal', () => {
        expect(parseAnswer('Nothing to change here.')).toEqual({ replacement: null, rest: 'Nothing to change here.' });
        expect(parseAnswer('Try this:\n```ts\nconst a = 1;\n```').replacement).toBeNull();
    });

    test('takes the last block when there are several, and leaves the other fences in the text', () => {
        const answer = parseAnswer('```ts\nold();\n```\n```replacement\nfirst();\n```\nOops.\n```replacement\nsecond();\n```');

        expect(answer.replacement).toBe('second();');
        expect(answer.rest).toContain('old();');
        expect(answer.rest).toContain('first();');
    });

    test('keeps a fence inside the code when the block is fenced with more marks', () => {
        const answer = parseAnswer('````replacement\nconst doc = `\n```js\nx\n```\n`;\n````\nDone.');

        expect(answer.replacement).toBe('const doc = `\n```js\nx\n```\n`;');
        expect(answer.rest).toBe('Done.');
    });

    test('knows a label among other words, in any case, and an empty block', () => {
        expect(parseAnswer('```ts replacement\nx\n```').replacement).toBe('x');
        expect(parseAnswer('```Replacement\n```').replacement).toBe('');
    });

    test('is not a block when it never closes, since the turn was cut off', () => {
        expect(parseAnswer('```replacement\nconst a = 1;\nconst b').replacement).toBeNull();
    });

    test('takes the indentation of the fence off its lines', () => {
        expect(parseAnswer('  ```replacement\n  a\n    b\n  ```').replacement).toBe('a\n  b');
    });

    test('is not opened by a line of inline code that starts with backticks', () => {
        expect(parseAnswer('```x``` is a name\n```replacement\nz\n```').replacement).toBe('z');
    });
});

describe('the proposal in the shape of the selection', () => {
    test('ends on a break when the selection did, and not when it did not', () => {
        expect(fitReplacement('a\nb\n', 'c')).toBe('c\n');
        expect(fitReplacement('a\nb', 'c\n')).toBe('c');
        expect(fitReplacement('a\nb\n', '')).toBe('');
    });

    test('keeps the line breaks of the file', () => {
        expect(fitReplacement('a\r\nb', 'c\nd')).toBe('c\r\nd');
    });

    test('says where the caret stands after the text', () => {
        expect(endOfInsertion(at(3, 4), 'ab')).toEqual(at(3, 6));
        expect(endOfInsertion(at(3, 4), 'ab\ncde')).toEqual(at(4, 3));
    });
});

describe('the message of a run', () => {
    test('names the file, fences the lines with a fence the code cannot close and lists the problems', () => {
        const message = inlineMessage({
            instruction: '  Make the threshold a parameter  ',
            path: 'src/score.ts',
            language: 'typescript',
            span: { startLine: 24, endLine: 30 },
            text: 'const a = `\n```\n`;\n',
            problems: [{ line: 28, severity: 'error', message: 'Type is wrong', code: 'ts 2345' }]
        });

        expect(message).toBe(
            [
                'Make the threshold a parameter',
                'File: @src/score.ts\nSelected lines src/score.ts:24-30:\n````typescript\nconst a = `\n```\n`;\n````',
                'Problems the language servers report on these lines:\n- line 28: error: Type is wrong (ts 2345)'
            ].join('\n\n')
        );
    });

    test('has no problem section without problems and no label for plain text', () => {
        const message = inlineMessage({ instruction: 'x', path: 'a.txt', language: null, span: { startLine: 1, endLine: 1 }, text: 'hi', problems: [] });

        expect(message).toBe('x\n\nFile: @a.txt\nSelected lines a.txt:1:\n```\nhi\n```');
    });
});

describe('the lines of a selection', () => {
    test('a selection that ends at the start of a line leaves that line out', () => {
        expect(lineSpanOf({ start: at(0, 0), end: at(2, 0) })).toEqual({ startLine: 1, endLine: 2 });
        expect(lineSpanOf({ start: at(4, 2), end: at(6, 5) })).toEqual({ startLine: 5, endLine: 7 });
    });

    test('is the line under the caret while nothing is selected', () => {
        expect(inlineRangeOf({ start: at(2, 3), end: at(2, 3) }, () => 9)).toEqual({ start: at(2, 0), end: at(2, 9) });
        expect(inlineRangeOf({ start: at(0, 1), end: at(1, 2) }, () => 9)).toEqual({ start: at(0, 1), end: at(1, 2) });
    });

    test('lists the problems that touch the lines, in order, from the line they reach into them', () => {
        const diagnostics = [
            { range: { start: at(30, 0), end: at(30, 3) }, name: 'after' },
            { range: { start: at(26, 2), end: at(26, 6) }, name: 'inside' },
            { range: { start: at(20, 0), end: at(24, 4) }, name: 'across the start' },
            { range: { start: at(2, 0), end: at(2, 1) }, name: 'before' }
        ];

        const listed = problemsOnLines(diagnostics, { startLine: 24, endLine: 30 }, (diagnostic) => ({
            severity: 'error',
            message: diagnostic.name,
            code: ''
        }));

        expect(listed.map((problem) => [problem.line, problem.message])).toEqual([
            [24, 'across the start'],
            [27, 'inside']
        ]);
    });
});

describe('the diff of a proposal', () => {
    const selected = 'function a(x) {\n  if (x) return 1;\n  return 2;\n}';

    test('numbers the proposal from the first selected line and marks the changed lines as added', () => {
        const segments = diffSegments(selected, 'function a(x, y = 2) {\n  if (x) return 1;\n  return y;\n}', 24);

        expect(segments).toEqual([
            { kind: 'added', text: 'function a(x, y = 2) {', firstLine: 24, replaces: 'function a(x) {' },
            { kind: 'same', text: '  if (x) return 1;', firstLine: 25 },
            { kind: 'added', text: '  return y;', firstLine: 26, replaces: '  return 2;' },
            { kind: 'same', text: '}', firstLine: 27 }
        ]);
    });

    test('shows the lines a proposal drops without a replacement, and no number for them', () => {
        expect(diffSegments(selected, 'function a(x) {\n  return 2;\n}', 10)).toEqual([
            { kind: 'same', text: 'function a(x) {', firstLine: 10 },
            { kind: 'removed', text: '  if (x) return 1;' },
            { kind: 'same', text: '  return 2;\n}', firstLine: 11 }
        ]);
    });

    test('reads a trailing line break as the end of the last line, not an empty line', () => {
        expect(diffSegments('a\nb\n', 'a\nb\nc\n', 1)).toEqual([
            { kind: 'same', text: 'a\nb', firstLine: 1 },
            { kind: 'added', text: 'c', firstLine: 3 }
        ]);
    });

    test('is one same segment when nothing changed', () => {
        expect(diffSegments('a\nb', 'a\nb', 5)).toEqual([{ kind: 'same', text: 'a\nb', firstLine: 5 }]);
    });
});

describe('finding the selection in a text', () => {
    const text = 'one\ntwo\nthree\nfour';

    test('reads a range and replaces it', () => {
        const range = { start: at(1, 1), end: at(2, 2) };

        expect(textInRange(text, range)).toBe('wo\nth');
        expect(replaceRange(text, range, 'X')).toBe('one\ntXree\nfour');
        expect(textInRange(text, { start: at(1, 1), end: at(9, 0) })).toBeNull();
    });

    test('keeps its own range while the text there is the selection, and finds it by its text when lines moved', () => {
        const range = { start: at(1, 0), end: at(2, 5) };

        expect(locateSelection(text, range, 'two\nthree')).toEqual(range);
        expect(locateSelection(`new\n${text}`, range, 'two\nthree')).toEqual({ start: at(2, 0), end: at(3, 5) });
    });

    test('gives up when the text is gone or stands in two places', () => {
        expect(locateSelection('one\nthree', { start: at(1, 0), end: at(1, 3) }, 'two')).toBeNull();
        expect(locateSelection('ab\nab', { start: at(0, 0), end: at(0, 0) }, 'ab')).toBeNull();
    });
});

describe('the words of a proposal that differ', () => {
    test('are the ranges of an added line that its old line did not have', () => {
        const [segment] = diffSegments('function a(x) {', 'function a(x, y = 2) {', 1);

        expect(emphasisOf(segment!)).toEqual([[[12, 19]]]);
    });

    test('are left out for lines that stand where nothing stood, for lines that stayed, and for a change with no pairing of lines', () => {
        const [added] = diffSegments('a', 'a\nb', 1).filter((segment) => segment.kind === 'added');
        expect(emphasisOf(added!)).toBeUndefined();
        const [same] = diffSegments('a', 'a', 1);
        expect(emphasisOf(same!)).toBeUndefined();
        const [many] = diffSegments('one', 'two\nthree', 1);
        expect(emphasisOf(many!)).toBeUndefined();
    });
});
