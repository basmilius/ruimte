import { describe, expect, test } from 'bun:test';
import type { Endpoint } from '@/state/endpoints';
import { browseMachines, folderPresence, joinPath, parentOf, separatorFor, startFolder } from './palette-browse';

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

    test('a root has nowhere to go', () => {
        expect(parentOf('/', '/')).toBeNull();
        expect(parentOf('C:\\', '\\')).toBeNull();
        expect(parentOf('~/', '/')).toBeNull();
        expect(parentOf('', '/')).toBeNull();
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

describe('startFolder', () => {
    test('the folder in hand, else the home of that machine, else the tilde the daemon expands', () => {
        expect(startFolder('/work/atlas', '/home/bas', '/')).toBe('/work/atlas/');
        expect(startFolder(null, '/home/bas', '/')).toBe('/home/bas/');
        expect(startFolder(null, null, '/')).toBe('~/');
        expect(startFolder(null, 'C:\\Users\\bas', '\\')).toBe('C:\\Users\\bas\\');
    });
});

const endpoint = (id: string, label: string): Endpoint => ({
    id,
    label,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id
});

describe('browseMachines', () => {
    const endpoints = [endpoint('local', 'This machine'), endpoint('daemon-b', 'Studio'), endpoint('daemon-c', 'Attic')];

    test('the machine being worked on comes first, the rest keep the list order', () => {
        const rows = browseMachines(endpoints, 'daemon-b', ['local', 'daemon-b']);
        expect(rows.map((row) => row.endpointId)).toEqual(['daemon-b', 'local', 'daemon-c']);
        expect(rows.map((row) => row.active)).toEqual([true, false, false]);
    });

    test('a machine without a socket is still a row, marked as one that has to be dialed', () => {
        const rows = browseMachines(endpoints, 'local', ['local']);
        expect(rows.map((row) => row.connected)).toEqual([true, false, false]);
    });
});
