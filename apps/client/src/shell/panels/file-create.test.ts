import { describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import { creationParentOf, newEntryPathOf, placeholderPathOf, segmentsOf, validateNewEntry, type NewEntryContext } from './file-create.ts';

type Listing = Pick<FsEntry, 'name' | 'path' | 'kind'>;

function listing(directory: string, ...entries: [string, FsEntry['kind']][]): [string, Listing[]] {
    return [directory, entries.map(([name, kind]) => ({ name, kind, path: `${directory}/${name}` }))];
}

function context(patch: Partial<NewEntryContext> = {}): NewEntryContext {
    const known = new Map([listing('/repo', ['src', 'directory'], ['readme.md', 'file']), listing('/repo/src', ['main.ts', 'file'], ['lib', 'directory'])]);
    return { parent: '/repo', atRoot: true, windows: false, children: (directory) => known.get(directory), ...patch };
}

describe('validateNewEntry', () => {
    test('accepts a plain name and a nested one', () => {
        expect(validateNewEntry('notes.md', 'file', context())).toBeNull();
        expect(validateNewEntry('a/b/c.txt', 'file', context())).toBeNull();
        expect(validateNewEntry('a/b/', 'directory', context())).toBeNull();
    });

    test('refuses an empty name and an empty segment', () => {
        expect(validateNewEntry('   ', 'file', context())?.problem).toBe('empty');
        expect(validateNewEntry('a/', 'file', context())?.problem).toBe('empty');
        expect(validateNewEntry('/a', 'file', context())?.problem).toBe('segment');
        expect(validateNewEntry('a//b', 'file', context())?.problem).toBe('segment');
    });

    test('refuses dots, forbidden characters and a long name', () => {
        expect(validateNewEntry('..', 'directory', context())).toEqual({ problem: 'dots', name: '..' });
        expect(validateNewEntry('a/./b', 'file', context())?.problem).toBe('dots');
        expect(validateNewEntry('a\\b', 'file', context())?.problem).toBe('characters');
        expect(validateNewEntry('a\u0000b', 'file', context())?.problem).toBe('characters');
        expect(validateNewEntry('a:b', 'file', context())).toBeNull();
        expect(validateNewEntry('a:b', 'file', context({ windows: true }))?.problem).toBe('characters');
        expect(validateNewEntry('é'.repeat(128), 'file', context())?.problem).toBe('long');
    });

    test('keeps .git closed everywhere and .ruimte at the project folder', () => {
        expect(validateNewEntry('.git', 'directory', context())?.problem).toBe('reserved');
        expect(validateNewEntry('x/.git/y', 'file', context())?.problem).toBe('reserved');
        expect(validateNewEntry('.ruimte/x', 'file', context())?.problem).toBe('reserved');
        expect(validateNewEntry('.ruimte', 'file', context({ atRoot: false, parent: '/repo/src' }))).toBeNull();
    });

    test('refuses a name the listing holds, whatever it is', () => {
        expect(validateNewEntry('readme.md', 'file', context())).toEqual({ problem: 'exists', name: 'readme.md' });
        expect(validateNewEntry('src', 'directory', context())?.problem).toBe('exists');
        expect(validateNewEntry('src', 'file', context())?.problem).toBe('exists');
        expect(validateNewEntry('src/lib', 'directory', context())?.problem).toBe('exists');
        expect(validateNewEntry('src/main.ts', 'file', context())?.problem).toBe('exists');
    });

    test('refuses a folder that would sit below a file', () => {
        expect(validateNewEntry('readme.md/x', 'file', context())).toEqual({ problem: 'in-file', name: 'readme.md' });
    });

    test('lets a new name through where the listing is not known', () => {
        expect(validateNewEntry('lib/new.ts', 'file', context({ parent: '/repo/src', atRoot: false }))).toBeNull();
        expect(validateNewEntry('anything', 'file', context({ parent: '/repo/unlisted', atRoot: false }))).toBeNull();
    });
});

describe('paths of a new entry', () => {
    test('the segments drop the slash that marks a folder', () => {
        expect(segmentsOf(' a/b/ ', 'directory')).toEqual(['a', 'b']);
        expect(segmentsOf('a/b', 'file')).toEqual(['a', 'b']);
    });

    test('the absolute path follows the folder it is made in', () => {
        expect(newEntryPathOf('/repo/src', 'a/b.ts', 'file')).toBe('/repo/src/a/b.ts');
        expect(newEntryPathOf('/repo', 'docs/', 'directory')).toBe('/repo/docs');
    });

    test('a file is made beside itself, a folder inside, nothing selected at the root', () => {
        expect(creationParentOf('src/lib/')).toBe('src/lib/');
        expect(creationParentOf('src/main.ts')).toBe('src/');
        expect(creationParentOf('readme.md')).toBe('');
        expect(creationParentOf(null)).toBe('');
    });

    test('the open row sits in the folder, a folder marked with a slash', () => {
        expect(placeholderPathOf('src/', 'file')).toBe('src/.ruimte-new');
        expect(placeholderPathOf('', 'directory')).toBe('.ruimte-new/');
    });
});
