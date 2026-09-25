import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { SETTINGS_INDEX, searchSettings } from './search';

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
        expect(searchSettings('wrap long').map((result) => result.id)).toEqual(['appearance.code.wrap']);
        expect(searchSettings('pinned tab').map((result) => result.id)).toContain('files.files.openFiles');
        expect(searchSettings('whitespace')[0]).toMatchObject({ section: 'files', id: 'files.git.whitespace', label: 'Show whitespace changes' });
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
        expect(searchSettings('dates numbers read')).toMatchObject([{ id: 'appearance.region', description: 'Dates and numbers read as .' }]);
    });

    test('an empty query finds nothing rather than everything', () => {
        expect(searchSettings('   ')).toEqual([]);
    });
});
