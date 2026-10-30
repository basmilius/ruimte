import { describe, expect, test } from 'bun:test';
import { hasControlCharacter, shellQuotedPaths } from './drop-path';

describe('shellQuotedPaths on a POSIX shell', () => {
    test('a plain path is typed as it is, with a space after it', () => {
        expect(shellQuotedPaths(['/Users/bas/Pictures/shot-1.png'], 'darwin')).toBe('/Users/bas/Pictures/shot-1.png ');
        expect(shellQuotedPaths(['/srv/app@2/v1.0+beta,x=y:z%'], 'linux')).toBe('/srv/app@2/v1.0+beta,x=y:z% ');
    });

    test('a path with a space, a dollar sign, a bang or non-ASCII letters is wrapped in single quotes', () => {
        expect(shellQuotedPaths(['/path/with space/file.png'], 'darwin')).toBe("'/path/with space/file.png' ");
        expect(shellQuotedPaths(['/tmp/$HOME'], 'linux')).toBe("'/tmp/$HOME' ");
        expect(shellQuotedPaths(['/tmp/wow!.txt'], 'linux')).toBe("'/tmp/wow!.txt' ");
        expect(shellQuotedPaths(['/Users/bas/Bureaublad/één.png'], 'darwin')).toBe("'/Users/bas/Bureaublad/één.png' ");
    });

    test('a single quote in a path is closed, escaped and opened again', () => {
        expect(shellQuotedPaths(["/tmp/bas's file"], 'darwin')).toBe("'/tmp/bas'\\''s file' ");
    });

    test('several paths are joined with one space and end on one', () => {
        expect(shellQuotedPaths(['/a/b.png', '/c d/e.png'], 'darwin')).toBe("/a/b.png '/c d/e.png' ");
    });

    test('an unknown platform is POSIX', () => {
        expect(shellQuotedPaths(['/a b'], null)).toBe("'/a b' ");
    });
});

describe('shellQuotedPaths on Windows', () => {
    test('a path stays a Windows path in single quotes, which PowerShell and Git Bash both read literally', () => {
        expect(shellQuotedPaths(['C:\\My Files\\shot.png', 'C:\\a&b\\c.png'], 'win32')).toBe("'C:\\My Files\\shot.png' 'C:\\a&b\\c.png' ");
    });

    test('a path with an apostrophe goes in double quotes', () => {
        expect(shellQuotedPaths(["C:\\bas's\\y.png"], 'win32')).toBe('"C:\\bas\'s\\y.png" ');
    });
});

describe('hasControlCharacter', () => {
    test('finds an escape, a carriage return, a newline, DEL and a C1 control in a name', () => {
        expect(hasControlCharacter('/tmp/a\x1b[201~rm -rf ~')).toBe(true);
        expect(hasControlCharacter('/tmp/a\rb')).toBe(true);
        expect(hasControlCharacter('/tmp/a\nb')).toBe(true);
        expect(hasControlCharacter('/tmp/a\x7fb')).toBe(true);
        expect(hasControlCharacter('/tmp/a\x9bb')).toBe(true);
    });

    test('leaves spaces, quotes and letters of any script alone', () => {
        expect(hasControlCharacter("/tmp/bas's één 日本語.png")).toBe(false);
    });
});
