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

    /* A bare `startsWith` read the sibling as inside and answered `old/src/a.ts`, which resolves back
       to a file in the folder that was never the one meant. */
    test('a folder beside the root is not in it', () => {
        expect(relativeTo('/repo', '/repo-old/src/a.ts')).toBe('/repo-old/src/a.ts');
        expect(relativeTo('/repo', '/repository/src/a.ts')).toBe('/repository/src/a.ts');
        expect(relativeTo('/repo/', '/repo-old/src/a.ts')).toBe('/repo-old/src/a.ts');
        expect(relativeTo('C:\\repo', 'C:\\repo-old\\src\\a.ts')).toBe('C:\\repo-old\\src\\a.ts');
    });

    test('the root itself is the empty path, and comes back whole', () => {
        expect(relativeTo('/repo', '/repo')).toBe('');
        expect(relativeTo('/repo/', '/repo')).toBe('');
        expect(relativeTo('C:\\repo', 'C:\\repo')).toBe('');
        expect(absoluteOf('/repo', relativeTo('/repo', '/repo'))).toBe('/repo');
    });

    test('a trailing separator on the root changes nothing', () => {
        expect(relativeTo('/repo/', '/repo/src/index.ts')).toBe('src/index.ts');
        expect(relativeTo('C:\\repo\\', 'C:\\repo\\src\\index.ts')).toBe('src/index.ts');
        expect(relativeTo('/', '/etc/hosts')).toBe('etc/hosts');
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

    /* The whole point of the promise: what a file outside the folder stores has to resolve back to
       the file itself, and a sibling folder read as inside resolved to a path in the project. */
    test('a file in a folder beside the project keeps its absolute path, both ways', () => {
        expect(storedPathOf('/Users/bas/repo', '/Users/bas/repo-old/src/a.ts')).toBe('/Users/bas/repo-old/src/a.ts');
        expect(resolveStoredPath('/Users/bas/repo', storedPathOf('/Users/bas/repo', '/Users/bas/repo-old/src/a.ts'))).toBe('/Users/bas/repo-old/src/a.ts');
        expect(storedPathOf('C:\\code\\app', 'C:\\code\\app-old\\src\\main.ts')).toBe('C:\\code\\app-old\\src\\main.ts');
        expect(resolveStoredPath('C:\\code\\app', storedPathOf('C:\\code\\app', 'C:\\code\\app-old\\src\\main.ts'))).toBe('C:\\code\\app-old\\src\\main.ts');
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
