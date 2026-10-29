import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { SETTINGS_INDEX, searchSettings, shortcutSearchRows } from './search';
import { shortcutGroups } from './shortcuts';

describe('searching the settings', () => {
    test('every row in the index names words that exist, and leads to one row', () => {
        for (const entry of SETTINGS_INDEX) {
            expect(i18next.exists(entry.label)).toBe(true);
            if (entry.description) {
                expect(i18next.exists(entry.description)).toBe(true);
            }
        }
        const ids = SETTINGS_INDEX.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('a row is found by its label and by its description', () => {
        expect(searchSettings('wrap long').map((result) => result.id)).toEqual(['editor.general.display.wrap']);
        expect(searchSettings('pinned tab').map((result) => result.id)).toContain('files.files.openFiles');
        expect(searchSettings('terminal links').map((result) => result.id)).toContain('terminal.links');
        expect(searchSettings('sticky scroll')[0]).toMatchObject({ section: 'editor', id: 'editor.general.display.stickyScroll' });
        expect(searchSettings('whitespace changes')[0]).toMatchObject({ section: 'files', id: 'files.git.whitespace', label: 'Show whitespace changes' });
    });

    test('leaves out the setting to render documentation comments while that feature is off', () => {
        expect(searchSettings('render documentation').map((result) => result.id)).not.toContain('editor.general.documentation.render');
    });

    test('finds a fold setting by its words', () => {
        expect(searchSettings('documentation comments').map((result) => result.id)).toContain('editor.folding.general.docComments');
        expect(searchSettings('attribution')[0]).toMatchObject({ section: 'editor', id: 'editor.ai.attribution' });
        expect(searchSettings('heredocs')[0]).toMatchObject({ section: 'editor', id: 'editor.folding.php.heredocs' });
    });

    test('every word must match, in any case and order', () => {
        expect(searchSettings('DIFF layout').map((result) => result.id)).toEqual(['files.git.layout']);
        expect(searchSettings('layout diff').map((result) => result.id)).toEqual(['files.git.layout']);
        expect(searchSettings('diff layout nowhere')).toEqual([]);
    });

    test('a pane is a result of its own, ahead of its rows', () => {
        const results = searchSettings('voice');
        expect(results[0]).toMatchObject({ section: 'voice', id: null, label: 'Voice' });
        expect(results.map((result) => result.id)).toContain('voice.voice');
    });

    test('an interpolation the index cannot fill in is not matched as braces', () => {
        expect(searchSettings('{{')).toEqual([]);
        expect(searchSettings('dates numbers read')).toMatchObject([{ id: 'general.region', description: 'Dates and numbers read as .' }]);
    });

    test('a shortcut is found by its label, its category and its platform keys', () => {
        const rows = shortcutSearchRows(shortcutGroups(true), true);
        expect(searchSettings('zoom out', rows)).toMatchObject([{ section: 'keyboard', label: 'Zoom out', description: 'Canvas · -' }]);
        const other = shortcutSearchRows(shortcutGroups(false), false);
        expect(searchSettings('select all ctrl+a', other)).toMatchObject([{ section: 'keyboard', label: 'Select all', description: 'Canvas · Ctrl+A' }]);
        expect(searchSettings('select all ⌘a', rows)).toMatchObject([{ section: 'keyboard', label: 'Select all', description: 'Canvas · ⌘A' }]);
        expect(searchSettings('zoom out')).toEqual([]);
    });

    test('an empty query finds nothing rather than everything', () => {
        expect(searchSettings('   ')).toEqual([]);
    });

    test('the accent setting is found by its name, in any case and with accents', () => {
        const results = searchSettings('accent');
        expect(results).toContainEqual(expect.objectContaining({ section: 'appearance', id: 'appearance.accent' }));
        expect(searchSettings('Accent')).toEqual(results);
        expect(searchSettings('accént')).toEqual(results);
    });

    test('a row the pane does not draw is not found', () => {
        expect(searchSettings('direct').map((result) => result.id)).not.toContain('machines.machine.direct');
    });
});

describe('searching in Dutch', () => {
    afterEach(async () => {
        await i18next.changeLanguage('en');
    });

    async function useDutch(): Promise<void> {
        const words = JSON.parse(readFileSync(new URL('../../i18n/locales/nl/settings.json', import.meta.url), 'utf8'));
        i18next.addResourceBundle('nl', 'settings', words, true, true);
        await i18next.changeLanguage('nl');
    }

    test('finds a row by its Dutch and by its English words', async () => {
        await useDutch();
        expect(searchSettings('accentkleur').map((result) => result.id)).toContain('appearance.accent');
        expect(searchSettings('accent').map((result) => result.id)).toContain('appearance.accent');
        expect(searchSettings('theme').map((result) => result.id)).toContain('appearance.theme');
    });

    test('shows the label in the interface language', async () => {
        await useDutch();
        const row = searchSettings('theme').find((result) => result.id === 'appearance.theme');
        expect(row?.label).toBe(i18next.t('settings:appearance.theme.label'));
        expect(row?.label).not.toBe(i18next.getFixedT('en')('settings:appearance.theme.label'));
    });
});
