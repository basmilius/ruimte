import { afterEach, describe, expect, test } from 'bun:test';
import { labelCollator } from '@/format/locale';
import { LANGUAGE_SYSTEM } from '@/i18n/languages';
import { useSettings } from '@/state/settings';

const inLanguage = (language: string): void => {
    useSettings.getState().update({ language });
};

afterEach(() => {
    inLanguage(LANGUAGE_SYSTEM);
});

describe('the order labels are read in', () => {
    test('follows the language, which is what wrote the words', () => {
        const sorted = (labels: string[]): string[] => [...labels].sort(labelCollator().compare);
        inLanguage('en');
        expect(sorted(['Separator', 'Subheader', 'Canvas'])).toEqual(['Canvas', 'Separator', 'Subheader']);
        inLanguage('nl');
        expect(sorted(['Scheiding', 'Kopje', 'Canvas'])).toEqual(['Canvas', 'Kopje', 'Scheiding']);
    });

    test('ignores case, so a lowercase label never sinks to the bottom', () => {
        inLanguage('en');
        expect(['terminal', 'Canvas'].sort(labelCollator().compare)).toEqual(['Canvas', 'terminal']);
    });
});
