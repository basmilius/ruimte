import { describe, expect, test } from 'bun:test';
import type { ArchiveEntry } from '@ruimte/contracts';
import { archiveTotals, archiveTreePaths, entryPathOf, extractFolderName, freeFolderName, hasArchiveName, isFolderName } from './archive-tree';

function file(path: string, size = 1, compressedSize?: number): ArchiveEntry {
    return { path, kind: 'file', size, readable: true, ...(compressedSize === undefined ? {} : { compressedSize }) };
}

function folder(path: string): ArchiveEntry {
    return { path, kind: 'directory', size: 0, readable: true };
}

describe('the tree of an archive', () => {
    test('draws a folder as a row only when nothing is under it', () => {
        expect(archiveTreePaths([folder('src'), file('src/a.ts'), folder('empty'), file('README.md')])).toEqual(['src/a.ts', 'empty/', 'README.md']);
        expect(entryPathOf('empty/')).toBe('empty');
    });

    test('adds up the files, and a compressed size only where every entry says one', () => {
        expect(archiveTotals([file('a', 10, 4), file('b', 20, 6), folder('c')])).toEqual({ files: 2, size: 30, compressed: 10 });
        expect(archiveTotals([file('a', 10, 4), file('b', 20)])).toEqual({ files: 2, size: 30, compressed: null });
    });
});

describe('extracting into a folder', () => {
    test('is named after the archive without its extensions', () => {
        expect(extractFolderName('site.tar.gz')).toBe('site');
        expect(extractFolderName('Site.TGZ')).toBe('Site');
        expect(extractFolderName('library-1.2.jar')).toBe('library-1.2');
        expect(extractFolderName('notes.md.gz')).toBe('notes.md');
        expect(extractFolderName('archive')).toBe('archive folder');
        expect(extractFolderName('.zip')).toBe('.zip folder');
    });

    test('takes the next free name', () => {
        expect(freeFolderName('site', new Set())).toBe('site');
        expect(freeFolderName('site', new Set(['site', 'site 2']))).toBe('site 3');
    });

    test('takes one name and never a path', () => {
        expect(isFolderName('site')).toBe(true);
        for (const name of ['', '.', '..', 'a/b', 'a\\b']) {
            expect(isFolderName(name)).toBe(false);
        }
    });

    test('a nested archive is told by its name', () => {
        expect(hasArchiveName('inner.ZIP')).toBe(true);
        expect(hasArchiveName('logs.tar.gz')).toBe(true);
        expect(hasArchiveName('readme.md')).toBe(false);
    });
});
