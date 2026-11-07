import { describe, expect, test } from 'bun:test';
import { shortcut, shortcutParts, type Shortcut } from '@adecore/ui';
import { isApplePlatform } from '@/desktop/bridge';
import { COMMAND_IDS, COMMANDS } from '@/shell/command-table';
import { arrangeShortcuts } from '@/shell/settings/arrange-shortcuts';
import { commandArea, editorShortcutRows, isEditorCommand } from '@/shell/settings/editor-shortcuts';
import { searchSettings, shortcutSearchRows } from '@/shell/settings/search';
import { KEYBOARD_AREAS, shortcutGroups, type ShortcutGroup } from '@/shell/settings/shortcuts';

const EDITOR_AREAS = ['editor', 'navigation', 'code'];

/* The rows of the palette that carry a key, as the Keyboard pane is handed them. */
const COMMAND_ROWS = COMMAND_IDS.filter((id) => COMMANDS[id].palette !== false && COMMANDS[id].shortcut !== undefined).map((id) => ({
    id,
    label: `row ${id}`,
    shortcut: COMMANDS[id].shortcut
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

    test('gives the rows a person may rebind their id, and the rest none', () => {
        const rows = groups.flatMap((group) => group.shortcuts);

        expect(rows.find((row) => row.label === 'Command palette')?.id).toBe('palette');
        expect(rows.find((row) => row.label === 'Go to definition')?.id).toBe('goToDefinition');
        expect(rows.find((row) => row.label === 'Delete selection')?.id).toBeUndefined();
        expect(rows.find((row) => row.label === 'Select (1)')?.id).toBeUndefined();
        expect(rows.find((row) => row.label === 'Back one word')?.id).toBeUndefined();
    });

    test('lists a row once, and a rebindable id only once', () => {
        const ids = groups.flatMap((group) => group.shortcuts.flatMap((row) => (row.id === undefined ? [] : [row.id])));

        expect(new Set(ids).size).toBe(ids.length);
    });

    test('lists the four focus keys as rows of their own', () => {
        expect(labelsOf(groups, 'views')).toEqual(
            expect.arrayContaining(['Focus cell on the left', 'Focus cell on the right', 'Focus cell above', 'Focus cell below'])
        );
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
