import { describe, expect, test } from 'bun:test';
import { NODE_SIZE } from '@ruimte/contracts';
import { readNodeSide, storedNodeSize } from '@/settings/node-size-fields';

describe('a side of a default size as typed', () => {
    test('reads a whole number within the bounds, spaces around it allowed', () => {
        expect(readNodeSide('640', 'w')).toEqual({ ok: true, value: 640 });
        expect(readNodeSide(' 400 ', 'h')).toEqual({ ok: true, value: 400 });
        expect(readNodeSide('240', 'w')).toEqual({ ok: true, value: 240 });
        expect(readNodeSide('4000', 'h')).toEqual({ ok: true, value: 4000 });
    });

    test('refuses what is not a whole number', () => {
        for (const text of ['', 'abc', '640.5', '-300', '1e3', '6 40']) {
            expect(readNodeSide(text, 'w')).toEqual({ ok: false, problem: 'notWhole' });
        }
    });

    test('refuses a side below the smallest frame, which differs per side', () => {
        expect(readNodeSide('239', 'w')).toEqual({ ok: false, problem: 'tooSmall' });
        expect(readNodeSide('200', 'h')).toEqual({ ok: true, value: 200 });
        expect(readNodeSide('159', 'h')).toEqual({ ok: false, problem: 'tooSmall' });
    });

    test('refuses a side above the largest default', () => {
        expect(readNodeSide('4001', 'w')).toEqual({ ok: false, problem: 'tooLarge' });
    });
});

describe('the size a kind stores', () => {
    test('is null for the built-in size, and the size itself otherwise', () => {
        expect(storedNodeSize('terminal', { ...NODE_SIZE.terminal })).toBeNull();
        expect(storedNodeSize('terminal', { w: NODE_SIZE.terminal.w, h: 400 })).toEqual({ w: NODE_SIZE.terminal.w, h: 400 });
    });
});
