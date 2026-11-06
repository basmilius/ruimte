import { describe, expect, test } from 'bun:test';
import { shortcut, shortcutParts, type Shortcut, isApplePlatform } from '@adecore/ui';
import { commandIds, commandSpec } from '@/commands/registry';
import { arrangeShortcuts } from '@/settings/arrange-shortcuts';
import { commandArea, editorShortcutRows, isEditorCommand } from '@/settings/editor-shortcuts';
import { searchSettings, shortcutSearchRows } from '@/settings/search';
import { KEYBOARD_AREAS, shortcutGroups, type ShortcutGroup } from '@/settings/shortcuts';

const EDITOR_AREAS = ['editor', 'navigation', 'code'];

/* The rows of the palette that carry a key, as the Keyboard pane is handed them. */
const COMMAND_ROWS = commandIds()
    .filter((id) => commandSpec(id).palette !== false && commandSpec(id).shortcut !== undefined)
    .map((id) => ({
        id,
        label: `row ${id}`,
        shortcut: commandSpec(id).shortcut
    }));

function labelsOf(groups: readonly ShortcutGroup[], area?: string): string[] {
    return groups.filter((group) => area === undefined || group.id === area).flatMap((group) => group.shortcuts.map((row) => row.label));
}

function signatureOf(keys: Shortcut, apple: boolean): string {
    return shortcutParts(keys, apple).join('+');
}

describe.each([true, false])('arrangeShortcuts, apple %p', (apple) => {
    const groups = arrangeShortcuts(apple, COMMAND_ROWS);

    test('lists the categories in their order, the editor after the views', () => {
        expect(groups.map((group) => group.id)).toEqual([...KEYBOARD_AREAS]);
        expect(KEYBOARD_AREAS.slice(2, 5)).toEqual(['views', 'editor', 'navigation']);
    });

    test('lists the editor keymap, the keys without a menu row included', () => {
        expect(labelsOf(groups, 'editor')).toEqual(
            expect.arrayContaining(['Move line up', 'Duplicate line or selection', 'Expand selection', 'Toggle line comment'])
        );
        expect(labelsOf(groups, 'navigation')).toContain('Go to definition');
        expect(labelsOf(groups, 'code')).toContain('Rename symbol');
    });

    test('names every key with words', () => {
        for (const label of labelsOf(groups)) {
            expect(label).not.toContain('shortcuts.');
        }
    });

    test('lists no command row of the editor, and the rest in the category of its menu', () => {
        const rows = arrangeShortcuts(apple, [
            { id: 'toggle-line-comment', label: 'Command row comment', shortcut: shortcut('Mod+/') },
            { id: 'settings', label: 'Settings', shortcut: shortcut('Mod+,') },
            { id: 'find', label: 'Find', shortcut: shortcut('Mod+F') }
        ]);
        expect(labelsOf(rows)).not.toContain('Command row comment');
        expect(labelsOf(rows, 'general')).toContain('Settings');
        expect(labelsOf(rows, 'editor')).toContain('Find');
    });

    test('leaves out no row and lists none twice', () => {
        const kept = COMMAND_ROWS.filter((row) => !isEditorCommand(row.id));
        const fixed = shortcutGroups(apple).flatMap((group) => group.shortcuts);
        const listed = groups.flatMap((group) => group.shortcuts);
        expect(listed.length).toBe(fixed.length + kept.length + editorShortcutRows(apple).length);
        const identities = listed.map((row) => `${row.label}|${signatureOf(row.keys, apple)}|${row.then ?? ''}`);
        expect(new Set(identities).size).toBe(identities.length);
        for (const row of kept) {
            expect(labelsOf(groups)).toContain(row.label);
        }
    });

    // The command table resolves its keys once, for the platform the module loaded on.
    test.skipIf(apple !== isApplePlatform())('keeps the key of every command row of the editor among the editor keys', () => {
        const editorKeys = new Set(
            groups.filter((group) => EDITOR_AREAS.includes(group.id)).flatMap((group) => group.shortcuts.map((row) => signatureOf(row.keys, apple)))
        );
        for (const row of COMMAND_ROWS.filter((entry) => isEditorCommand(entry.id))) {
            expect(editorKeys.has(signatureOf(row.shortcut!, apple))).toBe(true);
        }
    });

    test('puts every command row in a category of the pane', () => {
        for (const row of COMMAND_ROWS) {
            expect(KEYBOARD_AREAS).toContain(commandArea(row.id));
        }
    });

    test('a search finds a row of the editor in its category', () => {
        const index = groups.find((group) => group.id === 'editor')!.shortcuts.findIndex((row) => row.label === 'Move line up');
        expect(searchSettings('move line up', shortcutSearchRows(groups, apple))).toMatchObject([
            { section: 'keyboard', id: `keyboard.editor.${index}`, label: 'Move line up' }
        ]);
    });
});

describe('arrangeShortcuts per platform', () => {
    test('leaves out a key the platform has no chord for', () => {
        expect(labelsOf(arrangeShortcuts(true, []), 'navigation')).toContain('Move to line start');
        expect(labelsOf(arrangeShortcuts(false, []), 'navigation')).not.toContain('Move to line start');
    });
});
