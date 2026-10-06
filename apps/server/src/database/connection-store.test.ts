import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseConnection } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import type { SessionEvent } from '../sessions/manager.ts';
import { DatabaseConnectionStore } from './connection-store.ts';

let root: string;
let folder: string;
let fake: FakeWatch;
let store: DatabaseConnectionStore;
let holders: string[];
let seen: Record<string, SessionEvent[]>;

function sharedPath(): string {
    return join(folder, '.ruimte', 'databases.json');
}

function privatePath(): string {
    return join(folder, '.ruimte', 'private', 'databases.json');
}

function exists(path: string): Promise<boolean> {
    return stat(path).then(
        () => true,
        () => false
    );
}

async function readJson(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function shop(): DatabaseConnection {
    return { id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: join(folder, 'data', 'shop.sqlite') }, shared: true };
}

function docker(): DatabaseConnection {
    return {
        id: 'docker',
        name: 'Docker',
        config: { engine: 'mysql', host: '', user: 'root', password: 'secret', tunnel: { kind: 'docker', container: 'shop-db-1' } },
        shared: false
    };
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-databases-'));
    folder = join(root, 'repo');
    await mkdir(join(folder, '.ruimte', 'private'), { recursive: true });
    fake = new FakeWatch();
    holders = ['c1', 'c2'];
    store = new DatabaseConnectionStore({
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), holdersOf: (projectId) => (projectId === 'p1' ? holders : []) },
        seams: fake
    });
    seen = { c1: [], c2: [], c3: [] };
    for (const clientId of Object.keys(seen)) {
        store.subscribe(clientId, (event) => seen[clientId]!.push(event));
    }
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('DatabaseConnectionStore', () => {
    test('a project without connections reads empty and writes nothing', async () => {
        expect(await store.read('p1', 'c1')).toEqual({ rev: 0, connections: [] });
        expect(await exists(sharedPath())).toBe(false);
        expect(await exists(privatePath())).toBe(false);
    });

    test('a client that does not hold the project reads nothing', async () => {
        await expect(store.read('p1', 'c3')).rejects.toMatchObject({ code: 'project-not-found' });
        await expect(store.read('p2', 'c1')).rejects.toMatchObject({ code: 'project-not-found' });
        await expect(store.save('p1', 0, [shop()], 'c3')).rejects.toMatchObject({ code: 'project-not-found' });
    });

    test('a save splits the connections over the two files and never writes a password', async () => {
        const saved = await store.save('p1', 0, [docker(), shop()], 'c1');
        expect(saved.rev).toBe(1);

        expect(await readJson(sharedPath())).toEqual({
            version: 1,
            connections: [{ id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: 'data/shop.sqlite' } }]
        });
        expect(await readJson(privatePath())).toEqual({
            version: 1,
            rev: 1,
            connections: [
                { id: 'docker', name: 'Docker', config: { engine: 'mysql', host: '', user: 'root', tunnel: { kind: 'docker', container: 'shop-db-1' } } }
            ],
            order: ['docker', 'shop']
        });
        expect(await readFile(join(folder, '.ruimte', '.gitignore'), 'utf8')).toContain('private/');

        const { password: _password, ...withoutPassword } = docker().config;
        const expected = [{ ...docker(), config: withoutPassword }, shop()];
        expect(saved.connections).toEqual(expected);
        expect(await store.read('p1', 'c1')).toEqual({ rev: 1, connections: expected });
    });

    test('a SQLite file outside the folder stays absolute and cannot be shared', async () => {
        const outside: DatabaseConnection = { id: 'local', name: 'Local', config: { engine: 'sqlite', path: join(root, 'elsewhere.sqlite') }, shared: true };
        await expect(store.save('p1', 0, [outside], 'c1')).rejects.toMatchObject({ code: 'path-outside-project' });
        expect(await exists(privatePath())).toBe(false);

        await store.save('p1', 0, [{ ...outside, shared: false }], 'c1');
        expect((await readJson(privatePath())).connections).toEqual([
            { id: 'local', name: 'Local', config: { engine: 'sqlite', path: join(root, 'elsewhere.sqlite') } }
        ]);
        expect(await exists(sharedPath())).toBe(false);
    });

    test('a folder that only shares its name with the project is outside it', async () => {
        const sibling: DatabaseConnection = { id: 'old', name: 'Old', config: { engine: 'sqlite', path: `${folder}-old/app.sqlite` }, shared: true };
        await expect(store.save('p1', 0, [sibling], 'c1')).rejects.toMatchObject({ code: 'path-outside-project' });
    });

    test('a relative SQLite path on the wire is refused', async () => {
        const relative: DatabaseConnection = { id: 'rel', name: 'Rel', config: { engine: 'sqlite', path: 'data/shop.sqlite' }, shared: false };
        await expect(store.save('p1', 0, [relative], 'c1')).rejects.toMatchObject({ code: 'connections-invalid' });
    });

    test('two connections under one id are refused', async () => {
        await expect(store.save('p1', 0, [shop(), { ...docker(), id: 'shop' }], 'c1')).rejects.toMatchObject({ code: 'connections-invalid' });
    });

    test('a save against an old rev is refused', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        await expect(store.save('p1', 0, [docker()], 'c2')).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a save tells the other holders and not the client it answers', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        expect(seen.c1).toEqual([]);
        expect(seen.c2).toEqual([{ event: 'database.connections.changed', payload: { projectId: 'p1', rev: 1, connections: [shop()] } }]);
        expect(seen.c3).toEqual([]);
    });

    test('a write the watcher reports is taken in and moves the rev', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        await writeFile(
            sharedPath(),
            JSON.stringify({ version: 1, connections: [{ id: 'shop', name: 'Pulled', config: { engine: 'sqlite', path: 'data/shop.sqlite' } }] })
        );
        fake.on(join(folder, '.ruimte')).emit('databases.json');
        await fake.settle();

        const pulled = { ...shop(), name: 'Pulled' };
        expect(seen.c1.at(-1)).toEqual({ event: 'database.connections.changed', payload: { projectId: 'p1', rev: 2, connections: [pulled] } });
        expect(await store.read('p1', 'c1')).toEqual({ rev: 2, connections: [pulled] });
        await expect(store.save('p1', 1, [shop()], 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
    });

    test('a write the watcher has not reported yet refuses the save and is taken in', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        await writeFile(
            sharedPath(),
            JSON.stringify({ version: 1, connections: [{ id: 'shop', name: 'Pulled', config: { engine: 'sqlite', path: 'data/shop.sqlite' } }] })
        );
        await expect(store.save('p1', 1, [shop()], 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect((await store.read('p1', 'c1')).connections[0]!.name).toBe('Pulled');
    });

    test('a file that does not parse is never written over', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        await writeFile(sharedPath(), '{ "version": 1, <<<<<<< HEAD');
        await expect(store.save('p1', 1, [docker()], 'c1')).rejects.toMatchObject({ code: 'rev-conflict' });
        expect(await readFile(sharedPath(), 'utf8')).toBe('{ "version": 1, <<<<<<< HEAD');
    });

    test('a file from a newer Ruimte is refused and left as it is', async () => {
        const newer = JSON.stringify({ version: 9, connections: [{ id: 'pg', engine: 'postgres' }] });
        await writeFile(sharedPath(), newer);
        await expect(store.read('p1', 'c1')).rejects.toMatchObject({ code: 'connections-invalid' });
        expect(await readFile(sharedPath(), 'utf8')).toBe(newer);
    });

    test('a newer private file refuses a save and stays untouched', async () => {
        await store.save('p1', 0, [docker()], 'c1');
        const newer = JSON.stringify({ version: 2, rev: 7, connections: [] });
        await writeFile(privatePath(), newer);
        await expect(store.save('p1', 1, [docker()], 'c1')).rejects.toMatchObject({ code: 'connections-invalid' });
        expect(await readFile(privatePath(), 'utf8')).toBe(newer);
    });

    test('an entry this release cannot read and an unknown field survive a save', async () => {
        const postgres = { id: 'pg', name: 'Analytics', config: { engine: 'postgres', host: 'db' } };
        const climbing = { id: 'up', name: 'Up', config: { engine: 'sqlite', path: '../other/app.sqlite' } };
        await writeFile(
            sharedPath(),
            JSON.stringify({
                version: 1,
                team: 'web',
                connections: [{ id: 'shop', name: 'Shop', color: 'green', config: { engine: 'sqlite', path: 'data/shop.sqlite' } }, postgres, climbing]
            })
        );
        const read = await store.read('p1', 'c1');
        expect(read.connections).toEqual([{ ...shop(), color: 'green' }]);

        await store.save('p1', read.rev, read.connections, 'c1');
        const written = await readJson(sharedPath());
        expect(written.team).toBe('web');
        expect(written.connections).toEqual([
            { id: 'shop', name: 'Shop', color: 'green', config: { engine: 'sqlite', path: 'data/shop.sqlite' } },
            postgres,
            climbing
        ]);
    });

    test('moving a connection to this machine takes it out of the shared file', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        await store.save('p1', 1, [{ ...shop(), shared: false }], 'c1');
        expect((await readJson(sharedPath())).connections).toEqual([]);
        expect((await readJson(privatePath())).connections).toEqual([{ id: 'shop', name: 'Shop', config: { engine: 'sqlite', path: 'data/shop.sqlite' } }]);
    });

    test('a project that is let go stops watching and reads the files again', async () => {
        await store.save('p1', 0, [shop()], 'c1');
        store.closeProject('p1');
        expect(fake.openOn(join(folder, '.ruimte'))).toEqual([]);
        await writeFile(privatePath(), JSON.stringify({ version: 1, rev: 5, connections: [], order: [] }));
        expect((await store.read('p1', 'c1')).rev).toBe(5);
    });
});
