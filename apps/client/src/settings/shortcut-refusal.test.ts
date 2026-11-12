import { describe, expect, test } from 'bun:test';
import { shortcut } from '@adecore/ui';
import { keyboardGroups } from './keyboard-groups';
import { extensionUsesKey, refusalOf, resetRefusalOf, sameKey } from './shortcut-refusal';
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

describe('refusalOf against the fixed keys', () => {
    const takenOn = (text: string, apple: boolean): boolean =>
        refusalOf(shortcut(text), 'palette', keyboardGroups(apple), { apple, browserTab: false })?.reason === 'taken';

    test.each([true, false])('refuses cut and every view key, apple %p', (apple) => {
        for (const text of ['Mod+X', 'Mod+1', 'Mod+2', 'Mod+5', 'Mod+9']) {
            expect(takenOn(text, apple), text).toBe(true);
        }
    });

    test('refuses quit and hide on macOS', () => {
        expect(takenOn('Mod+Q', true)).toBe(true);
        expect(takenOn('Mod+H', true)).toBe(true);
    });
});

describe.each([true, false])('resetRefusalOf, apple %p', (apple) => {
    test('names the row a person moved onto the default key since', () => {
        const moved: ShortcutGroup[] = [{ id: 'general', title: 'General', shortcuts: [{ id: 'sidebar', keys: shortcut('Mod+K'), label: 'Toggle sidebar' }] }];

        expect(resetRefusalOf(shortcut('Mod+K'), 'palette', moved, apple)).toEqual({ reason: 'taken', label: 'Toggle sidebar' });
    });

    test('lets a row go back to a default it shares with a fixed row or with the default of another', () => {
        const shared: ShortcutGroup[] = [
            {
                id: 'terminal',
                title: 'Terminal',
                shortcuts: [
                    { keys: shortcut('Mod+K'), label: 'Clear screen and scrollback' },
                    { id: 'sidebar', keys: shortcut('Mod+B'), label: 'Toggle sidebar' }
                ]
            }
        ];

        expect(resetRefusalOf(shortcut('Mod+K'), 'palette', shared, apple)).toBeNull();
        expect(resetRefusalOf(shortcut('Mod+B'), 'palette', shared, apple)).toBeNull();
    });

    test('lets a row go back to a free default, also one without a modifier', () => {
        expect(resetRefusalOf(shortcut('Mod+Alt+Y'), 'palette', GROUPS, apple)).toBeNull();
        expect(resetRefusalOf(shortcut('Shift+1'), 'palette', GROUPS, apple)).toBeNull();
        expect(resetRefusalOf(undefined, 'palette', GROUPS, apple)).toBeNull();
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
