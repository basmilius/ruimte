import { describe, expect, test } from 'bun:test';
import { CLIPBOARD_TYPE, readDrawingElements } from './export';

describe('the clipboard', () => {
    test('elements of this app come back, anything else does not', () => {
        const elements = [{ kind: 'rect', id: 'el-1', x: 0, y: 0, w: 10, h: 10, stroke: 'ink', strokeWidth: 2, seed: 1 }];
        expect(readDrawingElements(JSON.stringify({ type: CLIPBOARD_TYPE, elements }))).toEqual(elements as never);
        expect(readDrawingElements(JSON.stringify({ type: 'text/plain', elements }))).toBeNull();
        expect(readDrawingElements('a line someone copied')).toBeNull();
    });
});
