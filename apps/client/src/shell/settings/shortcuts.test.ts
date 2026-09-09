import { describe, expect, test } from 'bun:test';
import { CANVAS_SHORTCUTS, commandShortcuts, filterShortcuts } from './shortcuts.ts';

describe('commandShortcuts', () => {
    test('keeps only commands with a chord and splits the modifiers into their own key caps', () => {
        const group = commandShortcuts([
            { label: 'New terminal', shortcut: '⌥T' },
            { label: 'Open a folder' },
            { label: 'Redo', shortcut: '⇧⌘Z' },
            { label: 'Settings', shortcut: '⌘,' }
        ]);
        expect(group.shortcuts).toEqual([
            { keys: '⌥ T', label: 'New terminal' },
            { keys: '⇧ ⌘ Z', label: 'Redo' },
            { keys: '⌘ ,', label: 'Settings' }
        ]);
    });
});

describe('filterShortcuts', () => {
    test('an empty query returns every group untouched', () => {
        expect(filterShortcuts(CANVAS_SHORTCUTS, '   ')).toEqual([...CANVAS_SHORTCUTS]);
    });

    test('matches on the label, case-insensitively, and drops groups that end up empty', () => {
        const groups = filterShortcuts(CANVAS_SHORTCUTS, 'ZOOM');
        expect(groups.map((group) => group.title)).toEqual(['Canvas']);
        expect(groups[0]!.shortcuts.map((shortcut) => shortcut.label)).toEqual(['Zoom around the pointer', 'Zoom in', 'Zoom out']);
    });

    test('matches on the keys with or without the spaces between them', () => {
        expect(filterShortcuts(CANVAS_SHORTCUTS, '⌘z').flatMap((group) => group.shortcuts.map((shortcut) => shortcut.label))).toEqual(['Undo', 'Redo']);
        expect(filterShortcuts(CANVAS_SHORTCUTS, '⇧ ⌘ z').flatMap((group) => group.shortcuts.map((shortcut) => shortcut.label))).toEqual(['Redo']);
    });
});
