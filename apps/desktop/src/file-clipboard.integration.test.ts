import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFilesOnWindows } from './file-clipboard';

const READ_BACK = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$data = [Windows.Forms.Clipboard]::GetDataObject()
[Windows.Forms.Clipboard]::GetFileDropList() -join '|'
$data.GetData('Preferred DropEffect').ToArray() -join ','
$data.GetText()`;

describe.skipIf(process.platform !== 'win32')('copying files on Windows', () => {
    // Replaces the clipboard of the session it runs in; another process reads it back after the writer ended.
    test('the list outlives the writer, with several paths, a copy effect and the text', async () => {
        const paths = ['C:\\Windows\\win.ini', 'C:\\Windows\\System32\\drivers\\etc\\hosts'];
        expect(await copyFilesOnWindows(paths)).toBe(true);
        const read = spawnSync('powershell.exe', ['-NoProfile', '-Sta', '-EncodedCommand', Buffer.from(READ_BACK, 'utf16le').toString('base64')], {
            encoding: 'utf8',
            timeout: 30_000
        });
        expect(
            read.stdout
                .replace(/^\uFEFF/, '')
                .split(/\r?\n/)
                .slice(0, 4)
        ).toEqual([paths.join('|'), '1,0,0,0', paths[0], paths[1]]);
    });

    test('a name beyond ASCII, with spaces and quotes, arrives whole', async () => {
        const path = 'C:\\tmp\\é "a" $b.txt';
        expect(await copyFilesOnWindows([path])).toBe(true);
        const read = spawnSync('powershell.exe', ['-NoProfile', '-Sta', '-EncodedCommand', Buffer.from(READ_BACK, 'utf16le').toString('base64')], {
            encoding: 'utf8',
            timeout: 30_000
        });
        expect(read.stdout.replace(/^\uFEFF/, '').split(/\r?\n/)[0]).toBe(path);
    });
});
