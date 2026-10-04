import { describe, expect, test } from 'bun:test';
import { DocumentModel, scanBrackets } from '@ruimte/smart-editor-core';
import { describeHeader, headerLabel, Outline, scopeChain, stickyChain, structuralEntries } from './outline.ts';

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

describe('stickyChain', () => {
    const blocks = [
        { startLine: 0, endLine: 9 },
        { startLine: 1, endLine: 8 },
        { startLine: 4, endLine: 6 }
    ];
    const lineAt = (y: number): number => Math.floor(y / 20);

    test('is empty until a header scrolls out of sight', () => {
        expect(stickyChain(blocks, 0, 20, 5, lineAt)).toEqual([]);
    });

    test('pins the blocks around the first line, outermost first, each under the one before', () => {
        expect(stickyChain(blocks, 20 * 5, 20, 5, lineAt).map((block) => block.startLine)).toEqual([0, 1]);
        expect(stickyChain(blocks, 20 * 4, 20, 5, lineAt).map((block) => block.startLine)).toEqual([0, 1, 4]);
        expect(stickyChain(blocks, 20, 20, 5, lineAt).map((block) => block.startLine)).toEqual([0, 1]);
    });

    test('lets a block go once its end is under the headers, and holds the limit', () => {
        expect(stickyChain(blocks, 20 * 9, 20, 5, lineAt).map((block) => block.startLine)).toEqual([0]);
        expect(stickyChain(blocks, 20 * 5, 20, 1, lineAt).length).toBe(1);
        expect(stickyChain(blocks, 20 * 5, 20, 0, lineAt)).toEqual([]);
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
