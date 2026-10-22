import { describe, expect, test } from 'bun:test';
import { searchSettings } from '@/shell/settings/search';
import { useUi } from '@/state/ui';
import { namesSetting, orderBelowJumps, SETTINGS_RESULTS, settingsEntries } from './palette-settings';

describe('settings in the palette', () => {
    test('a row opens the dialog on its pane with the row as target', () => {
        const [entry] = settingsEntries(searchSettings('accent'));
        expect(entry).toMatchObject({ id: 'setting-appearance-appearance.accent', hint: 'Appearance' });
        entry!.run();
        expect(useUi.getState().settings).toMatchObject({ open: true, section: 'appearance', target: 'appearance.accent' });
    });

    test('a pane opens without a target and hints with its description', () => {
        const entry = settingsEntries(searchSettings('dictation')).find((candidate) => candidate.id === 'setting-voice-pane');
        expect(entry?.hint).not.toBe('Voice');
        entry!.run();
        expect(useUi.getState().settings).toMatchObject({ open: true, section: 'voice', target: null });
    });

    test('the list is capped', () => {
        expect(settingsEntries(searchSettings('a')).length).toBeLessThanOrEqual(SETTINGS_RESULTS);
    });

    test("a query that starts a setting's label puts settings above the loose matches", () => {
        expect(namesSetting('accent', settingsEntries(searchSettings('accent')))).toBe(true);
        expect(namesSetting('  ACC', settingsEntries(searchSettings('accent')))).toBe(true);
        expect(namesSetting('zzzz', settingsEntries(searchSettings('accent')))).toBe(false);
        expect(namesSetting('', settingsEntries(searchSettings('accent')))).toBe(false);
    });

    test('commands rank above a setting the query names, which ranks above files', () => {
        const parts = { settings: ['setting'], files: ['file'], rest: ['command'] };
        expect(orderBelowJumps({ named: true, ...parts })).toEqual(['command', 'setting', 'file']);
        expect(orderBelowJumps({ named: false, ...parts })).toEqual(['file', 'command', 'setting']);
    });
});
