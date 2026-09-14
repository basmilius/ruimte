import { describe, expect, test } from 'bun:test';
import { formatShortcut, matchesShortcut, shortcut, shortcutParts, type KeyLike } from './shortcut';

const event = (patch: Partial<KeyLike>): KeyLike => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...patch });

describe('shortcut', () => {
    test('reads every modifier word', () => {
        expect(shortcut('Mod+Ctrl+Meta+Alt+Shift+K')).toEqual({ mod: true, ctrl: true, meta: true, alt: true, shift: true, key: 'K' });
        expect(shortcut('k')).toEqual({ mod: false, ctrl: false, meta: false, alt: false, shift: false, key: 'K' });
    });

    test('reads punctuation, the plus key and named keys', () => {
        expect(shortcut('Mod+,').key).toBe(',');
        expect(shortcut('Mod+\\').key).toBe('\\');
        expect(shortcut('Mod+Shift+[').key).toBe('[');
        expect(shortcut('Mod++').key).toBe('+');
        expect(shortcut('+').key).toBe('+');
        expect(shortcut('-').key).toBe('-');
        expect(shortcut('Ctrl+Shift+Escape').key).toBe('Escape');
        expect(shortcut('Mod+Alt+ArrowLeft').key).toBe('ArrowLeft');
        expect(shortcut('F2').key).toBe('F2');
    });

    test('modifiers alone are a shortcut for a pointer gesture', () => {
        expect(shortcut('Mod')).toEqual({ mod: true, ctrl: false, meta: false, alt: false, shift: false, key: '' });
    });

    test('throws on a word it does not know and on two keys', () => {
        expect(() => shortcut('Cmd+K')).toThrow();
        expect(() => shortcut('Mod+Return')).toThrow();
        expect(() => shortcut('Mod+K+L')).toThrow();
    });
});

describe('matchesShortcut', () => {
    const palette = shortcut('Mod+K');

    test('Mod is Cmd on macOS and Ctrl elsewhere, never the other one', () => {
        expect(matchesShortcut(palette, event({ metaKey: true, key: 'k', code: 'KeyK' }), true)).toBe(true);
        expect(matchesShortcut(palette, event({ ctrlKey: true, key: 'k', code: 'KeyK' }), false)).toBe(true);
        expect(matchesShortcut(palette, event({ ctrlKey: true, key: 'k', code: 'KeyK' }), true)).toBe(false);
        expect(matchesShortcut(palette, event({ metaKey: true, key: 'k', code: 'KeyK' }), false)).toBe(false);
    });

    test('an extra modifier is another shortcut', () => {
        expect(matchesShortcut(palette, event({ metaKey: true, shiftKey: true, key: 'K', code: 'KeyK' }), true)).toBe(false);
        expect(matchesShortcut(palette, event({ metaKey: true, ctrlKey: true, key: 'k', code: 'KeyK' }), true)).toBe(false);
    });

    test('letters match on the physical key, whatever Shift or Option made of the character', () => {
        expect(matchesShortcut(shortcut('Mod+Shift+F'), event({ metaKey: true, shiftKey: true, key: 'F', code: 'KeyF' }), true)).toBe(true);
        expect(matchesShortcut(shortcut('Alt+B'), event({ altKey: true, key: 'Dead', code: 'KeyB' }), true)).toBe(true);
    });

    test('digits match on the physical key, so Shift+1 still is while the character is !', () => {
        expect(matchesShortcut(shortcut('Mod+1'), event({ ctrlKey: true, key: '1', code: 'Digit1' }), false)).toBe(true);
        expect(matchesShortcut(shortcut('Shift+1'), event({ shiftKey: true, key: '!', code: 'Digit1' }), true)).toBe(true);
    });

    test('punctuation matches on the physical key and named keys on the key', () => {
        expect(matchesShortcut(shortcut('Mod+Shift+]'), event({ metaKey: true, shiftKey: true, key: '}', code: 'BracketRight' }), true)).toBe(true);
        expect(matchesShortcut(shortcut('Mod+Enter'), event({ ctrlKey: true, key: 'Enter', code: 'NumpadEnter' }), false)).toBe(true);
    });

    test('modifiers alone never match a key', () => {
        expect(matchesShortcut(shortcut('Mod'), event({ metaKey: true, key: 'Meta', code: 'MetaLeft' }), true)).toBe(false);
    });
});

describe('formatShortcut', () => {
    test('macOS prints the symbols in its own order, elsewhere the words joined with a plus', () => {
        expect(formatShortcut(shortcut('Mod+Alt+Shift+K'), true)).toBe('⌥⇧⌘K');
        expect(formatShortcut(shortcut('Mod+Alt+Shift+K'), false)).toBe('Ctrl+Alt+Shift+K');
        expect(formatShortcut(shortcut('Ctrl+Shift+Escape'), true)).toBe('⌃⇧Esc');
        expect(formatShortcut(shortcut('Ctrl+Shift+Escape'), false)).toBe('Ctrl+Shift+Esc');
        expect(shortcutParts(shortcut('Mod+Alt+Shift+K'), true)).toEqual(['⌥', '⇧', '⌘', 'K']);
        expect(shortcutParts(shortcut('Mod'), false)).toEqual(['Ctrl']);
    });

    test('every named key on both platforms', () => {
        const names: Array<[string, string, string]> = [
            ['Enter', '↩', 'Enter'],
            ['Backspace', '⌫', 'Backspace'],
            ['Delete', '⌦', 'Delete'],
            ['Escape', 'Esc', 'Esc'],
            ['Tab', '⇥', 'Tab'],
            ['Space', 'Space', 'Space'],
            ['ArrowLeft', '←', '←'],
            ['ArrowRight', '→', '→'],
            ['ArrowUp', '↑', '↑'],
            ['ArrowDown', '↓', '↓']
        ];
        for (const [name, apple, other] of names) {
            expect(formatShortcut(shortcut(name), true)).toBe(apple);
            expect(formatShortcut(shortcut(name), false)).toBe(other);
        }
    });
});
