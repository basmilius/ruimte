import { describe, expect, test } from 'bun:test';
import type { DatabaseConnection } from '@ruimte/contracts';
import { databaseSecretStore, memorySecretStore, secretKeyOf, secretWrites, splitPasswords, withPasswords } from './secrets.ts';

const server: DatabaseConnection = {
    id: 'shop',
    name: 'Shop',
    shared: true,
    config: { engine: 'mysql', host: '127.0.0.1', user: 'root', password: 'hunter2' }
};
const file: DatabaseConnection = { id: 'cache', name: 'Cache', shared: false, config: { engine: 'sqlite', path: '/repo/cache.db' } };

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

    test('merges a known password into a server that has none, and leaves a file and a typed password alone', () => {
        const { connections } = splitPasswords([server, file]);
        expect(withPasswords(connections, { shop: 'hunter2', cache: 'nope' })).toEqual([server, file]);
        expect(withPasswords([server], { shop: 'other' })[0]!.config.password).toBe('hunter2');
        expect(withPasswords(connections, {})[0]!.config).not.toHaveProperty('password');
    });

    test('the round trip gives back what a person typed', () => {
        const { connections, passwords } = splitPasswords([server, file]);
        expect(withPasswords(connections, passwords)).toEqual([server, file]);
    });

    test('the store hears of a changed or cleared password and of a connection that went', () => {
        expect(secretWrites({ shop: 'old', gone: 'x' }, { shop: 'new' }, ['shop', 'cache'])).toEqual([
            { id: 'shop', secret: 'new' },
            { id: 'gone', secret: null }
        ]);
        expect(secretWrites({ shop: 'old' }, {}, ['shop'])).toEqual([{ id: 'shop', secret: null }]);
        expect(secretWrites({ shop: 'same' }, { shop: 'same' }, ['shop'])).toEqual([]);
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
