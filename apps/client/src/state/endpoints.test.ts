import { describe, expect, test } from 'bun:test';
import { parsePairingUrl, socketUrlFor } from './endpoints';

describe('endpoints', () => {
    test('parsePairingUrl reads the origin and the token out of the daemon URL', () => {
        expect(parsePairingUrl('http://box.local:4210/pair#abc123')).toEqual({ httpBaseUrl: 'http://box.local:4210', token: 'abc123' });
        expect(parsePairingUrl('  https://ruimte.example/pair#t  ')).toEqual({ httpBaseUrl: 'https://ruimte.example', token: 't' });
        expect(parsePairingUrl('http://box.local:4210/pair')).toBeNull();
        expect(parsePairingUrl('http://box.local:4210/other#t')).toBeNull();
        expect(parsePairingUrl('ftp://box/pair#t')).toBeNull();
        expect(parsePairingUrl('not a url')).toBeNull();
    });

    test('socketUrlFor puts the token in the query and leaves loopback bare', () => {
        const base = { id: 'x', label: 'x', httpBaseUrl: 'http://box:4210', wsBaseUrl: 'ws://box:4210', reachability: 'lan' as const };
        expect(socketUrlFor({ ...base, token: 'a b' })).toBe('ws://box:4210/ws?token=a%20b');
        expect(socketUrlFor({ ...base, token: null })).toBe('ws://box:4210/ws');
    });
});
