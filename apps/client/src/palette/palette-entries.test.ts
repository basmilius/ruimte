import { describe, expect, test } from 'bun:test';
import { entryMatches, pageKeywords } from './palette-entries';

describe('a browser row in the palette', () => {
    const page = { url: 'https://example.com/', title: 'Example Domain' };
    const row = { label: 'Browser', hint: 'Browser', keywords: pageKeywords('https://example.com', page) };

    test('answers to the title and the address of its page, beside its own name', () => {
        expect(entryMatches('Example Domain', row)).toBe(true);
        expect(entryMatches('example.com', row)).toBe(true);
        expect(entryMatches('browser', row)).toBe(true);
        expect(entryMatches('github', row)).toBe(false);
    });

    test('answers to the address it was saved with before its page is up', () => {
        expect(pageKeywords('https://example.com', undefined)).toBe('https://example.com');
        expect(pageKeywords(undefined, undefined)).toBe('');
    });

    test('a row without keywords answers to its label and hint only', () => {
        expect(entryMatches('canvas', { label: 'Main', hint: 'Canvas' })).toBe(true);
        expect(entryMatches('example', { label: 'Main', hint: 'Canvas' })).toBe(false);
    });
});
