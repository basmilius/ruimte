import { describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { ProjectRow } from '@/state/project';
import { breadcrumbOf, folderPresence, joinPath, parentOf, separatorFor, shortcutsFor } from './folder-picker';

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
    });

    test('one level up a Windows path', () => {
        expect(parentOf('C:\\a\\b', '\\')).toBe('C:\\a\\');
        expect(parentOf('C:\\a', '\\')).toBe('C:\\');
    });

    test('a root has nowhere to go', () => {
        expect(parentOf('/', '/')).toBeNull();
        expect(parentOf('C:\\', '\\')).toBeNull();
        expect(parentOf('~/', '/')).toBeNull();
        expect(parentOf('', '/')).toBeNull();
    });
});

describe('breadcrumbOf', () => {
    test('every segment of a POSIX path leads back to itself', () => {
        expect(breadcrumbOf('/a/b/c', '/')).toEqual([
            { label: '/', path: '/' },
            { label: 'a', path: '/a/' },
            { label: 'b', path: '/a/b/' },
            { label: 'c', path: '/a/b/c/' }
        ]);
    });

    test('a drive and a tilde are segments of their own', () => {
        expect(breadcrumbOf('C:\\work\\atlas\\', '\\')).toEqual([
            { label: 'C:', path: 'C:\\' },
            { label: 'work', path: 'C:\\work\\' },
            { label: 'atlas', path: 'C:\\work\\atlas\\' }
        ]);
        expect(breadcrumbOf('~/projects', '/')).toEqual([
            { label: '~', path: '~/' },
            { label: 'projects', path: '~/projects/' }
        ]);
    });
});

describe('joinPath', () => {
    test('a folder inside a directory, whatever the directory ends in', () => {
        expect(joinPath('/a/b/', 'c', '/')).toBe('/a/b/c');
        expect(joinPath('/a/b', 'c', '/')).toBe('/a/b/c');
        expect(joinPath('/', 'c', '/')).toBe('/c');
        expect(joinPath('C:\\a\\', 'b', '\\')).toBe('C:\\a\\b');
    });
});

describe('folderPresence', () => {
    const listing = { entries: [{ name: 'projects' }, { name: 'Pictures' }], exists: true };

    test('a path ending in a separator is answered by exists alone', () => {
        expect(folderPresence('~/projects/', listing, '/')).toBe('there');
        expect(folderPresence('~/nope/', { entries: [], exists: false }, '/')).toBe('missing');
    });

    test('without a separator the last segment has to be a name that came back, exactly', () => {
        expect(folderPresence('~/projects', listing, '/')).toBe('there');
        expect(folderPresence('~/pro', listing, '/')).toBe('missing');
        expect(folderPresence('~/pictures', listing, '/')).toBe('missing');
    });

    test('a daemon that does not know the field leaves the question open', () => {
        expect(folderPresence('~/projects/', { entries: [] }, '/')).toBe('unknown');
        expect(folderPresence('~/projects/', null, '/')).toBe('unknown');
    });
});

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({
    projectId: 'p1',
    name: 'Project',
    color: '#123456',
    folder: '/work/one',
    lastOpenedAt: 1,
    available: true,
    icon: { kind: 'initial', value: 'P' },
    nameSource: 'folder',
    ...over
});

describe('shortcutsFor', () => {
    const projects: ProjectRow[] = [
        { endpointId: 'local', summary: summary({ projectId: 'old', name: 'Older', folder: '/work/older', lastOpenedAt: 10 }) },
        { endpointId: 'local', summary: summary({ projectId: 'new', name: 'Newer', folder: '/work/newer', lastOpenedAt: 20 }) },
        { endpointId: 'local', summary: summary({ projectId: 'bare', name: 'No folder', folder: null, lastOpenedAt: 30 }) },
        { endpointId: 'remote', summary: summary({ projectId: 'far', name: 'Elsewhere', folder: '/work/far', lastOpenedAt: 40 }) }
    ];

    test('home and the recent folders of this machine only, newest first', () => {
        const rows = shortcutsFor({ endpointId: 'local', home: '/home/bas', current: null, projects, sep: '/' });
        expect(rows).toEqual([
            { id: 'home', group: 'home', label: 'Home', path: '/home/bas/', hint: null },
            { id: 'project-new', group: 'recent', label: 'Newer', path: '/work/newer/', hint: '/work/newer' },
            { id: 'project-old', group: 'recent', label: 'Older', path: '/work/older/', hint: '/work/older' }
        ]);
    });

    test('the open project sits on top, and is not listed again below', () => {
        const current = { name: 'Newer', folder: '/work/newer', endpointId: 'local' };
        const rows = shortcutsFor({ endpointId: 'local', home: '/home/bas', current, projects, sep: '/' });
        expect(rows.map((row) => row.id)).toEqual(['current', 'home', 'project-old']);
    });

    test('a project open on another machine is not a folder on this one', () => {
        const current = { name: 'Elsewhere', folder: '/work/far', endpointId: 'remote' };
        const rows = shortcutsFor({ endpointId: 'local', home: null, current, projects, sep: '/' });
        expect(rows.map((row) => row.id)).toEqual(['project-new', 'project-old']);
    });
});
