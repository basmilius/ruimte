import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { DatabaseAccessStore } from './agent-access.ts';

let home: string;

const newHome = tempHomes('ruimte-database-access-');

beforeEach(async () => {
    home = await newHome();
});

async function loaded(): Promise<DatabaseAccessStore> {
    const store = new DatabaseAccessStore(home);
    await store.load();
    return store;
}

describe('what agents may do with a database', () => {
    test('reads a connection nobody set', async () => {
        const store = await loaded();
        expect(store.levelOf('p1', 'shop', 'a')).toBe('read');
    });

    test('keeps what a person set across a restart, under the machine home', async () => {
        const store = await loaded();
        await store.set('p1', 'shop', { access: 'write', destination: 'a' });
        await store.set('p1', 'audit', { access: 'off' });
        expect(await readdir(join(home, 'database-access'))).toEqual(['p1.json']);

        const again = await loaded();
        expect(again.levelOf('p1', 'shop', 'a')).toBe('write');
        expect(again.levelOf('p1', 'audit', 'a')).toBe('off');
        expect(again.levelOf('p2', 'shop', 'a')).toBe('read');
    });

    test('a write holds only for the destination it was granted for', async () => {
        const store = await loaded();
        await store.set('p1', 'shop', { access: 'write', destination: 'a' });
        expect(store.levelOf('p1', 'shop', 'b')).toBe('read');
        expect(store.levelOf('p1', 'shop', 'a')).toBe('write');
    });

    test('a write written before grants were bound to a destination never holds', async () => {
        await mkdir(join(home, 'database-access'));
        await writeFile(join(home, 'database-access', 'p1.json'), JSON.stringify({ projectId: 'p1', connections: { shop: 'write', audit: 'off' } }));
        const store = await loaded();
        expect(store.levelOf('p1', 'shop', 'a')).toBe('read');
        expect(store.levelOf('p1', 'audit', 'a')).toBe('off');
    });

    test('setting read takes the entry out, and the file with the last one', async () => {
        const store = await loaded();
        await store.set('p1', 'shop', { access: 'off' });
        await store.set('p1', 'shop', { access: 'read' });
        expect(await readdir(join(home, 'database-access'))).toEqual([]);
        expect((await loaded()).levelOf('p1', 'shop', 'a')).toBe('read');
    });

    test('a change of the connections drops a connection that is gone and a write that points elsewhere', async () => {
        const store = await loaded();
        await store.set('p1', 'shop', { access: 'write', destination: 'a' });
        await store.set('p1', 'audit', { access: 'off' });
        await store.set('p1', 'logs', { access: 'write', destination: 'c' });

        expect(await store.keep('p1', { shop: 'a', audit: 'x', logs: 'c' })).toBe(false);
        expect(await store.keep('p1', { shop: 'b', logs: 'c' })).toBe(true);
        expect(store.levelOf('p1', 'logs', 'c')).toBe('write');

        expect(await store.keep('p1', { shop: 'a', audit: 'x', logs: 'c' })).toBe(false);
        const again = await loaded();
        expect(again.levelOf('p1', 'shop', 'a')).toBe('read');
        expect(again.levelOf('p1', 'audit', 'x')).toBe('read');
        expect(again.levelOf('p1', 'logs', 'c')).toBe('write');
    });
});
