import { describe, expect, test } from 'bun:test';
import { absoluteOf, relativeTo, resolveStoredPath, storedPathOf } from './stored-path.ts';

describe('relativeTo and absoluteOf', () => {
    test('cross between the daemon\u2019s absolute path and a folder-relative one', () => {
        expect(relativeTo('/repo', '/repo/src/index.ts')).toBe('src/index.ts');
        expect(relativeTo('/repo/', '/repo/src')).toBe('src');
        expect(relativeTo('C:\\repo', 'C:\\repo\\src\\index.ts')).toBe('src/index.ts');
        expect(absoluteOf('/repo', 'src/index.ts')).toBe('/repo/src/index.ts');
        expect(absoluteOf('/repo', 'src/')).toBe('/repo/src');
        expect(absoluteOf('C:\\repo', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts');
    });
});

describe('storedPathOf', () => {
    test('shortens a path inside the folder and leaves the rest whole', () => {
        expect(storedPathOf('/home/bas/app', '/home/bas/app/src/main.ts')).toBe('src/main.ts');
        expect(storedPathOf('/home/bas/app', '/etc/hosts')).toBe('/etc/hosts');
        expect(storedPathOf(null, '/etc/hosts')).toBe('/etc/hosts');
    });

    test('speaks POSIX about a Windows folder', () => {
        expect(storedPathOf('C:\\code\\app', 'C:\\code\\app\\src\\main.ts')).toBe('src/main.ts');
    });
});

describe('resolveStoredPath', () => {
    test('puts a relative path back on the daemon machine', () => {
        expect(resolveStoredPath('/home/bas/app', 'src/main.ts')).toBe('/home/bas/app/src/main.ts');
        expect(resolveStoredPath('C:\\code\\app', 'src/main.ts')).toBe('C:\\code\\app\\src\\main.ts');
    });

    test('hands an absolute path over untouched, folder or no folder', () => {
        expect(resolveStoredPath('/home/bas/app', '/etc/hosts')).toBe('/etc/hosts');
        expect(resolveStoredPath(null, '/etc/hosts')).toBe('/etc/hosts');
    });

    test('answers null for a relative path with no folder to resolve it against', () => {
        expect(resolveStoredPath(null, 'src/main.ts')).toBeNull();
    });
});
