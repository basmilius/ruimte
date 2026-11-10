import { describe, expect, test } from 'bun:test';
import { parentOf, separatorFor, shownPath } from './machine-path';

describe('separatorFor', () => {
    test('a Windows daemon answers in backslashes, every other one in slashes', () => {
        expect(separatorFor('win32')).toBe('\\');
        expect(separatorFor('darwin')).toBe('/');
        expect(separatorFor(null)).toBe('/');
    });
});

describe('parentOf', () => {
    test('one level up a POSIX path, with the separator a browse needs', () => {
        expect(parentOf('/a/b/c/', '/')).toBe('/a/b/');
        expect(parentOf('/a/b/c', '/')).toBe('/a/b/');
        expect(parentOf('/a', '/')).toBe('/');
        expect(parentOf('~/projects', '/')).toBe('~/');
    });

    test('one level up a Windows path', () => {
        expect(parentOf('C:\\a\\b', '\\')).toBe('C:\\a\\');
        expect(parentOf('C:\\a', '\\')).toBe('C:\\');
    });

    test('one level up a Windows path typed with forward slashes', () => {
        expect(parentOf('C:/a/b', '\\')).toBe('C:/a/');
        expect(parentOf('C:/a/b/', '\\')).toBe('C:/a/');
        expect(parentOf('C:/a', '\\')).toBe('C:/');
        expect(parentOf('C:/', '\\')).toBeNull();
    });

    test('a root has nowhere to go', () => {
        expect(parentOf('/', '/')).toBeNull();
        expect(parentOf('C:\\', '\\')).toBeNull();
        expect(parentOf('~/', '/')).toBeNull();
        expect(parentOf('', '/')).toBeNull();
    });
});

describe('shownPath', () => {
    test('a Windows machine shows its home folder as the machine wrote it', () => {
        expect(shownPath('~\\', 'C:\\Users\\bas', 'win32')).toBe('C:\\Users\\bas\\');
        expect(shownPath('~/', 'C:\\Users\\bas', 'win32')).toBe('C:\\Users\\bas\\');
        expect(shownPath('~', 'C:\\Users\\bas', 'win32')).toBe('C:\\Users\\bas\\');
        expect(shownPath('~\\Documents\\', 'C:\\Users\\bas\\Documents', 'win32')).toBe('C:\\Users\\bas\\Documents\\');
    });

    test('a root the machine answered keeps its single separator', () => {
        expect(shownPath('~\\', 'C:\\', 'win32')).toBe('C:\\');
    });

    test('macOS and Linux keep the tilde', () => {
        expect(shownPath('~/', '/Users/bas', 'darwin')).toBe('~/');
        expect(shownPath('~/', '/home/bas', 'linux')).toBe('~/');
        expect(shownPath('~/', '/home/bas', null)).toBe('~/');
    });

    test('a path that is not a whole tilde folder, or has no listing yet, stays as typed', () => {
        expect(shownPath('~\\Doc', 'C:\\Users\\bas', 'win32')).toBe('~\\Doc');
        expect(shownPath('D:\\Work\\', 'D:\\Work', 'win32')).toBe('D:\\Work\\');
        expect(shownPath('~\\', null, 'win32')).toBe('~\\');
    });
});
