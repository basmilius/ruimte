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
    const attack = "C:/repo/O'Neil$(whoami).txt";

    test('PowerShell doubles every quote that ends its single-quoted strings', () => {
        expect(shellQuotedPaths([attack], 'win32', 'powershell')).toBe("'C:/repo/O''Neil$(whoami).txt' ");
        expect(shellQuotedPaths(['C:\\it\u2019s.txt'], 'win32', 'pwsh')).toBe("'C:\\it\u2019\u2019s.txt' ");
        expect(shellQuotedPaths(['C:\\a&b.txt'], 'win32', 'PowerShell')).toBe("'C:\\a&b.txt' ");
    });

    test('Git Bash closes, escapes and opens its single quotes again', () => {
        expect(shellQuotedPaths([attack], 'win32', 'bash')).toBe("'C:/repo/O'\\''Neil$(whoami).txt' ");
    });

    test('cmd reads double quotes, doubles a closing backslash and refuses what it expands inside them', () => {
        expect(shellQuotedPaths([attack], 'win32', 'cmd')).toBe('"C:/repo/O\'Neil$(whoami).txt" ');
        expect(shellQuotedPaths(['C:\\a&b.txt', 'C:\\'], 'win32', 'cmd')).toBe('"C:\\a&b.txt" "C:\\\\" ');
        expect(shellQuotedPaths(['C:\\100%PATH%.txt'], 'win32', 'cmd')).toBeNull();
        expect(shellQuotedPaths(['C:\\wow!.txt'], 'win32', 'cmd')).toBeNull();
    });

    test('a shell it does not know gets the form that runs nothing in PowerShell or Git Bash, without what cmd acts on', () => {
        expect(shellQuotedPaths([attack], 'win32')).toBe("'C:/repo/O''Neil$(whoami).txt' ");
        expect(shellQuotedPaths(['C:\\My Files\\shot.png'], 'win32', 'nu')).toBe("'C:\\My Files\\shot.png' ");
        expect(shellQuotedPaths(['C:\\plain.png', 'C:\\a&b.png'], 'win32')).toBeNull();
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
