import { describe, expect, test } from 'bun:test';
import { unscaledPointer } from '@/terminal/xterm';

describe('unscaledPointer', () => {
    test('maps a pointer on a zoomed-out element back to layout units', () => {
        const rect = { left: 100, top: 50, width: 400, height: 200 };
        expect(unscaledPointer({ clientX: 300, clientY: 150 }, rect, { width: 800, height: 400 })).toEqual({ clientX: 500, clientY: 250 });
    });

    test('leaves a pointer alone without a transform', () => {
        const rect = { left: 10, top: 20, width: 300, height: 100 };
        expect(unscaledPointer({ clientX: 42, clientY: 64 }, rect, { width: 300, height: 100 })).toEqual({ clientX: 42, clientY: 64 });
    });

    test('ignores an element without a layout size', () => {
        const rect = { left: 10, top: 20, width: 0, height: 0 };
        expect(unscaledPointer({ clientX: 42, clientY: 64 }, rect, { width: 0, height: 0 })).toEqual({ clientX: 42, clientY: 64 });
    });
});
