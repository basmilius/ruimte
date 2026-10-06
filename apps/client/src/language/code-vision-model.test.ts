import { describe, expect, test } from 'bun:test';
import type { DocumentSymbol } from '@adecore/lsp';
import { declarationsOf, startAfterComments, usagesText, type DeclarationSource } from './code-vision-model';

const at = (line: number, character = 0) => ({ line, character });

function sourceOf(text: string, languageId = 'typescript'): DeclarationSource {
    const lines = text.split('\n');
    return { lineCount: lines.length, lineAt: (line) => lines[line] ?? '', languageId };
}

function symbol(
    name: string,
    kind: DocumentSymbol['kind'],
    from: number,
    to: number,
    children: DocumentSymbol[] = [],
    character = 0,
    start = 0
): DocumentSymbol {
    return {
        name,
        kind,
        range: { start: at(from, start), end: at(to, 1) },
        selectionRange: { start: at(from, character), end: at(from, character + name.length) },
        children
    };
}

const TEXT = [
    '/**', // 0
    ' * A matcher.', // 1
    ' */', // 2
    'export class Matcher {', // 3
    '    private weights = [];', // 4
    '', // 5
    '    // Scores one name.', // 6
    '    score(name: string) {', // 7
    '        const local = () => 1;', // 8
    '        return local();', // 9
    '    }', // 10
    '', // 11
    '    constructor() {}', // 12
    '}', // 13
    '', // 14
    'export interface Options {', // 15
    '    strict: boolean;', // 16
    '}', // 17
    '', // 18
    'function rank() { return 1; } function second() {}' // 19
].join('\n');

const SYMBOLS = [
    symbol('Matcher', 5, 0, 13, [
        symbol('weights', 8, 4, 4, [], 12),
        symbol('score', 6, 6, 10, [symbol('local', 12, 8, 8, [], 14)], 4),
        symbol('constructor', 9, 12, 12, [], 4)
    ]),
    symbol('Options', 11, 15, 17, [symbol('strict', 7, 16, 16, [], 4)]),
    symbol('rank', 12, 19, 19, [], 9),
    symbol('second', 12, 19, 19, [], 39, 30)
];

describe('declarations', () => {
    const declarations = declarationsOf(SYMBOLS, sourceOf(TEXT));

    test('are the types, functions and methods, and the properties of a class, outside the body of a function', () => {
        expect(declarations.map((declaration) => [declaration.name, declaration.usages, declaration.authors])).toEqual([
            ['Matcher', true, true],
            ['weights', true, false],
            ['score', true, true],
            ['constructor', false, true],
            ['Options', true, true],
            ['rank', true, true]
        ]);
    });

    test('sit above the line the declaration starts on, past its docblock and the comments between members', () => {
        expect(Object.fromEntries(declarations.map((declaration) => [declaration.name, declaration.line]))).toMatchObject({
            Matcher: 3,
            weights: 4,
            score: 7,
            Options: 15,
            rank: 19
        });
    });

    test('leave out what does not start its line, since the row sits above the line', () => {
        expect(declarations.some((declaration) => declaration.name === 'second')).toBe(false);
    });

    test('ask for references at the name and read authors from the name to the last line of code', () => {
        const score = declarations.find((declaration) => declaration.name === 'score')!;
        expect(score.position).toEqual(at(6, 4));
        expect([score.authorFrom, score.authorTo]).toEqual([6, 9]);
        const matcher = declarations.find((declaration) => declaration.name === 'Matcher')!;
        expect([matcher.authorFrom, matcher.authorTo]).toEqual([0, 12]);
    });

    test('keep an id through an edit and tell two of the same name apart', () => {
        const twice = declarationsOf([symbol('overload', 12, 0, 0), symbol('overload', 12, 1, 1)], sourceOf('function overload() {}\nfunction overload() {}'));
        expect(new Set(twice.map((declaration) => declaration.id)).size).toBe(2);
        expect(declarationsOf([symbol('overload', 12, 2, 2)], sourceOf('\n\nfunction overload() {}'))[0]!.id).toBe(twice[0]!.id);
    });

    test('leave out anonymous and default symbols, and magic methods of usages', () => {
        const found = declarationsOf(
            [symbol('<function>', 12, 0, 0), symbol('default', 5, 1, 1), symbol('Box', 5, 2, 4, [symbol('__construct', 6, 3, 3, [], 4)])],
            sourceOf('x\ny\nclass Box {\n    __construct() {}\n}', 'php')
        );
        expect(found.map((declaration) => [declaration.name, declaration.usages])).toEqual([
            ['Box', true],
            ['__construct', false]
        ]);
    });

    test('read a flat answer by the names of its containers', () => {
        const flat = declarationsOf(
            [
                { name: 'Box', kind: 5, location: { uri: 'file:///a.php', range: { start: at(0), end: at(3, 1) } } },
                { name: 'open', kind: 6, containerName: 'Box', location: { uri: 'file:///a.php', range: { start: at(1), end: at(2, 5) } } },
                { name: 'stray', kind: 6, containerName: 'Missing', location: { uri: 'file:///a.php', range: { start: at(1), end: at(2, 5) } } }
            ],
            sourceOf('class Box {\n    function open() {\n    }\n}', 'php')
        );
        expect(found(flat)).toEqual(['Box', 'open']);
        expect(flat[1]!.position).toEqual(at(1, 13));
    });

    test('are none for a file with too many', () => {
        const many = Array.from({ length: 3001 }, (_, index) => symbol(`f${index}`, 12, index, index));
        expect(declarationsOf(many, sourceOf(many.map((one) => `function ${one.name}() {}`).join('\n')))).toEqual([]);
        expect(declarationsOf(null, sourceOf(''))).toEqual([]);
    });
});

function found(declarations: readonly { name: string }[]): string[] {
    return declarations.map((declaration) => declaration.name);
}

describe('where a declaration starts', () => {
    test('is past block, line and, in languages that have them, hash comments', () => {
        const text = ['/* one */ /* two */', '// three', '# four', '#[Route]', 'function f() {}'].join('\n');
        expect(startAfterComments(sourceOf(text, 'php'), at(0), at(4, 15))).toEqual(at(3, 0));
        expect(startAfterComments(sourceOf(text, 'typescript'), at(0), at(4, 15))).toEqual(at(2, 0));
    });

    test('is nowhere when the range is only comments', () => {
        expect(startAfterComments(sourceOf('/* a\nb */'), at(0), at(1, 4))).toBeNull();
        expect(startAfterComments(sourceOf('// a'), at(0), at(0, 4))).toBeNull();
    });
});

describe('the words', () => {
    test('say no usages, one usage and many', () => {
        expect(usagesText(0)).toBe('No usages');
        expect(usagesText(1)).toBe('1 usage');
        expect(usagesText(1234)).toContain('usages');
        expect(usagesText(7)).toBe('7 usages');
    });
});
