import { describe, expect, test } from 'bun:test';
import type {
    DatabaseAgentAccess,
    DatabaseAgentAccessChangedEvent,
    DatabaseConnection,
    DatabaseConnections,
    DatabaseConnectionsChangedEvent,
    DatabaseConnectionsSavePayload
} from '@ruimte/contracts';
import { TransportError } from '@/transport/transport';
import { createDatabaseConnections, isOutsideProject, keepUnchanged, type ConnectionsTarget } from './connections.ts';
import { isSavable } from './savable.ts';
import { boundPasswordOf, memorySecretStore, passwordTarget, secretKeyOf, storedSecretOf, withheldPasswords, type DatabaseSecretStore } from './secrets.ts';

const SHOP: DatabaseConnection = { id: 'shop', name: 'Shop', shared: true, config: { engine: 'mysql', host: '127.0.0.1', user: 'root' } };

/* What the secret store holds after a person saved this password for the connection as it points now. */
async function savePassword(secrets: DatabaseSecretStore, connection: DatabaseConnection, password: string): Promise<void> {
    await secrets.write(secretKeyOf('local', 'p', connection.id), storedSecretOf(password, passwordTarget(connection.config)));
}

async function savedPassword(secrets: DatabaseSecretStore, id: string) {
    const secret = await secrets.read(secretKeyOf('local', 'p', id));
    return secret === null ? null : boundPasswordOf(secret);
}

function at(connection: DatabaseConnection, config: Record<string, unknown>): DatabaseConnection {
    return { ...connection, config: { ...connection.config, ...config } as DatabaseConnection['config'] };
}

/* Lets every pending promise run, without a timer. */
function drained(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/* A machine that keeps one project's connections, checks the rev of every save, and holds a save back while `hold` is set. */
function machine(initial: DatabaseConnections) {
    let document = initial;
    const saves: DatabaseConnectionsSavePayload[] = [];
    const handed: Record<string, string>[] = [];
    let access: Record<string, DatabaseAgentAccess> = {};
    const changed = new Set<(event: DatabaseConnectionsChangedEvent) => void>();
    const accessChanged = new Set<(event: DatabaseAgentAccessChangedEvent) => void>();
    let held: Promise<void> | null = null;
    let release = (): void => undefined;
    const transport = {
        request: async (type: string, payload: unknown): Promise<unknown> => {
            if (type === 'database.connections') {
                return document;
            }
            if (type === 'database.passwords') {
                handed.push((payload as { passwords: Record<string, string> }).passwords);
                return {};
            }
            if (type === 'database.agentAccess') {
                return { access };
            }
            if (type === 'database.agentAccess.set') {
                const set = payload as { connectionId: string; access: DatabaseAgentAccess };
                if (set.access === 'write') {
                    throw new TransportError('forbidden', 'Only a person on this machine can let agents write to a database');
                }
                access = { ...access, [set.connectionId]: set.access };
                return { access };
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
        on: (event: string, handler: (event: never) => void) => {
            const listeners = (event === 'database.agentAccess.changed' ? accessChanged : changed) as Set<(event: never) => void>;
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        subscribeStatus: () => () => undefined
    } as unknown as ConnectionsTarget['transport'];
    return {
        transport,
        saves,
        handed,
        /* Another client set what agents may do. */
        accessElsewhere(next: Record<string, DatabaseAgentAccess>) {
            access = next;
            for (const handler of accessChanged) {
                handler({ projectId: 'p', access });
            }
        },
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
        await savePassword(secrets, SHOP, 'hunter2');
        const { model } = await opened({ rev: 3, connections: [SHOP] }, secrets);
        expect(model.store.getState()).toMatchObject({
            status: 'ready',
            rev: 3,
            saved: [SHOP],
            passwords: { shop: { password: 'hunter2', target: passwordTarget(SHOP.config) } }
        });
        expect(await model.ready()).toEqual([{ ...SHOP, config: { ...SHOP.config, password: 'hunter2' } }]);
    });

    test('saves an edit without its password, and keeps the password in the secret store', async () => {
        const { model, fake, secrets } = await opened({ rev: 1, connections: [] });
        await model.edit([{ ...SHOP, config: { ...SHOP.config, password: 'hunter2' } }]);
        expect(fake.saves).toEqual([{ projectId: 'p', baseRev: 1, connections: [SHOP] }]);
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'hunter2', target: passwordTarget(SHOP.config) });
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

    test('a saved connection that became a draft stays on the machine as it was until it is whole again', async () => {
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] });
        const cleared: DatabaseConnection = { ...SHOP, config: { ...SHOP.config, host: '' } };
        await model.edit([cleared]);
        expect(fake.document().connections).toEqual([SHOP]);
        expect(model.store.getState().local).toEqual([cleared]);
        const moved: DatabaseConnection = { ...SHOP, config: { ...SHOP.config, host: 'db.internal' } };
        await model.edit([moved]);
        expect(fake.document().connections).toEqual([moved]);
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

    test('shows the connections only once their passwords are read, so nothing opens one without its password', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        let asked = (): void => undefined;
        const reading = new Promise<void>((resolve) => {
            asked = resolve;
        });
        let release = (): void => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slow = {
            ...secrets,
            read: async (key: string) => {
                asked();
                await held;
                return secrets.read(key);
            }
        };
        const fake = machine({ rev: 1, connections: [SHOP] });
        const model = createDatabaseConnections({ secrets: slow, notify: () => undefined });
        model.attach({ endpointId: 'local', projectId: 'p', transport: fake.transport });
        const ready = model.ready();
        await reading;
        expect(model.store.getState()).toMatchObject({ status: 'loading', saved: [] });
        release();
        expect(await ready).toEqual([{ ...SHOP, config: { ...SHOP.config, password: 'hunter2' } }]);
        expect(model.store.getState().status).toBe('ready');
    });

    test('a connection new to this window comes in with its password, and a later change is not overtaken by it', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, { ...SHOP, id: 'logs' }, 'swordfish');
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        const logs: DatabaseConnection = { ...SHOP, id: 'logs', name: 'Logs' };
        fake.elsewhere([SHOP, logs]);
        expect(model.store.getState().saved).toEqual([SHOP]);
        await drained();
        expect(model.list(model.store.getState()).find((connection) => connection.id === 'logs')?.config.password).toBe('swordfish');

        const cache: DatabaseConnection = { id: 'cache', name: 'Cache', shared: false, config: { engine: 'sqlite', path: '/repo/cache.db' } };
        fake.elsewhere([SHOP, logs, cache]);
        fake.elsewhere([SHOP]);
        expect(model.store.getState().saved).toEqual([SHOP]);
        await drained();
        expect(model.store.getState().saved).toEqual([SHOP]);
    });

    test('a connection that is removed takes its password with it', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        await model.edit([]);
        expect(await savedPassword(secrets, 'shop')).toBeNull();
        expect(model.store.getState().passwords).toEqual({});
    });
});

describe('a password and the address it was saved for', () => {
    const evil = at(SHOP, { host: 'db.evil.example' });

    test('a connection pointed elsewhere outside this window opens without its password, and gets it back where it was saved for', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model, fake } = await opened({ rev: 1, connections: [evil] }, secrets);
        expect(model.list(model.store.getState())[0]!.config).not.toHaveProperty('password');
        expect(withheldPasswords(model.list(model.store.getState()), model.store.getState().passwords)).toEqual({ shop: 'moved' });
        expect(fake.handed).toEqual([{}]);

        fake.elsewhere([SHOP]);
        expect(model.list(model.store.getState())[0]!.config.password).toBe('hunter2');
        fake.elsewhere([at(SHOP, { port: 3307 })]);
        expect(model.list(model.store.getState())[0]!.config).not.toHaveProperty('password');
        expect(fake.handed).toEqual([{}]);
    });

    test('a password saved before addresses were kept is asked for again, and typing it saves it for the address', async () => {
        const secrets = memorySecretStore();
        await secrets.write(secretKeyOf('local', 'p', 'shop'), 'hunter2');
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        expect(model.list(model.store.getState())[0]!.config).not.toHaveProperty('password');
        expect(withheldPasswords(model.list(model.store.getState()), model.store.getState().passwords)).toEqual({ shop: 'unbound' });
        expect(fake.handed).toEqual([{}]);

        await model.edit([at(SHOP, { password: 'hunter2' })]);
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'hunter2', target: passwordTarget(SHOP.config) });
        expect(fake.handed.at(-1)).toEqual({ shop: 'hunter2' });
    });

    test('a person who moves a connection with its password in the form takes the password along', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        const [shown] = model.list(model.store.getState());
        await model.edit([at(shown!, { host: 'db.internal' })]);
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'hunter2', target: passwordTarget(at(SHOP, { host: 'db.internal' }).config) });
        expect(model.list(model.store.getState())[0]!.config).toMatchObject({ host: 'db.internal', password: 'hunter2' });
        expect(fake.handed.at(-1)).toEqual({ shop: 'hunter2' });
    });

    test('an edit that leaves a held-back password out of the form keeps it for where it was saved for', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model, fake } = await opened({ rev: 1, connections: [evil] }, secrets);
        await model.edit(model.list(model.store.getState()).map((connection) => ({ ...connection, name: 'Shop two' })));
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'hunter2', target: passwordTarget(SHOP.config) });
        expect(model.list(model.store.getState())[0]!.config).not.toHaveProperty('password');
        expect(fake.handed.every((passwords) => passwords.shop === undefined)).toBe(true);

        await model.edit([at({ ...evil, name: 'Shop two' }, { password: 'correct horse' })]);
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'correct horse', target: passwordTarget(evil.config) });
        expect(fake.handed.at(-1)).toEqual({ shop: 'correct horse' });
    });

    test('a password the form showed and a person cleared is gone', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        await model.edit([SHOP]);
        expect(await savedPassword(secrets, 'shop')).toBeNull();
        expect(model.store.getState().passwords).toEqual({});
    });
});

describe('a secret store that fails', () => {
    function failing(secrets: DatabaseSecretStore, fail: { read?: boolean; write?: boolean }): DatabaseSecretStore {
        return {
            ...secrets,
            read: async (key) => {
                if (fail.read === true) {
                    throw new Error('The keychain is locked');
                }
                return secrets.read(key);
            },
            write: async (key, secret) => {
                if (fail.write === true) {
                    throw new Error('The disk is full');
                }
                return secrets.write(key, secret);
            }
        };
    }

    async function noted(initial: DatabaseConnections, secrets: DatabaseSecretStore) {
        const notes: { title: string; description: string; id?: string }[] = [];
        const fake = machine(initial);
        const model = createDatabaseConnections({ secrets, notify: (title, description, id) => notes.push({ title, description, id }) });
        model.attach({ endpointId: 'local', projectId: 'p', transport: fake.transport });
        await model.ready();
        return { model, fake, notes };
    }

    test('a password that cannot be read is said, the connection opens without it, and the next read tries again', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const fail = { read: true };
        const { model, notes } = await noted({ rev: 1, connections: [SHOP] }, failing(secrets, fail));
        expect(model.store.getState().status).toBe('ready');
        expect(model.list(model.store.getState())[0]!.config).not.toHaveProperty('password');
        expect(notes).toEqual([
            { title: 'Could not read the saved password of Shop', description: 'The keychain is locked', id: 'database-secrets-readFailed' }
        ]);

        fail.read = false;
        await model.reload();
        expect(model.list(model.store.getState())[0]!.config.password).toBe('hunter2');
    });

    test('a password that cannot be saved is said, works in this window, and is saved with the next edit', async () => {
        const secrets = memorySecretStore();
        const fail = { write: true };
        const { model, fake, notes } = await noted({ rev: 1, connections: [] }, failing(secrets, fail));
        await model.edit([at(SHOP, { password: 'hunter2' })]);
        expect(fake.document().connections).toEqual([SHOP]);
        expect(model.list(model.store.getState())[0]!.config.password).toBe('hunter2');
        expect(notes).toEqual([
            { title: 'The password of Shop was not saved on this computer', description: 'The disk is full', id: 'database-secrets-writeFailed' }
        ]);
        expect(await savedPassword(secrets, 'shop')).toBeNull();

        fail.write = false;
        await model.edit([{ ...at(SHOP, { password: 'hunter2' }), name: 'Shop two' }]);
        expect(await savedPassword(secrets, 'shop')).toEqual({ password: 'hunter2', target: passwordTarget(SHOP.config) });
        expect(notes).toHaveLength(1);
    });

    test('a password that cannot be removed with its connection is said', async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model, notes } = await noted({ rev: 1, connections: [SHOP] }, failing(secrets, { write: true }));
        await model.edit([]);
        expect(notes).toEqual([
            { title: 'The password of Shop was not removed from this computer', description: 'The disk is full', id: 'database-secrets-removeFailed' }
        ]);
    });
});

describe('what the agents of the project get', () => {
    test("the machine gets the passwords on a load and after a person's edit, never after a change from elsewhere", async () => {
        const secrets = memorySecretStore();
        await savePassword(secrets, SHOP, 'hunter2');
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] }, secrets);
        expect(fake.handed).toEqual([{ shop: 'hunter2' }]);

        fake.elsewhere([{ ...SHOP, config: { ...SHOP.config, host: 'evil.example.com' } }]);
        await Promise.resolve();
        expect(fake.handed).toHaveLength(1);

        await model.edit([{ ...SHOP, config: { ...SHOP.config, password: 'correct horse' } }]);
        expect(fake.handed.at(-1)).toEqual({ shop: 'correct horse' });
        await model.edit([{ ...SHOP, name: 'Shop two', config: { ...SHOP.config, password: 'correct horse' } }]);
        expect(fake.handed).toHaveLength(2);

        await model.reload();
        expect(fake.handed).toHaveLength(3);
    });

    test('reads what agents may do, sets it, and follows another client', async () => {
        const { model, fake } = await opened({ rev: 1, connections: [SHOP] });
        expect(model.store.getState().agentAccess).toEqual({});
        await model.setAgentAccess('shop', 'off');
        expect(model.store.getState().agentAccess).toEqual({ shop: 'off' });
        fake.accessElsewhere({ shop: 'write' });
        expect(model.store.getState().agentAccess).toEqual({ shop: 'write' });
    });

    test('a refused change says so and leaves what agents may do as it was', async () => {
        const { model, notes } = await opened({ rev: 1, connections: [SHOP] });
        await model.setAgentAccess('shop', 'write');
        expect(model.store.getState().agentAccess).toEqual({});
        expect(notes).toEqual(['Could not change what agents may do']);
    });
});

describe('what may be saved and shared', () => {
    test('a SQLite file needs a whole path before the machine takes it', () => {
        expect(isSavable(SHOP)).toBe(true);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: '' } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: 'cache.db' } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { engine: 'sqlite', path: '/repo/cache.db' } })).toBe(true);
    });

    test('a server needs what the form asks for before the machine takes it', () => {
        expect(isSavable({ ...SHOP, config: { ...SHOP.config, host: '' } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { ...SHOP.config, port: 70_000 } })).toBe(false);
        expect(isSavable({ ...SHOP, config: { ...SHOP.config, tunnel: { kind: 'docker', container: '' } } })).toBe(false);
        expect(isSavable({ ...SHOP, id: '' })).toBe(false);
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
