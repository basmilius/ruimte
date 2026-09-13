import { describe, expect, test } from 'bun:test';
import { escapeText, unescapeText } from './text-escapes.ts';

describe('unescapeText', () => {
    test('reads \\n, \\t and \\\\', () => {
        expect(unescapeText('a\\nb')).toBe('a\nb');
        expect(unescapeText('a\\tb')).toBe('a\tb');
        expect(unescapeText('a\\\\b')).toBe('a\\b');
    });

    test('an escaped backslash is not the start of the next escape', () => {
        expect(unescapeText('a\\\\nb')).toBe('a\\nb');
        expect(unescapeText('\\\\\\n')).toBe('\\\n');
    });

    test('leaves every other backslash alone', () => {
        expect(unescapeText('\\d+\\s')).toBe('\\d+\\s');
        expect(unescapeText('C:\\Users')).toBe('C:\\Users');
        expect(unescapeText('ends with \\')).toBe('ends with \\');
    });

    test('a real newline passes through', () => {
        expect(unescapeText('a\nb')).toBe('a\nb');
    });
});

describe('escapeText', () => {
    test('survives a round trip byte for byte', () => {
        for (const body of ['plain', 'a\nb', 'a\\nb', 'C:\\Users\\n', '\\', 'tab\there']) {
            expect(unescapeText(escapeText(body))).toBe(body);
        }
    });
});
