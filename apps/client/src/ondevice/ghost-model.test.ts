import { describe, expect, test } from 'bun:test';
import { cleanGhost, firstWord } from './ghost-model';

describe('cleanGhost', () => {
    test('drops the line before the cursor that the model wrote again, and the closing line the file has', () => {
        const before = 'export function bestMatch(vacancy: Vacancy): Candidate | null {\n    ';
        const after = '\n}\n';
        const output = 'export function bestMatch(vacancy: Vacancy): Candidate | null {\n    const ranked = rank(vacancy);\n    return ranked[0] ?? null;\n}';
        expect(cleanGhost(output, before, after)).toBe('const ranked = rank(vacancy);\n    return ranked[0] ?? null;');
    });

    test('drops a block the text after the caret closes, as many lines as it repeats in order', () => {
        const before = 'let total = 0;\nfor (const value of values) {\n        ';
        const after = '\n    }\n    return total;\n}\n';
        const output = '    for (const value of values) {\n        total += value;\n    }\n    return total;';
        expect(cleanGhost(output, before, after)).toBe('total += value;');
    });

    test('keeps a closing line that closes what the suggestion itself opened', () => {
        const output = 'if (ready) {\n    start();\n}';
        expect(cleanGhost(output, 'function run() {\n    ', '\n}')).toBe('if (ready) {\n    start();\n}');
    });

    test('goes on from what was typed on the cursor line', () => {
        const before = 'const names = users.map((user) => user.name);\nconsole.';
        expect(cleanGhost('const names = users.map((user) => user.name);\nconsole.log(names);', before, '')).toBe('log(names);');
    });

    test('leaves a short completion of a word alone', () => {
        expect(cleanGhost('onsole.log(x);', 'c', '')).toBe('onsole.log(x);');
        expect(cleanGhost('ontext', 'const c', '')).toBe('ontext');
    });

    test('takes the fence off, and stops at eight lines', () => {
        expect(cleanGhost('```ts\nreturn 1;\n```', 'function a() {\n    ', '\n}')).toBe('return 1;');
        const long = Array.from({ length: 12 }, (_, index) => `line${index};`).join('\n');
        expect(cleanGhost(long, '', '').split('\n')).toHaveLength(8);
    });

    test('says nothing when nothing is left', () => {
        expect(cleanGhost('   \n', '', '')).toBe('');
        expect(cleanGhost('}', 'function a() {\n    return 1;\n', '}\n')).toBe('');
    });
});

describe('firstWord', () => {
    test('takes the whitespace before a word with it, and a run of punctuation as one word', () => {
        expect(firstWord('  const x = 1;')).toBe('  const');
        expect(firstWord(' = 1;')).toBe(' =');
        expect(firstWord('\n    return a;')).toBe('\n    return');
        expect(firstWord('')).toBe('');
    });
});
