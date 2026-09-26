import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { fakeFormatSource } from './fake-source.ts';
import { labelCollator, setFormatSource, type FormatSource } from './locale.ts';

const source = fakeFormatSource();
let previous: FormatSource;

beforeAll(() => {
    previous = setFormatSource(source);
});

afterAll(() => {
    setFormatSource(previous);
});

const inLanguage = (language: string): void => {
    source.set({ language });
};

afterEach(() => {
    inLanguage('en');
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
