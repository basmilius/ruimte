import { describe, expect, test } from 'bun:test';
import { encodingLabelOf, languageNameOf, lineEndingOf, symbolBadgeOf } from './status-bar-model';

describe('status bar words', () => {
    test('names a language, and nothing for plain text', () => {
        expect(languageNameOf('typescript')).toBe('TypeScript');
        expect(languageNameOf('lua')).toBe('Lua');
        expect(languageNameOf('text')).toBeNull();
        expect(languageNameOf(undefined)).toBeNull();
    });

    test('reads the line ending off the first line break', () => {
        expect(lineEndingOf('a\r\nb\nc')).toBe('CRLF');
        expect(lineEndingOf('a\nb\r\n')).toBe('LF');
        expect(lineEndingOf('a\rb')).toBe('CR');
        expect(lineEndingOf('one line')).toBe('LF');
    });

    test('writes the encoding in capitals and the symbol as a letter', () => {
        expect(encodingLabelOf('utf-8')).toBe('UTF-8');
        expect(symbolBadgeOf('method')).toBe('f');
        expect(symbolBadgeOf('class')).toBe('c');
        expect(symbolBadgeOf(undefined)).toBe('');
    });
});
