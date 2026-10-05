import { describe, expect, test } from 'bun:test';
import { isValidFilePattern, matchesFilePattern } from './language-patterns.ts';

describe('file patterns', () => {
    test('a pattern without a slash matches the file name at any depth', () => {
        expect(matchesFilePattern('*.zig', 'main.zig')).toBe(true);
        expect(matchesFilePattern('*.zig', 'src/deep/main.zig')).toBe(true);
        expect(matchesFilePattern('*.zig', 'main.zig.bak')).toBe(false);
        expect(matchesFilePattern('Makefile', 'build/Makefile')).toBe(true);
        expect(matchesFilePattern('Makefile', 'build/Makefile.am')).toBe(false);
    });

    test('a pattern with a slash matches the whole stored path', () => {
        expect(matchesFilePattern('src/*.tpl', 'src/a.tpl')).toBe(true);
        expect(matchesFilePattern('src/*.tpl', 'src/nested/a.tpl')).toBe(false);
        expect(matchesFilePattern('src/**/*.tpl', 'src/nested/deeper/a.tpl')).toBe(true);
        expect(matchesFilePattern('src/**/*.tpl', 'src/a.tpl')).toBe(true);
        expect(matchesFilePattern('**/templates/*.html', 'a/b/templates/x.html')).toBe(true);
        expect(matchesFilePattern('./src/*.tpl', 'src/a.tpl')).toBe(true);
    });

    test('takes a choice in braces and one character for a question mark', () => {
        expect(matchesFilePattern('*.{c,h}', 'a.h')).toBe(true);
        expect(matchesFilePattern('*.{c,h}', 'a.cpp')).toBe(false);
        expect(matchesFilePattern('a?.txt', 'ab.txt')).toBe(true);
        expect(matchesFilePattern('a?.txt', 'a.txt')).toBe(false);
    });

    test('treats what is no pattern syntax as itself', () => {
        expect(matchesFilePattern('a+b(1).txt', 'a+b(1).txt')).toBe(true);
        expect(matchesFilePattern('a.b', 'axb')).toBe(false);
    });

    test('refuses a pattern that does not close its braces, and an empty one', () => {
        expect(isValidFilePattern('*.{c,h')).toBe(false);
        expect(matchesFilePattern('*.{c,h', 'a.c')).toBe(false);
        expect(isValidFilePattern('  ')).toBe(false);
        expect(isValidFilePattern('*.zig')).toBe(true);
    });
});
