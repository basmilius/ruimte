import { describe, expect, test } from 'bun:test';
import { framePressHandsKeyboard } from './frame-press';

describe('a press on a node frame', () => {
    test('hands the keyboard to the content it holds', () => {
        expect(framePressHandsKeyboard('terminal', false)).toBe(true);
        expect(framePressHandsKeyboard('device', false)).toBe(true);
        expect(framePressHandsKeyboard('unknown', false)).toBe(true);
    });

    test('leaves it on the canvas for a group and for a press that adds to the selection', () => {
        expect(framePressHandsKeyboard('group', false)).toBe(false);
        expect(framePressHandsKeyboard('terminal', true)).toBe(false);
        expect(framePressHandsKeyboard(undefined, false)).toBe(false);
    });
});
