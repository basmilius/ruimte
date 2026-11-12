import { describe, expect, test } from 'bun:test';
import { shortcutText } from '@adecore/ui';
import { overridesSnapshot } from '@/surface/shortcut-overrides';
import { filterShortcuts, shortcutGroupOf, shortcutGroups, shortcutRowId } from './shortcuts.ts';

describe('shortcutGroups', () => {
    const labels = (apple: boolean): string[] => shortcutGroups(apple).flatMap((group) => group.shortcuts.map((row) => row.label));

    test('the line motions of a terminal are listed on macOS only', () => {
        expect(labels(true)).toContain('Back one word');
        expect(labels(false)).not.toContain('Back one word');
        expect(labels(false)).toContain('Clear screen and scrollback');
    });

    describe('the keys of the shell menu', () => {
        const general = (apple: boolean, shell: string | null): string[] =>
            shortcutGroups(apple, overridesSnapshot(), shell)
                .find((group) => group.id === 'general')!
                .shortcuts.map((row) => `${row.label} ${shortcutText(row.keys)}`);

        test('macOS lists the app and window menu at their keys', () => {
            expect(general(true, 'darwin')).toEqual(
                expect.arrayContaining([
                    'Cut Mod+X',
                    'Hide Ruimte Mod+H',
                    'Hide other apps Mod+Alt+H',
                    'Minimize window Mod+M',
                    'Full screen Mod+Ctrl+F',
                    'Developer tools Mod+Alt+I',
                    'Quit Ruimte Mod+Q'
                ])
            );
        });

        test('Linux quits on Mod+Q and Windows redoes on Mod+Y instead', () => {
            const shared = ['Cut Mod+X', 'Minimize window Mod+M', 'Full screen F11', 'Developer tools Mod+Shift+I'];

            expect(general(false, 'linux')).toEqual(expect.arrayContaining([...shared, 'Quit Ruimte Mod+Q']));
            expect(general(false, 'linux')).not.toContain('Redo Mod+Y');
            expect(general(false, 'win32')).toEqual(expect.arrayContaining([...shared, 'Redo Mod+Y']));
            expect(general(false, 'win32')).not.toContain('Quit Ruimte Mod+Q');
            expect(general(false, 'linux')).not.toContain('Hide Ruimte Mod+H');
        });

        test.each([true, false])('a browser tab lists cut and no key of a shell it lacks, apple %p', (apple) => {
            const rows = general(apple, null);

            expect(rows).toContain('Cut Mod+X');
            expect(rows.filter((row) => /^(Hide|Minimize|Full screen|Developer tools|Quit|Redo)/.test(row))).toEqual([]);
        });
    });
});

describe('shortcutRowId', () => {
    test('names the category a search result has to open', () => {
        expect(shortcutGroupOf(shortcutRowId('drawing', 3))).toBe('drawing');
        expect(shortcutGroupOf(shortcutRowId('editor', 0))).toBe('editor');
        expect(shortcutGroupOf('keyboard.commands.2')).toBeNull();
        expect(shortcutGroupOf('appearance.theme')).toBeNull();
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
        expect(found(groups)).toEqual(['Zoom at pointer', 'Zoom in', 'Zoom out']);
    });

    test('matches on the keys as this platform prints them, with or without spaces', () => {
        expect(found(filterShortcuts(mac, '⌘z', true))).toEqual(['Undo', 'Redo']);
        expect(found(filterShortcuts(mac, '⇧ ⌘ z', true))).toEqual(['Redo']);
        expect(found(filterShortcuts(other, 'ctrl+shift+z', false))).toEqual(['Redo']);
        expect(found(filterShortcuts(other, '⌘z', false))).toEqual([]);
    });
});
