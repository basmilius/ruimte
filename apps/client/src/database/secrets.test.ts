import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection } from '@ruimte/contracts';
import {
    bindPasswords,
    boundPasswordOf,
    databaseSecretStore,
    memorySecretStore,
    passwordTarget,
    secretKeyOf,
    secretWrites,
    splitPasswords,
    storedSecretOf,
    withheldPasswords,
    withPasswords,
    type SavedPassword
} from './secrets.ts';

const server: DatabaseConnection = {
    id: 'shop',
    name: 'Shop',
    shared: true,
    config: { engine: 'mysql', host: '127.0.0.1', user: 'root', password: 'hunter2' }
};
const file: DatabaseConnection = { id: 'cache', name: 'Cache', shared: false, config: { engine: 'sqlite', path: '/repo/cache.db' } };

/* A password saved for where the connection points now. */
function savedFor(connection: DatabaseConnection, password: string): SavedPassword {
    return { password, target: passwordTarget(connection.config) };
}

function moved(connection: DatabaseConnection, config: Record<string, unknown>): DatabaseConnection {
    return { ...connection, config: { ...connection.config, ...config } as DatabaseConnection['config'] };
}

describe('passwords beside the connections', () => {
    test('splits the password off, so the list a file holds has none', () => {
        const { connections, passwords } = splitPasswords([server, file]);
        expect(connections[0]!.config).toEqual({ engine: 'mysql', host: '127.0.0.1', user: 'root' });
        expect(connections[1]).toBe(file);
        expect(passwords).toEqual({ shop: 'hunter2' });
    });

    test('an empty password field is no password', () => {
        const blank = { ...server, config: { ...server.config, password: '' } };
        expect(splitPasswords([blank]).passwords).toEqual({});
        expect(splitPasswords([blank]).connections[0]!.config).not.toHaveProperty('password');
    });

    test('merges a saved password into a server that has none and points where it was saved for, and leaves a file and a typed password alone', () => {
        const { connections } = splitPasswords([server, file]);
        expect(withPasswords(connections, { shop: savedFor(server, 'hunter2'), cache: savedFor(file, 'nope') })).toEqual([server, file]);
        expect(withPasswords([server], { shop: savedFor(server, 'other') })[0]!.config.password).toBe('hunter2');
        expect(withPasswords(connections, {})[0]!.config).not.toHaveProperty('password');
    });

    test('keeps a password out of a server that points elsewhere than it was saved for, and says why', () => {
        const [bare] = splitPasswords([server]).connections;
        const elsewhere = moved(bare!, { host: 'db.evil.example' });
        expect(withPasswords([elsewhere], { shop: savedFor(server, 'hunter2') })[0]!.config).not.toHaveProperty('password');
        expect(withheldPasswords([elsewhere], { shop: savedFor(server, 'hunter2') })).toEqual({ shop: 'moved' });
        expect(withheldPasswords([bare!], { shop: savedFor(server, 'hunter2') })).toEqual({});
        expect(withheldPasswords([file], { cache: savedFor(server, 'hunter2') })).toEqual({});
    });

    test('a password saved before addresses were kept opens nothing and is asked for again', () => {
        const [bare] = splitPasswords([server]).connections;
        const plain = boundPasswordOf('hunter2');
        expect(plain).toEqual({ password: 'hunter2', target: null });
        expect(withPasswords([bare!], { shop: plain })[0]!.config).not.toHaveProperty('password');
        expect(withheldPasswords([bare!], { shop: plain })).toEqual({ shop: 'unbound' });
    });

    test('the round trip gives back what a person typed', () => {
        const { connections } = splitPasswords([server, file]);
        expect(withPasswords(connections, bindPasswords([], {}, [server, file]))).toEqual([server, file]);
    });

    test('the store hears of a changed, moved or cleared password and of a connection that went', () => {
        const old = savedFor(server, 'old');
        expect(secretWrites({ shop: old, gone: savedFor(file, 'x') }, { shop: savedFor(server, 'new') }, ['shop', 'cache'])).toEqual([
            { id: 'shop', secret: savedFor(server, 'new') },
            { id: 'gone', secret: null }
        ]);
        const there = savedFor(moved(server, { port: 3307 }), 'old');
        expect(secretWrites({ shop: old }, { shop: there }, ['shop'])).toEqual([{ id: 'shop', secret: there }]);
        expect(secretWrites({ shop: old }, {}, ['shop'])).toEqual([{ id: 'shop', secret: null }]);
        expect(secretWrites({ shop: old }, { shop: { ...old } }, ['shop'])).toEqual([]);
        expect(secretWrites({ shop: boundPasswordOf('plain') }, { shop: boundPasswordOf('plain') }, ['shop'])).toEqual([]);
    });

    test('an edit saves a password for where the person left its connection, and keeps one the form never showed for the address it was saved for', () => {
        const [bare] = splitPasswords([server]).connections;
        const saved = { shop: savedFor(server, 'hunter2') };
        const elsewhere = moved(server, { host: 'db.internal' });
        expect(bindPasswords([bare!], saved, [elsewhere])).toEqual({ shop: savedFor(elsewhere, 'hunter2') });
        expect(bindPasswords([bare!], saved, [moved(bare!, { password: undefined })])).toEqual({});

        const pointedAway = moved(bare!, { host: 'db.evil.example' });
        expect(bindPasswords([pointedAway], saved, [{ ...pointedAway, name: 'Shop two' }])).toEqual(saved);
        expect(bindPasswords([pointedAway], saved, [bare!])).toEqual(saved);
        expect(bindPasswords([pointedAway], saved, [moved(pointedAway, { password: 'new' })])).toEqual({ shop: savedFor(pointedAway, 'new') });
        expect(bindPasswords([pointedAway], saved, [])).toEqual({});
    });

    test('a key names the machine, the project and the connection', () => {
        expect(secretKeyOf('local', 'project-1', 'shop')).toBe('local/project-1/shop');
    });

    test('without the shell a password lives in the page and nowhere else', async () => {
        const store = memorySecretStore();
        await store.write('a', 'secret');
        expect(await store.read('a')).toBe('secret');
        await store.write('a', null);
        expect(await store.read('a')).toBeNull();
        expect(databaseSecretStore(null)).toBe(databaseSecretStore(null));
    });
});

describe('the address a password is saved for', () => {
    const base = { engine: 'mysql', host: 'db.internal', port: 3306, user: 'app', tls: 'prefer' } as const;
    const target = (config: Record<string, unknown>): string => passwordTarget(config as DatabaseConnection['config']);

    test('changes with every field that decides where the password goes and how', () => {
        const changes: Record<string, unknown>[] = [
            { host: 'db.evil.example' },
            { port: 3307 },
            { socket: '/tmp/mysql.sock' },
            { user: 'root' },
            { tls: 'disable' },
            { tunnel: { kind: 'ssh', host: 'bastion' } },
            { tunnel: { kind: 'docker', container: 'db' } }
        ];
        for (const change of changes) {
            expect(target({ ...base, ...change })).not.toBe(target(base));
        }
        expect(target({ engine: 'sqlite', path: '/repo/cache.db' })).not.toBe(target(base));
    });

    test('changes with every field of a tunnel', () => {
        const ssh = { kind: 'ssh', host: 'bastion', port: 22, user: 'deploy', identityFile: '~/.ssh/id_ed25519' };
        for (const change of [{ host: 'other' }, { port: 2222 }, { user: 'root' }, { identityFile: '~/.ssh/other' }]) {
            expect(target({ ...base, tunnel: { ...ssh, ...change } })).not.toBe(target({ ...base, tunnel: ssh }));
        }
        const docker = { kind: 'docker', container: 'db', port: 3306, context: 'colima' };
        for (const change of [{ container: 'other' }, { port: 3307 }, { context: 'default' }]) {
            expect(target({ ...base, tunnel: { ...docker, ...change } })).not.toBe(target({ ...base, tunnel: docker }));
        }
    });

    test('stays with the name, the database and read only, and with the order of the fields', () => {
        expect(target({ ...base, database: 'shop', readOnly: true })).toBe(target(base));
        expect(target({ tls: 'prefer', user: 'app', port: 3306, host: 'db.internal', engine: 'mysql' })).toBe(target(base));
        expect(target({ ...base, password: 'hunter2' })).toBe(target(base));
        const [bare] = splitPasswords([server]).connections;
        expect(withPasswords([{ ...bare!, name: 'Renamed' }], { shop: savedFor(server, 'hunter2') })[0]!.config.password).toBe('hunter2');
    });

    test('writes out the defaults, so leaving a field out is the same address', () => {
        expect(target({ engine: 'mysql', host: 'db.internal', user: 'app' })).toBe(target(base));
        expect(target({ ...base, port: undefined, tls: undefined })).toBe(target(base));
        expect(target({ ...base, tunnel: { kind: 'docker', container: 'db' } })).toBe(
            target({ ...base, tunnel: { kind: 'docker', container: 'db', port: 3306 } })
        );
        // ~/.ssh/config may give the host another port.
        expect(target({ ...base, tunnel: { kind: 'ssh', host: 'bastion' } })).not.toBe(target({ ...base, tunnel: { kind: 'ssh', host: 'bastion', port: 22 } }));
    });

    test('counts a field this release does not know', () => {
        expect(target({ ...base, proxy: 'socks5://elsewhere' })).not.toBe(target(base));
        expect(target({ ...base, tunnel: { kind: 'ssh', host: 'bastion', jump: 'elsewhere' } })).not.toBe(
            target({ ...base, tunnel: { kind: 'ssh', host: 'bastion' } })
        );
    });
});

describe('a secret as the store keeps it', () => {
    test('carries its version, the password and its address', () => {
        const text = storedSecretOf('hunter2', passwordTarget(server.config));
        expect(JSON.parse(text)).toEqual({ version: 1, password: 'hunter2', target: passwordTarget(server.config) });
        expect(boundPasswordOf(text)).toEqual(savedFor(server, 'hunter2'));
    });

    test('anything else is bound to no address', () => {
        expect(boundPasswordOf('{"password":"x"}')).toEqual({ password: '{"password":"x"}', target: null });
        const later = JSON.stringify({ version: 2, password: 'x', target: 'y' });
        expect(boundPasswordOf(later)).toEqual({ password: later, target: null });
        expect(boundPasswordOf('null')).toEqual({ password: 'null', target: null });
    });
});
