import { describe, expect, test } from 'bun:test';
import { shortcut } from '@/ui/shortcut';
import { commandShortcuts, filterShortcuts, shortcutGroups } from './shortcuts.ts';

describe('commandShortcuts', () => {
    test('keeps only commands with a shortcut', () => {
        const group = commandShortcuts([
            { label: 'New terminal', shortcut: shortcut('Alt+T') },
            { label: 'Open a folder' },
            { label: 'Settings', shortcut: shortcut('Mod+,') }
        ]);
        expect(group.shortcuts).toEqual([
            { keys: shortcut('Alt+T'), label: 'New terminal' },
            { keys: shortcut('Mod+,'), label: 'Settings' }
        ]);
    });
});

describe('shortcutGroups', () => {
    const labels = (apple: boolean): string[] => shortcutGroups(apple).flatMap((group) => group.shortcuts.map((row) => row.label));

    test('the line motions of a terminal are listed on macOS only', () => {
        expect(labels(true)).toContain('Move back one word');
        expect(labels(false)).not.toContain('Move back one word');
        expect(labels(false)).toContain('Clear the screen and the scrollback');
    });
});

describe('filterShortcuts', () => {
    const mac = shortcutGroups(true);
    const other = shortcutGroups(false);
    const found = (groups: ReturnType<typeof shortcutGroups>): string[] => groups.flatMap((group) => group.shortcuts.map((row) => row.label));

    test('an empty query returns every group untouched', () => {
        expect(filterShortcuts(mac, '   ', true)).toEqual(mac);
    });

    test('matches on the label, case-insensitively, and drops groups that end up empty', () => {
        const groups = filterShortcuts(mac, 'ZOOM', true);
        expect(groups.map((group) => group.title)).toEqual(['Canvas']);
        expect(found(groups)).toEqual(['Zoom around the pointer', 'Zoom in', 'Zoom out']);
    });

    test('matches on the keys as this platform prints them, with or without spaces', () => {
        expect(found(filterShortcuts(mac, '⌘z', true))).toEqual(['Undo', 'Redo']);
        expect(found(filterShortcuts(mac, '⇧ ⌘ z', true))).toEqual(['Redo']);
        expect(found(filterShortcuts(other, 'ctrl+shift+z', false))).toEqual(['Redo']);
        expect(found(filterShortcuts(other, '⌘z', false))).toEqual([]);
    });
});
