import { describe, expect, test } from 'bun:test';
import { settingsFrom } from './settings';

describe('a view an agent asks for', () => {
    test('is not followed until a person says so', () => {
        expect(settingsFrom({}).agentsShowViews).toBe(false);
        expect(settingsFrom({ accent: 'blue' }).agentsShowViews).toBe(false);
    });

    test('follows only on a stored true, never on whatever else is under the key', () => {
        expect(settingsFrom({ agentsShowViews: true }).agentsShowViews).toBe(true);
        expect(settingsFrom({ agentsShowViews: 'yes' as unknown as boolean }).agentsShowViews).toBe(false);
    });
});

describe('the rest of a stored blob', () => {
    test('a key that is there is kept, and a size out of range is pulled back into it', () => {
        const settings = settingsFrom({ fontSize: 99, filesShowHidden: true, browseStartFolder: '/Users/bas' });
        expect(settings.fontSize).toBe(20);
        expect(settings.filesShowHidden).toBe(true);
        expect(settings.browseStartFolder).toBe('/Users/bas');
    });
});
