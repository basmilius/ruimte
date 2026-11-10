import { describe, expect, test } from 'bun:test';
import { shortcut } from '@adecore/ui';
import { extensionUsesKey, refusalOf, sameKey } from './shortcut-refusal';
import type { ShortcutGroup } from './shortcuts';

const GROUPS: ShortcutGroup[] = [
    {
        id: 'general',
        title: 'General',
        shortcuts: [
            { id: 'palette', keys: shortcut('Mod+K'), label: 'Command palette' },
            { id: 'sidebar', keys: shortcut('Mod+B'), label: 'Toggle sidebar' },
            { keys: shortcut('Mod+A'), label: 'Select all' },
            { keys: shortcut('Mod'), then: 'scroll', label: 'Zoom at pointer' },
            { keys: shortcut('Alt+ArrowLeft'), label: 'Back one word' }
        ]
    },
    {
        id: 'editor',
        title: 'Editor',
        shortcuts: [{ id: 'goToSymbol', keys: shortcut('Mod+F12'), label: 'Go to symbol' }]
    }
];

describe.each([true, false])('refusalOf, apple %p', (apple) => {
    const context = { apple, browserTab: false };

    test('accepts a free key with a modifier', () => {
        expect(refusalOf(shortcut('Mod+Alt+Y'), 'palette', GROUPS, context)).toBeNull();
        expect(refusalOf(shortcut('Ctrl+Y'), 'palette', GROUPS, context)).toBeNull();
        expect(refusalOf(shortcut('Alt+Y'), 'palette', GROUPS, context)).toBeNull();
    });

    test('refuses a key without Mod, Ctrl, Meta or Alt, Shift alone and a bare Tab included', () => {
        for (const text of ['K', 'F2', 'Shift+K', 'Tab', 'Shift+Tab', 'Enter']) {
            expect(refusalOf(shortcut(text), 'palette', GROUPS, context), text).toEqual({ reason: 'modifier' });
        }
    });

    test('names the row of a rebindable key that holds the key', () => {
        expect(refusalOf(shortcut('Mod+B'), 'palette', GROUPS, context)).toEqual({ reason: 'taken', label: 'Toggle sidebar' });
    });

    test('names the row of a fixed key and of a key of the editor', () => {
        expect(refusalOf(shortcut('Mod+A'), 'palette', GROUPS, context)).toEqual({ reason: 'taken', label: 'Select all' });
        expect(refusalOf(shortcut('Alt+ArrowLeft'), 'palette', GROUPS, context)).toEqual({ reason: 'taken', label: 'Back one word' });
        expect(refusalOf(shortcut('Mod+F12'), 'palette', GROUPS, context)).toEqual({ reason: 'taken', label: 'Go to symbol' });
    });

    test('holds a key against another modifier spelling of itself', () => {
        const spelled = apple ? shortcut('Meta+B') : shortcut('Ctrl+B');

        expect(refusalOf(spelled, 'palette', GROUPS, context)).toEqual({ reason: 'taken', label: 'Toggle sidebar' });
    });

    test('lets a row keep the key it has', () => {
        expect(refusalOf(shortcut('Mod+K'), 'palette', GROUPS, context)).toBeNull();
    });

    test('ignores a pointer gesture, which has no key to press', () => {
        expect(refusalOf(shortcut('Mod+Z'), 'palette', GROUPS, context)).toBeNull();
    });

    test('refuses what a browser tab keeps there, and only there', () => {
        expect(refusalOf(shortcut('Mod+W'), 'palette', GROUPS, { apple, browserTab: true })).toEqual({ reason: 'browser' });
        expect(refusalOf(shortcut('Mod+W'), 'palette', GROUPS, context)).toBeNull();
    });
});

describe('sameKey', () => {
    test('compares by the key the keyboard sends', () => {
        expect(sameKey(shortcut('Mod+K'), shortcut('Meta+K'), true)).toBe(true);
        expect(sameKey(shortcut('Mod+K'), shortcut('Meta+K'), false)).toBe(false);
        expect(sameKey(shortcut('Mod+K'), shortcut('Mod+Shift+K'), true)).toBe(false);
    });
});

describe('extensionUsesKey', () => {
    test('finds an extension that binds the same key', () => {
        expect(extensionUsesKey(['mod+shift+k'], shortcut('Mod+Shift+K'), true)).toBe(true);
        expect(extensionUsesKey(['mod+shift+k'], shortcut('Mod+K'), true)).toBe(false);
        expect(extensionUsesKey([], shortcut('Mod+K'), true)).toBe(false);
    });
});
