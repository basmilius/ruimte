import { describe, expect, test } from 'bun:test';
import { clipText } from './text.ts';

describe('clipText', () => {
    test('leaves a text that fits as it is', () => {
        expect(clipText('hello', 5)).toBe('hello');
        expect(clipText('', 0)).toBe('');
    });

    test('cuts in UTF-16 units, never between the halves of a surrogate pair', () => {
        expect(clipText('abcdef', 3)).toBe('abc');
        // The emoji takes units 2 and 3; a cut at 3 would keep only its first half.
        expect(clipText('ab😀cd', 3)).toBe('ab');
        expect(clipText('ab😀cd', 4)).toBe('ab😀');
    });

    test('keeps a character a person sees as one whole: a joined emoji, a flag and an accent', () => {
        const family = '👩‍👩‍👧';
        expect(clipText(`a${family}b`, 4)).toBe('a');
        expect(clipText('a🇳🇱b', 3)).toBe('a');
        expect(clipText('aéb', 2)).toBe('a');
        expect(clipText('aéb', 3)).toBe('aé');
    });
});
