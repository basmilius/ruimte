import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseAccessStore } from './agent-access.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-database-access-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function loaded(): Promise<DatabaseAccessStore> {
    const store = new DatabaseAccessStore(home);
    await store.load();
    return store;
}

describe('what agents may do with a database', () => {
    test('reads a connection nobody set', async () => {
        const store = await loaded();
        expect(store.levelOf('p1', 'shop')).toBe('read');
        expect(store.levels('p1')).toEqual({});
    });

    test('keeps what a person set across a restart, under the machine home', async () => {
        const store = await loaded();
        expect(await store.set('p1', 'shop', 'write')).toEqual({ shop: 'write' });
        expect(await store.set('p1', 'audit', 'off')).toEqual({ shop: 'write', audit: 'off' });
        expect(await readdir(join(home, 'database-access'))).toEqual(['p1.json']);

        const again = await loaded();
        expect(again.levelOf('p1', 'shop')).toBe('write');
        expect(again.levelOf('p1', 'audit')).toBe('off');
        expect(again.levelOf('p2', 'shop')).toBe('read');
    });

    test('setting read takes the entry out, and the file with the last one', async () => {
        const store = await loaded();
        await store.set('p1', 'shop', 'off');
        expect(await store.set('p1', 'shop', 'read')).toEqual({});
        expect(await readdir(join(home, 'database-access'))).toEqual([]);
        expect((await loaded()).levelOf('p1', 'shop')).toBe('read');
    });
});
