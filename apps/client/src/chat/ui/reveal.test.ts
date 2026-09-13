import { describe, expect, test } from 'bun:test';
import { nextRevealLength } from '@/chat/ui/reveal';

describe('nextRevealLength', () => {
    test('closes a sixth of the gap per frame', () => {
        const text = 'x'.repeat(120);
        expect(nextRevealLength(text, 0)).toBe(20);
        expect(nextRevealLength(text, 60)).toBe(70);
    });

    test('moves at least two characters while anything is left', () => {
        expect(nextRevealLength('abcdef', 3)).toBe(5);
        expect(nextRevealLength('abcdef', 5)).toBe(6);
    });

    test('never passes the end of the text', () => {
        expect(nextRevealLength('abc', 3)).toBe(3);
        expect(nextRevealLength('abc', 10)).toBe(3);
    });

    test('does not stop between the halves of a surrogate pair', () => {
        const text = 'ab\u{1F600}cdefgh';
        expect(nextRevealLength(text, 1)).toBe(4);
    });
});
