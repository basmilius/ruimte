import { describe, expect, test } from 'bun:test';
import { DocumentModel, scanBrackets } from '@ruimte/smart-editor-core';
import { describeHeader, headerLabel, Outline, scopeChain, stickyCover, stickyPlacements, structuralEntries } from './outline.ts';

function outlineOf(text: string, language = 'typescript'): Outline {
    const model = new DocumentModel(text);
    const outline = new Outline();
    const pairs = scanBrackets(text, language).pairs;
    outline.setStructure(
        structuralEntries(
            model.getFoldingRanges({ indentation: language === 'python' }),
            model,
            (from, to) => model.slice(from, to),
            (offset) => pairs.get(offset)
        )
    );
    return Object.assign(outline, { model });
}

const SOURCE = [
    'export class Matcher {',
    '    score(a: number,',
    '          b: number',
    '    ): number {',
    '        if (a > b) {',
    '            return a;',
    '        }',
    '        return b;',
    '    }',
    '}',
    'const rows = [',
    '    1,',
    '    2',
    '];'
].join('\n');

describe('describeHeader', () => {
    test('names what a line declares', () => {
        expect(describeHeader('export async function load(path) {')).toEqual({ name: 'load', kind: 'function' });
        expect(describeHeader('  export default class Foo extends Bar {')).toEqual({ name: 'Foo', kind: 'class' });
        expect(describeHeader('pub fn run() {')).toEqual({ name: 'run', kind: 'function' });
        expect(describeHeader('const handler = () => {')).toEqual({ name: 'handler', kind: 'variable' });
        expect(describeHeader('    private async fetch(url: string) {')).toEqual({ name: 'fetch', kind: 'method' });
        expect(describeHeader('  "scripts": {')).toEqual({ name: 'scripts', kind: 'property' });
    });

    test('leaves control flow and calls unnamed', () => {
        expect(describeHeader('if (a > b) {')).toEqual({});
        expect(describeHeader('} else if (x) {')).toEqual({});
        expect(describeHeader('items.map((item) => {')).toEqual({});
    });

    test('shortens a header to a label', () => {
        expect(headerLabel('  items.forEach((item) => {')).toBe('items.forEach((item) =>');
        expect(headerLabel(`x${'y'.repeat(100)}`).length).toBe(48);
    });
});

describe('structuralEntries', () => {
    test('headers the braces of a document and takes a signature from where its parameters open', () => {
        const outline = outlineOf(SOURCE);
        const model = (outline as unknown as { model: DocumentModel }).model;
        expect(outline.blocks(model).map((block) => [block.startLine, block.endLine, block.name ?? null])).toEqual([
            [0, 9, 'Matcher'],
            [1, 8, 'score'],
            [4, 6, null]
        ]);
    });

    test('has no block for an array and takes indented stretches as blocks in python', () => {
        const python = outlineOf('def a():\n    b = 1\n    if b:\n        c = 2\nz = 1', 'python');
        const model = (python as unknown as { model: DocumentModel }).model;
        expect(python.blocks(model).map((block) => [block.startLine, block.endLine, block.name ?? null])).toEqual([
            [0, 3, 'a'],
            [2, 3, null]
        ]);
    });

    test('keeps the ends on their lines through an edit', () => {
        const outline = outlineOf(SOURCE);
        const model = (outline as unknown as { model: DocumentModel }).model;
        model.subscribe((snapshot) => outline.edited(snapshot.changes ?? []));
        model.applyEdits([{ from: 0, to: 0, text: '// head\n' }]);
        expect(outline.blocks(model).map((block) => [block.startLine, block.endLine])).toEqual([
            [1, 10],
            [2, 9],
            [5, 7]
        ]);
    });
});

describe('provided blocks', () => {
    test('stand in for the structure until they are taken away', () => {
        const outline = outlineOf(SOURCE);
        const model = (outline as unknown as { model: DocumentModel }).model;
        outline.setProvided(
            [
                { startLine: 2, endLine: 9, name: 'score', kind: 'method' },
                { startLine: 5, endLine: 7 }
            ],
            model
        );
        expect(outline.blocks(model)).toEqual([
            { startLine: 1, endLine: 8, name: 'score', kind: 'method' },
            { startLine: 4, endLine: 6, name: 'if (a > b)' }
        ]);
        outline.setProvided(null, model);
        expect(outline.blocks(model).length).toBe(3);
    });
});

describe('stickyPlacements', () => {
    const blocks = [
        { startLine: 0, endLine: 9 },
        { startLine: 1, endLine: 8 },
        { startLine: 4, endLine: 6 }
    ];
    /* Every line a row of 20px, so the top of line n is 20n. */
    const rows = { top: (line: number) => line * 20, bottom: (line: number) => line * 20 + 20, startsRow: () => true };
    const summary = (scrollTop: number, max = 5) =>
        stickyPlacements(blocks, scrollTop, 20, max, rows).map((placement) => [placement.block.startLine, placement.depth, placement.offset]);

    test('pins a header from the moment its own row passes the place it is pinned at, not before and not a row later', () => {
        expect(summary(0)).toEqual([]);
        expect(summary(1)).toEqual([
            [0, 0, 0],
            [1, 1, 0]
        ]);
        expect(summary(40)).toEqual([
            [0, 0, 0],
            [1, 1, 0]
        ]);
        expect(summary(41)).toEqual([
            [0, 0, 0],
            [1, 1, 0],
            [4, 2, 0]
        ]);
    });

    test('pushes a header up and out as the end of its block comes, innermost first', () => {
        expect(summary(80)).toEqual([
            [0, 0, 0],
            [1, 1, 0],
            [4, 2, 0]
        ]);
        expect(summary(90)).toEqual([
            [0, 0, 0],
            [1, 1, 0],
            [4, 2, -10]
        ]);
        expect(summary(99)).toEqual([
            [0, 0, 0],
            [1, 1, 0],
            [4, 2, -19]
        ]);
        expect(summary(100)).toEqual([
            [0, 0, 0],
            [1, 1, 0]
        ]);
        expect(summary(150)).toEqual([
            [0, 0, 0],
            [1, 1, -10]
        ]);
        expect(summary(190)).toEqual([[0, 0, -10]]);
        expect(summary(200)).toEqual([]);
    });

    test('holds the limit', () => {
        expect(summary(81, 1).length).toBe(1);
        expect(summary(81, 0)).toEqual([]);
    });

    test('leaves out a block whose header a fold hides', () => {
        const folded = { ...rows, startsRow: (line: number) => line !== 1 };
        expect(stickyPlacements(blocks, 81, 20, 5, folded).map((placement) => placement.block.startLine)).toEqual([0, 4]);
    });
});

describe('stickyCover', () => {
    test('reaches down to the lowest edge of the pinned headers, pushes included', () => {
        const block = { startLine: 0, endLine: 1 };
        expect(stickyCover([], 20)).toBe(0);
        expect(
            stickyCover(
                [
                    { block, depth: 0, offset: 0 },
                    { block, depth: 1, offset: -5 }
                ],
                20
            )
        ).toBe(35);
    });
});

describe('scopeChain', () => {
    test('lists the named blocks that hold a line, header and last line included', () => {
        const blocks = [
            { startLine: 0, endLine: 9, name: 'Matcher' },
            { startLine: 1, endLine: 8, name: 'score' },
            { startLine: 4, endLine: 6 }
        ];
        expect(scopeChain(blocks, 5).map((block) => block.name)).toEqual(['Matcher', 'score']);
        expect(scopeChain(blocks, 9).map((block) => block.name)).toEqual(['Matcher']);
        expect(scopeChain(blocks, 10)).toEqual([]);
    });
});
