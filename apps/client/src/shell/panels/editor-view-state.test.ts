import { describe, expect, test } from 'bun:test';
import { openingPlace } from './editor-view-state';

describe('where a file editor opens', () => {
    const last = { scrollTop: 840, line: 52, column: 7, folds: { collapsed: [{ startLine: 3, endLine: 9 }], custom: [] } };

    test('where it was last, with its caret', () => {
        expect(openingPlace(null, last, 0)).toEqual({ line: 52, column: 7, scrollTop: 840, folds: last.folds });
    });

    test('on a line asked for, over where it was', () => {
        expect(openingPlace({ line: 10, nonce: 1 } as never, last, 0)).toEqual({ line: 10, folds: last.folds });
    });

    test('where the viewer was the first time, with the import list folded', () => {
        expect(openingPlace(null, undefined, 120)).toEqual({ scrollTop: 120, foldDefaults: ['imports'] });
        expect(openingPlace({ line: 4, nonce: 1 } as never, undefined, 0)).toEqual({ line: 4, foldDefaults: ['imports'] });
    });
});
