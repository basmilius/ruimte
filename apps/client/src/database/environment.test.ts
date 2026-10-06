import { describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { databaseBrowse, databaseFiles, databaseStorage, databaseStorageKey } from './environment.ts';

function memoryArea(): Map<string, string> & { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
    const items = new Map<string, string>();
    return Object.assign(items, {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    });
}

function bridge(): { bridge: DesktopBridge; asked: unknown[] } {
    const asked: unknown[] = [];
    return {
        asked,
        bridge: {
            chooseSavePath: async (request) => {
                asked.push(request);
                return '/Users/me/orders.csv';
            },
            chooseOpenPath: async (request) => {
                asked.push(request);
                return '/Users/me/import.tsv';
            }
        } as DesktopBridge
    };
}

describe('what the database views remember', () => {
    test('is kept per machine and project, since a connection id is only unique within its project', () => {
        const area = memoryArea();
        const one = databaseStorage(area, 'local', 'project-1');
        const other = databaseStorage(area, 'local', 'project-2');
        one.set('database:explorer:shop', '["shop"]');
        expect(one.get('database:explorer:shop')).toBe('["shop"]');
        expect(other.get('database:explorer:shop')).toBeNull();
        expect([...area.keys()]).toEqual([databaseStorageKey('local', 'project-1', 'database:explorer:shop')]);
        expect(databaseStorageKey('local', 'project-1', 'database:workbench')).toBe('ruimte.database:local:project-1:database:workbench');
        one.set('database:explorer:shop', null);
        expect(area.size).toBe(0);
    });

    test('storage that refuses forgets quietly', () => {
        const refusing = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('full');
            },
            removeItem: () => undefined
        };
        const storage = databaseStorage(refusing, 'local', 'p');
        expect(() => storage.set('a', 'b')).not.toThrow();
        expect(storage.get('a')).toBeNull();
        expect(databaseStorage(null, 'local', 'p').get('a')).toBeNull();
    });
});

describe('file dialogs', () => {
    test('are offered only for the machine this computer runs, with dialogs in the shell', async () => {
        const { bridge: shell, asked } = bridge();
        expect(databaseFiles('machine-2', shell)).toBeUndefined();
        expect(databaseFiles('local', null)).toBeUndefined();
        expect(databaseFiles('local', {} as DesktopBridge)).toBeUndefined();
        const files = databaseFiles('local', shell)!;
        expect(await files.save({ suggestedName: 'orders.csv', format: 'csv' })).toBe('/Users/me/orders.csv');
        expect(await files.open({ formats: ['csv', 'tsv'] })).toBe('/Users/me/import.tsv');
        expect(asked).toEqual([
            { suggestedName: 'orders.csv', extension: 'csv' },
            { purpose: 'import', extensions: ['csv', 'tsv', 'tab'] }
        ]);
    });

    test('browse picks a database or an SSH key on this computer, and leaves typing to a person elsewhere', async () => {
        const { bridge: shell, asked } = bridge();
        expect(databaseBrowse('machine-2', shell)).toBeUndefined();
        await databaseBrowse('local', shell)!('identity');
        expect(asked).toEqual([{ purpose: 'identity' }]);
    });
});
