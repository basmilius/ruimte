import { describe, expect, test } from 'bun:test';
import { followViewStates, forgetMovesFrom, openingPlace, viewStateKey, viewStates } from './editor-view-state-host';

describe('where a file editor opens', () => {
    const last = { scrollTop: 840, line: 52, column: 7, folds: { collapsed: [{ startLine: 3, endLine: 9 }], custom: [] } };

    test('where it was last, with its caret', () => {
        expect(openingPlace(null, last, 0, ['imports'])).toEqual({ line: 52, column: 7, scrollTop: 840, folds: last.folds });
    });

    test('on a line asked for, over where it was', () => {
        expect(openingPlace({ line: 10, nonce: 1 } as never, last, 0, ['imports'])).toEqual({ line: 10, folds: last.folds });
    });

    test('where the viewer was the first time, with the folds the settings choose', () => {
        expect(openingPlace(null, undefined, 120, ['imports'])).toEqual({ scrollTop: 120, foldDefaults: ['imports'] });
        expect(openingPlace({ line: 4, nonce: 1 } as never, undefined, 0, ['file-header', 'imports'])).toEqual({
            line: 4,
            foldDefaults: ['file-header', 'imports']
        });
        expect(openingPlace(null, undefined, 0, [])).toEqual({ scrollTop: 0, foldDefaults: [] });
    });
});

describe('where an editor was after its file moved', () => {
    const place = { scrollTop: 10, line: 4, column: 2, folds: { collapsed: [], custom: [] } };

    test('the place of a file and of the files of a folder follow the move', () => {
        viewStates.clear();
        viewStates.set('m:/p/src/a.ts', place);
        viewStates.set('m:/p/src2/b.ts', place);
        followViewStates('m', '/p/src', '/p/lib');
        expect([...viewStates.keys()].sort()).toEqual(['m:/p/lib/a.ts', 'm:/p/src2/b.ts']);
    });

    test('an editor still open on the old path leaves its place under the new one, until an editor opens there again', () => {
        followViewStates('m', '/p/x.ts', '/p/y.ts');
        expect(viewStateKey('m:/p/x.ts')).toBe('m:/p/y.ts');
        expect(viewStateKey('m:/p/z.ts')).toBe('m:/p/z.ts');
        forgetMovesFrom('m:/p/x.ts');
        expect(viewStateKey('m:/p/x.ts')).toBe('m:/p/x.ts');
    });
});
