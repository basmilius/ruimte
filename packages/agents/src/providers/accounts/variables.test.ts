import { describe, expect, test } from 'bun:test';
import { keychainService } from './variables.ts';

const HOST = { name: 'Host', variablePrefixes: [], keychainPrefix: 'host' };

describe('the keychain service of a machine', () => {
    test('is its own per home, and the same for one home however it is written', () => {
        expect(keychainService(HOST, '/Users/bas/.host')).not.toBe(keychainService(HOST, '/Users/bas/.host-dev'));
        expect(keychainService(HOST, '/Users/bas/.host')).toBe(keychainService(HOST, '/Users/bas/./.host/'));
        expect(keychainService(HOST, '/Users/bas/.host')).toMatch(/^host-provider-env-[0-9a-f]{12}$/);
    });
});
