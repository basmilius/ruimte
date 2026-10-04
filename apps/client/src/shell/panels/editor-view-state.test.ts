import { describe, expect, test } from 'bun:test';
import { openingPlace } from './editor-view-state';

describe('where a file editor opens', () => {
    const last = { scrollTop: 840, line: 52, column: 7 };

    test('where it was last, with its caret', () => {
        expect(openingPlace(null, last, 0)).toEqual({ line: 52, column: 7, scrollTop: 840 });
    });

    test('on a line asked for, over where it was', () => {
        expect(openingPlace({ line: 10, nonce: 1 } as never, last, 0)).toEqual({ line: 10 });
    });

    test('where the viewer was the first time', () => {
        expect(openingPlace(null, undefined, 120)).toEqual({ scrollTop: 120 });
    });
});
