import { beforeEach, describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, parsePairingUrl, parseStoredEndpoints, socketUrlFor, useEndpoints, type Endpoint } from './endpoints';

const row = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}:4210`,
    wsBaseUrl: `ws://${id}:4210`,
    reachability: 'lan',
    token: `token-${id}`,
    daemonId: id,
    ...overrides
});

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
        const base = { id: 'x', label: 'x', httpBaseUrl: 'http://box:4210', wsBaseUrl: 'ws://box:4210', reachability: 'lan' as const, daemonId: null };
        expect(socketUrlFor({ ...base, token: 'a b' })).toBe('ws://box:4210/ws?token=a%20b');
        expect(socketUrlFor({ ...base, token: null })).toBe('ws://box:4210/ws');
    });
});

describe('the stored endpoint list', () => {
    test('a blob from before daemon ids keeps its host-shaped ids and asks to be written again', () => {
        const legacy = JSON.stringify({
            endpoints: [
                { id: '10.0.0.4:4210', label: 'box', httpBaseUrl: 'http://10.0.0.4:4210', wsBaseUrl: 'ws://10.0.0.4:4210', reachability: 'lan', token: 't' }
            ],
            activeId: '10.0.0.4:4210'
        });
        const parsed = parseStoredEndpoints(legacy);
        expect(parsed.migrated).toBe(true);
        expect(parsed.activeId).toBe('10.0.0.4:4210');
        expect(parsed.endpoints).toEqual([
            {
                id: '10.0.0.4:4210',
                label: 'box',
                httpBaseUrl: 'http://10.0.0.4:4210',
                wsBaseUrl: 'ws://10.0.0.4:4210',
                reachability: 'lan',
                token: 't',
                daemonId: null
            }
        ]);
    });

    test('a blob of this version is taken as it stands, and the local row is never read back', () => {
        const stored = JSON.stringify({ version: 2, endpoints: [row('box'), { ...row('stale'), id: LOCAL_ENDPOINT_ID }], activeId: 'box' });
        const parsed = parseStoredEndpoints(stored);
        expect(parsed.migrated).toBe(false);
        expect(parsed.endpoints.map((endpoint) => endpoint.id)).toEqual(['box']);
    });

    test('nothing stored and a blob that will not parse both end up empty', () => {
        expect(parseStoredEndpoints(null)).toEqual({ endpoints: [], activeId: null, migrated: false });
        expect(parseStoredEndpoints('{ not json')).toEqual({ endpoints: [], activeId: null, migrated: false });
    });
});

describe('rekeying an endpoint', () => {
    beforeEach(() => {
        useEndpoints.setState({ endpoints: [row(LOCAL_ENDPOINT_ID, { daemonId: null })], activeId: LOCAL_ENDPOINT_ID, mismatched: {} });
    });

    test('a row keyed on its address moves onto the daemon id, and the active choice follows', () => {
        useEndpoints.getState().add(row('10.0.0.4:4210', { daemonId: null, httpBaseUrl: 'http://10.0.0.4:4210' }));
        useEndpoints.getState().setActive('10.0.0.4:4210');
        useEndpoints.getState().rekeyEndpoint('10.0.0.4:4210', 'Kc9Ax2pQ0Zs');

        const moved = useEndpoints.getState().endpoints.find((endpoint) => endpoint.id === 'Kc9Ax2pQ0Zs');
        expect(moved?.daemonId).toBe('Kc9Ax2pQ0Zs');
        // The address and the token are what made the connection; only the key changes.
        expect(moved?.httpBaseUrl).toBe('http://10.0.0.4:4210');
        expect(moved?.token).toBe('token-10.0.0.4:4210');
        expect(useEndpoints.getState().activeId).toBe('Kc9Ax2pQ0Zs');
    });

    test('the same daemon under two addresses ends up as one row, the one that just answered', () => {
        useEndpoints.getState().add(row('daemon-a', { httpBaseUrl: 'http://old:4210', token: 'old' }));
        useEndpoints.getState().add(row('192.168.1.9:4210', { daemonId: null, httpBaseUrl: 'http://new:4210', token: 'new' }));
        useEndpoints.getState().rekeyEndpoint('192.168.1.9:4210', 'daemon-a');

        const rows = useEndpoints.getState().endpoints.filter((endpoint) => endpoint.id === 'daemon-a');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.token).toBe('new');
    });

    test('the reserved local row and an unknown row are left alone', () => {
        useEndpoints.getState().rekeyEndpoint(LOCAL_ENDPOINT_ID, 'daemon-a');
        useEndpoints.getState().rekeyEndpoint('never-seen', 'daemon-a');
        expect(useEndpoints.getState().endpoints.map((endpoint) => endpoint.id)).toEqual([LOCAL_ENDPOINT_ID]);
    });

    test('a row that answers as another machine is marked, and forgetting it clears the mark', () => {
        useEndpoints.getState().add(row('daemon-a'));
        useEndpoints.getState().noteMismatch('daemon-a', 'daemon-b');
        expect(useEndpoints.getState().mismatched['daemon-a']).toBe('daemon-b');
        useEndpoints.getState().remove('daemon-a');
        expect(useEndpoints.getState().mismatched).toEqual({});
    });
});
