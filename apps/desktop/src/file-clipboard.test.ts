import { describe, expect, test } from 'bun:test';
import { copyablePaths, fileClipboard, osClipboardFormat, windowsCopyCommand, windowsCopyInput } from './file-clipboard';

describe('file clipboard', () => {
    test('only a list of absolute paths is copied', () => {
        expect(copyablePaths(['/repo/a.ts', '/repo/src'])).toEqual(['/repo/a.ts', '/repo/src']);
        expect(copyablePaths([])).toBeNull();
        expect(copyablePaths(['/repo/a.ts', 'src/b.ts'])).toBeNull();
        expect(copyablePaths(['/repo/a.ts', 4])).toBeNull();
        expect(copyablePaths('/repo/a.ts')).toBeNull();
    });

    test('macOS gets the paths as text and as the list Finder reads', () => {
        const contents = fileClipboard('darwin', ['/repo/a b.ts', '/repo/R&D <1>']);
        expect(contents?.text).toBe('/repo/a b.ts\n/repo/R&D <1>');
        expect(contents?.formats.NSFilenamesPboardType).toContain(
            '<plist version="1.0"><array><string>/repo/a b.ts</string><string>/repo/R&amp;D &lt;1&gt;</string></array></plist>'
        );
    });

    // The file URLs follow the path rules of the platform the test runs on.
    test.skipIf(process.platform === 'win32')('Linux gets a URI list and the list the GNOME file manager reads', () => {
        const contents = fileClipboard('linux', ['/repo/a b.ts', '/repo/src']);
        expect(contents).toEqual({
            text: '/repo/a b.ts\n/repo/src',
            formats: {
                'text/uri-list': 'file:///repo/a%20b.ts\r\nfile:///repo/src\r\n',
                'x-special/gnome-copied-files': 'copy\nfile:///repo/a%20b.ts\nfile:///repo/src'
            }
        });
    });

    test('a platform without a format copies nothing', () => {
        expect(fileClipboard('win32', ['C:\\repo\\a.ts'])).toBeNull();
    });

    test('Windows reads the paths from stdin as UTF-8, one per zero byte, with backslashes', () => {
        const input = windowsCopyInput(['C:\\repo\\é b.ts', 'C:/repo/src']);
        expect(input.equals(Buffer.from('C:\\repo\\é b.ts\0C:\\repo\\src', 'utf8'))).toBe(true);
    });

    test('the Windows script stays out of the command line quoting and writes a copy, not a move', () => {
        const command = windowsCopyCommand();
        expect(command.slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand']);
        const script = Buffer.from(command[5] ?? '', 'base64').toString('utf16le');
        expect(script).toContain('SetFileDropList');
        expect(script).toContain("'Preferred DropEffect'");
        expect(script).toContain('[byte[]](1, 0, 0, 0)');
    });

    test('a raw format is named the way Electron takes it', () => {
        expect(osClipboardFormat('NSFilenamesPboardType')).toBe('electron application/osclipboard;format="NSFilenamesPboardType"');
    });
});
