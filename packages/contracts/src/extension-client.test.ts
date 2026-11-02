import { describe, expect, test } from 'bun:test';
import { extensionProjectPath } from './extension-client.ts';

describe('a path an extension names', () => {
    test.each([
        ['/work/app', 'notes.md', '/work/app/notes.md'],
        ['/work/app', '/work/app/src/a.ts', '/work/app/src/a.ts'],
        ['/work/app', '.', '/work/app'],
        ['/work/app', 'src\\a.ts', '/work/app/src/a.ts'],
        ['C:\\work\\app', 'notes.md', 'C:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'C:\\work\\app\\notes.md', 'C:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'c:/work/app/src/a.ts', 'c:\\work\\app\\src\\a.ts'],
        ['C:\\work\\app\\', 'src/a.ts', 'C:\\work\\app\\src\\a.ts'],
        ['\\\\server\\share\\app', '\\\\server\\share\\app\\notes.md', '\\\\server\\share\\app\\notes.md'],
        ['\\\\server\\share\\app', 'notes.md', '\\\\server\\share\\app\\notes.md'],
        ['/', '.', '/'],
        ['/', 'notes.md', '/notes.md'],
        ['/', '/src/a.ts', '/src/a.ts'],
        ['C:\\', '.', 'C:\\'],
        ['C:\\', 'notes.md', 'C:\\notes.md'],
        ['C:/', 'src/a.ts', 'C:\\src\\a.ts'],
        ['\\\\server\\share', '.', '\\\\server\\share'],
        ['\\\\server\\share\\', 'notes.md', '\\\\server\\share\\notes.md'],
        ['/work/app', './src/./a.ts', '/work/app/src/a.ts']
    ])('in %p, %p is %p', (folder, path, full) => {
        expect(extensionProjectPath(folder, path)).toBe(full);
    });

    test.each([
        ['/work/app', '/work/other/notes.md'],
        ['/work/app', '/work/app-two/notes.md'],
        ['/work/app', 'sub/../../x'],
        ['C:\\work\\app', 'D:\\work\\app\\notes.md'],
        ['C:\\work\\app', 'C:\\work\\other\\notes.md'],
        ['C:\\work\\app', 'sub\\..\\..\\x'],
        ['C:\\work\\app', '/work/app/notes.md'],
        ['\\\\server\\share\\app', '\\\\other\\share\\app\\notes.md'],
        ['C:\\', 'D:\\notes.md'],
        ['C:\\', '\\\\server\\share\\notes.md'],
        ['/work/app', '//work/app/notes.md']
    ])('in %p, %p is outside', (folder, path) => {
        expect(extensionProjectPath(folder, path)).toBeNull();
    });
});
