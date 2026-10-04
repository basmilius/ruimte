import { describe, expect, test } from 'bun:test';
import { occurrencesOf, renamePreviewOf, renameRowsOf, renameTargetOf, wordRangeAt } from './rename-model';

const at = (line: number, character: number) => ({ line, character });
const range = (line: number, start: number, end: number) => ({ start: at(line, start), end: at(line, end) });

describe('the word to rename', () => {
    test('is the identifier the caret is in or at the end of', () => {
        expect(wordRangeAt('const weights = 1;', at(0, 8))).toEqual(range(0, 6, 13));
        expect(wordRangeAt('const weights = 1;', at(0, 13))).toEqual(range(0, 6, 13));
        expect(wordRangeAt('const weights = 1;', at(0, 14))).toBeNull();
        expect(wordRangeAt('$value->name', at(0, 3))).toEqual(range(0, 0, 6));
    });

    test('follows what a server prepared, and falls back to the text when it leaves the name open', () => {
        const textOf = () => 'weights';
        expect(renameTargetOf(null, textOf, () => range(0, 0, 1))).toBeNull();
        expect(renameTargetOf({ range: range(0, 6, 13), placeholder: 'weights!' }, textOf, () => null)).toEqual({
            range: range(0, 6, 13),
            placeholder: 'weights!'
        });
        expect(renameTargetOf(range(0, 6, 13), textOf, () => null)).toEqual({ range: range(0, 6, 13), placeholder: 'weights' });
        expect(renameTargetOf({ defaultBehavior: true }, textOf, () => range(0, 6, 13))).toEqual({ range: range(0, 6, 13), placeholder: 'weights' });
        expect(renameTargetOf({ defaultBehavior: true }, textOf, () => null)).toBeNull();
    });
});

describe('occurrences', () => {
    test('counts every place and the files they are in, and keeps the ones in the open file', () => {
        const here = 'file:///a.ts';
        const result = occurrencesOf(
            [
                { uri: here, range: range(0, 0, 1) },
                { uri: here, range: range(3, 0, 1) },
                { uri: 'file:///b.ts', range: range(1, 0, 1) }
            ],
            here
        );
        expect(result).toEqual({ inFile: [range(0, 0, 1), range(3, 0, 1)], count: 3, files: 2 });
    });
});

describe('the rows of a rename preview', () => {
    const text = 'const weights = {};\nuse(weights, weights);\nreturn 1;\n';

    test('shows each changed line once, as it was and as it will be, in order', () => {
        const rows = renameRowsOf(text, [
            { range: range(1, 4, 11), newText: 'scores' },
            { range: range(1, 13, 20), newText: 'scores' },
            { range: range(0, 6, 13), newText: 'scores' }
        ]);
        expect(rows).toEqual([
            { line: 1, before: 'const weights = {};', after: 'const scores = {};' },
            { line: 2, before: 'use(weights, weights);', after: 'use(scores, scores);' }
        ]);
    });

    test('reads every file of an edit, an open one or not, and gives up on one that renames files', async () => {
        const edit = {
            changes: { 'file:///a.ts': [{ range: range(0, 6, 13), newText: 'scores' }], 'file:///b.ts': [{ range: range(0, 0, 1), newText: 'x' }] }
        };
        const files = await renamePreviewOf(edit, async (uri) => (uri === 'file:///a.ts' ? text : null));
        expect(files).toEqual([
            { uri: 'file:///a.ts', rows: [{ line: 1, before: 'const weights = {};', after: 'const scores = {};' }] },
            { uri: 'file:///b.ts', rows: [] }
        ]);
        expect(await renamePreviewOf({ documentChanges: [{ kind: 'delete', uri: 'file:///a.ts' }] }, async () => text)).toBeNull();
    });
});
