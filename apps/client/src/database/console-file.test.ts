import { beforeEach, describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import { fileTabOf, useFiles, type DatabaseTab, type FileTab } from '@/state/files';
import { TransportError } from '@/transport/transport';
import {
    consoleBaseName,
    consoleConnectionOf,
    consoleContext,
    consoleFileName,
    consoleFilesOf,
    consoleFolderOf,
    consolesFolderOf,
    createConsoleFile,
    isSqlPath,
    nextConsoleNumber,
    openConsoleFile
} from './console-file.ts';
import { consoleNameOf } from './console-folders.tsx';

describe('the name of a console file', () => {
    test('is the connection’s name with a number, in a folder of the connection in the private state of the project', () => {
        expect(consolesFolderOf('/repo')).toBe('/repo/.ruimte/private/consoles');
        expect(consoleFolderOf('/repo', 'shop')).toBe('/repo/.ruimte/private/consoles/shop');
        expect(consoleFolderOf('/repo', 'a/b ü')).toBe('/repo/.ruimte/private/consoles/a%2Fb%20%C3%BC');
        expect(consoleFileName(consoleBaseName('Shop (local)'), 2)).toBe('Shop (local) 2.sql');
    });

    test('says which connection a console runs on by its folder, and nothing for any other file', () => {
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/a%2Fb%20%C3%BC/q 1.sql')).toBe('a/b ü');
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/shop/notes.txt')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/shop/old/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/queries/q 1.sql')).toBeNull();
        expect(consoleConnectionOf('/repo', '/repo/.ruimte/private/consoles/%E0%A4/q.sql')).toBeNull();
    });

    test('groups a listing of the consoles by connection', () => {
        const base = '/repo/.ruimte/private/consoles';
        const listing = [
            { path: `${base}/logs`, kind: 'directory' },
            { path: `${base}/shop`, kind: 'directory' },
            { path: `${base}/logs/logs 1.sql`, kind: 'file' },
            { path: `${base}/shop/shop 1.sql`, kind: 'file' },
            { path: `${base}/shop/shop 2.sql`, kind: 'file' },
            { path: `${base}/shop/readme.md`, kind: 'file' }
        ];
        expect(consoleFilesOf('/repo', listing)).toEqual({ logs: [`${base}/logs/logs 1.sql`], shop: [`${base}/shop/shop 1.sql`, `${base}/shop/shop 2.sql`] });
    });

    test('a typed name stays a console', () => {
        expect(consoleNameOf(' orders ')).toBe('orders.sql');
        expect(consoleNameOf('orders.SQL')).toBe('orders.SQL');
    });

    test('takes nothing a path or a file system would read otherwise', () => {
        expect(consoleBaseName('prod/eu: main?')).toBe('prod eu main');
        expect(consoleBaseName('..hidden')).toBe('hidden');
        expect(consoleBaseName('tab\there\u0000')).toBe('tab here');
        expect(consoleBaseName('  ')).toBe('console');
        expect(consoleBaseName('x'.repeat(200))).toHaveLength(80);
    });

    test('counts on from the highest console of that name, whatever else the folder holds', () => {
        expect(nextConsoleNumber('shop', [])).toBe(1);
        expect(nextConsoleNumber('shop', ['shop 1.sql', 'shop 3.sql', 'shop 02.sql', 'shop x.sql', 'shopping 9.sql', 'logs 7.sql', 'shop 4.txt'])).toBe(4);
    });

    test('only a `.sql` file runs as a console', () => {
        expect(isSqlPath('/repo/queries/report.SQL')).toBe(true);
        expect(isSqlPath('/repo/queries/report.sqlite')).toBe(false);
    });
});

describe('where a new console runs', () => {
    const table: DatabaseTab = { key: 'database:t', kind: 'structure', pinned: false, connectionId: 'shop', schema: 'shop', table: 'orders' };
    const console: FileTab = { key: '/repo/q.sql', path: '/repo/q.sql', pinned: false, console: { connectionId: 'logs', schema: 'app' } };

    test('on the tab in front, else the explorer’s selection, else the first connection', () => {
        expect(consoleContext({ tabs: [table], active: 't' }, null, ['logs', 'shop'])).toEqual({ connectionId: 'logs' });
        expect(consoleContext({ tabs: [table], active: table.key }, { connectionId: 'logs' }, ['logs', 'shop'])).toEqual({
            connectionId: 'shop',
            schema: 'shop'
        });
        expect(consoleContext({ tabs: [console], active: console.key }, null, ['logs', 'shop'])).toEqual({ connectionId: 'logs', schema: 'app' });
        expect(consoleContext({ tabs: [], active: null }, { connectionId: 'logs', schema: 'app' }, ['logs', 'shop'])).toEqual({
            connectionId: 'logs',
            schema: 'app'
        });
        expect(consoleContext({ tabs: [table], active: table.key }, null, [])).toBeNull();
    });
});

describe('making a console file', () => {
    const entry = (name: string): FsEntry => ({
        name,
        path: `/repo/.ruimte/private/consoles/shop/${name}`,
        kind: 'file',
        size: 0,
        mtime: 0,
        hidden: false,
        ignored: false
    });

    test('takes the next number, and steps past a name another window made in between', async () => {
        const created: string[] = [];
        const listed: unknown[] = [];
        const transport = {
            request: async (type: string, payload: { path: string }) => {
                if (type === 'fs.list') {
                    listed.push(payload);
                    return { path: payload.path, entries: [entry('shop 1.sql')], truncated: false };
                }
                if (payload.path.endsWith('/shop 2.sql')) {
                    throw new TransportError('exists', 'already there');
                }
                created.push(payload.path);
                return { size: 0, mtime: 0 };
            }
        };
        const path = await createConsoleFile(transport as never, '/repo', 'shop', 'shop', 'SELECT 1;');
        expect(path).toBe('/repo/.ruimte/private/consoles/shop/shop 3.sql');
        expect(created).toEqual([path]);
        // Git ignores the consoles, which the listing leaves out unless asked.
        expect(listed).toEqual([{ path: '/repo/.ruimte/private/consoles/shop', hidden: true }]);
    });

    test('starts at one in a project without consoles, and gives up on any other refusal', async () => {
        const transport = {
            request: async (type: string) => {
                if (type === 'fs.list') {
                    throw new TransportError('not-found', 'not there');
                }
                return { size: 0, mtime: 0 };
            }
        };
        expect(await createConsoleFile(transport as never, '/repo', 'shop', 'shop', '')).toBe('/repo/.ruimte/private/consoles/shop/shop 1.sql');
        const refusing = {
            request: async (type: string) => {
                if (type === 'fs.list') {
                    return { path: '', entries: [], truncated: false };
                }
                throw new TransportError('ruimte-state', 'not from here');
            }
        };
        await expect(createConsoleFile(refusing as never, '/repo', 'shop', 'shop', '')).rejects.toThrow('not from here');
    });
});

describe('a console opened from the tree', () => {
    const path = '/repo/.ruimte/private/consoles/shop/shop 1.sql';

    beforeEach(() => {
        useFiles.getState().load(null, { tabs: [], active: null, expandedDirs: [] });
    });

    test('opens bound to the connection of its folder, a click unpinned and a double click pinned', () => {
        openConsoleFile(path, 'shop', true);
        expect(fileTabOf(useFiles.getState(), path)).toEqual({ key: path, path, pinned: false, console: { connectionId: 'shop' } });
        openConsoleFile(path, 'shop', false);
        expect(fileTabOf(useFiles.getState(), path)?.pinned).toBe(true);
    });

    test('keeps the binding a tab it already has', () => {
        openConsoleFile(path, 'shop', true);
        useFiles.getState().setConsole(path, { connectionId: 'shop', schema: 'archive' });
        openConsoleFile(path, 'shop', true);
        expect(fileTabOf(useFiles.getState(), path)?.console).toEqual({ connectionId: 'shop', schema: 'archive' });
    });
});
