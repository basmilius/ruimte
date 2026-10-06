import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection, DatabaseConnections, DatabaseConnectionsChangedEvent, DatabaseConnectionsSavePayload } from '@ruimte/contracts';
import { TransportError } from '@/transport/transport';
import { createDatabaseConnections, isOutsideProject, isSavable, keepUnchanged, type ConnectionsTarget } from './connections.ts';
import { memorySecretStore, secretKeyOf } from './secrets.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: '127.0.0.1', user: 'root' } };

/* A machine that keeps one project's connections, checks the rev of every save, and holds a save back while `hold` is set. */
function machine(initial: DatabaseConnections) {
    let document = initial;
    const saves: DatabaseConnectionsSavePayload[] = [];
    const changed = new Set<(event: DatabaseConnectionsChangedEvent) => void>();
    let held: Promise<void> | null = null;
    let release = (): void => undefined;
    const transport = {
        request: async (type: string, payload: unknown): Promise<unknown> => {
            if (type === 'database.connections') {
                return document;
            }
            const save = payload as DatabaseConnectionsSavePayload;
            saves.push(save);
            if (held !== null) {
                await held;
            }
            if (save.baseRev !== document.rev) {
                throw new TransportError('rev-conflict', 'The connections moved on');
            }
            document = { rev: document.rev + 1, connections: save.connections };
            return document;
        },
        on: (_event: string, handler: (event: DatabaseConnectionsChangedEvent) => void) => {
            changed.add(handler);
            return () => changed.delete(handler);
        },
        subscribeStatus: () => () => undefined
    } as unknown as ConnectionsTarget['transport'];
    return {
        transport,
        saves,
        document: () => document,
        /* Another client saved. */
        elsewhere(next: DatabaseConnection[]) {
            document = { rev: document.rev + 1, connections: next };
            for (const handler of changed) {
                handler({ projectId: 'p', ...document });
            }
        },
        hold() {
            held = new Promise((resolve) => {
                release = resolve;
            });
        },
        release() {
            held = null;
            release();
        }
    };
}

async function opened(initial: DatabaseConnections, secrets = memorySecretStore()) {
    const notes: string[] = [];
    const fake = machine(initial);
    const model = createDatabaseConnections({ secrets, notify: (title) => notes.push(title) });
    model.attach({ endpointId: 'local', projectId: 'p', transport: fake.transport });
    await model.ready();
    return { model, fake, notes, secrets };
}

describe('the connections of a project', () => {
    test('reads the list and the password of each from the secret store', async () => {
        const secrets = memorySecretStore();
        await secrets.write(secretKeyOf('local', 'p', 'shop'), 'hunter2');
        const { model } = await opened({ rev: 3, connections: [SHOP] }, secrets);
        expect(model.store.getState()).toMatchObject({ status: 'ready', rev: 3, saved: [SHOP], passwords: { shop: 'hunter2' } });
        expect(await model.ready()).toEqual([{ ...SHOP, config: { ...SHOP.config, password: 'hunter2' } }]);
    });

    test('saves an edit without its password, and keeps the password in the secret store', async () => {
        const { model, fake, secrets } = await opened({ rev: 1, connections: [] });
        await model.edit([{ ...SHOP, config: { ...SHOP.config, password: 'hunter2' } }]);
        expect(fake.saves).toEqual([{ projectId: 'p', baseRev: 1, connections: [SHOP] }]);
        expect(await secrets.read(secretKeyOf('local', 'p', 'shop'))).toBe('hunter2');
        expect(model.store.getState()).toMatchObject({ rev: 2, local: null, saved: [SHOP] });
    });

    test('a burst of edits is saved one at a time against the rev each answer gave', async () => {
        const { model, fake } = await opened({ rev: 1, connections: [] });
        fake.hold();
        const first = model.edit([SHOP]);
        void model.edit([{ ...SHOP, name: 'Sh' }]);
        void model.edit([{ ...SHOP, name: 'Shop two' }]);
        expect(model.store.getState().local).toEqual([{ ...SHOP, name: 'Shop two' }]);
        fake.release();
        await first;
        expect(fake.saves.map((save) => [save.baseRev, save.connections[0]?.name])).toEqual([
            [1, 'Shop'],
            [2, 'Shop two']
        ]);
        expect(model.store.getState()).toMatchObject({ rev: 3, local: null });
    });

    test('a new SQLite connection stays here until it has a whole path', async () => {
        const draft: DatabaseConnection = { id: 'cache', name: 'Cache', shared: false, config: { engine: 'sqlite', path: '' } };
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] });
        await model.edit([SHOP, draft]);
        expect(fake.saves.at(-1)?.connections).toEqual([SHOP]);
        expect(model.store.getState().local).toEqual([SHOP, draft]);
        await model.edit([SHOP, { ...draft, config: { engine: 'sqlite', path: '/repo/cache.db' } }]);
        expect(fake.saves.at(-1)?.connections.map((connection) => connection.id)).toEqual(['shop', 'cache']);
        expect(model.store.getState().local).toBeNull();
    });

    test('a save that finds the list moved on reads it again and says so, writing nothing over it', async () => {
        const { model, fake, notes } = await opened({ rev: 1, connections: [SHOP] });
        fake.hold();
        const saving = model.edit([{ ...SHOP, name: 'Mine' }]);
        fake.elsewhere([{ ...SHOP, name: 'Theirs' }]);
        fake.release();
        await saving;
        expect(fake.document().connections[0]?.name).toBe('Theirs');
        expect(model.store.getState()).toMatchObject({ rev: 2, local: null, saved: [{ ...SHOP, name: 'Theirs' }] });
        expect(notes).toHaveLength(1);
    });

    test('a change from elsewhere is taken as it comes, and drops an edit nobody saved with a word', async () => {
        const draft: DatabaseConnection = { id: 'cache', name: 'Cache', shared: false, config: { engine: 'sqlite', path: '' } };
        const { model, fake, notes } = await opened({ rev: 1, connections: [SHOP] });
        fake.elsewhere([{ ...SHOP, name: 'Theirs' }]);
        expect(model.store.getState()).toMatchObject({ rev: 2, saved: [{ ...SHOP, name: 'Theirs' }] });
        expect(notes).toHaveLength(0);
        await model.edit([SHOP, draft]);
        fake.elsewhere([SHOP]);
        expect(model.store.getState().local).toBeNull();
        expect(notes).toHaveLength(1);
    });

    test('a connection that is removed takes its password with it', async () => {
        const secrets = memorySecretStore();
        await secrets.write(secretKeyOf('local', 'p', 'shop'), 'hunter2');
        const { model } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        await model.edit([]);
        expect(await secrets.read(secretKeyOf('local', 'p', 'shop'))).toBeNull();
        expect(model.store.getState().passwords).toEqual({});
    });
});

describe('what may be saved and shared', () => {
    test('a SQLite file needs a whole path before the machine takes it', () => {
        expect(isSavable(SHOP)).toBe(true);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: '' } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: 'cache.db' } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: '/repo/cache.db' } })).toBe(true);
    });

    test('a SQLite file outside the project folder cannot be shared', () => {
        const file = (path: string): DatabaseConnection => ({ ...SHOP, config: { engine: 'sqlite', path } });
        expect(isOutsideProject('/repo', file('/repo/data/cache.db'))).toBe(false);
        expect(isOutsideProject('/repo', file('/Users/me/cache.db'))).toBe(true);
        expect(isOutsideProject('/repo', file('/repository/cache.db'))).toBe(true);
        expect(isOutsideProject(null, file('/repo/cache.db'))).toBe(true);
        expect(isOutsideProject('/repo', SHOP)).toBe(false);
    });
});

describe('the list the views get', () => {
    test('keeps the object of a connection that did not change, so its views stay as they are', () => {
        const other: DatabaseConnection = { ...SHOP, id: 'logs', name: 'Logs' };
        const next = keepUnchanged([SHOP, other], [{ ...SHOP }, { ...other, name: 'Logs two' }]);
        expect(next[0]).toBe(SHOP);
        expect(next[1]).not.toBe(other);
        expect(next[1]?.name).toBe('Logs two');
    });
});
