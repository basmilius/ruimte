import { expect, test } from 'bun:test';
import { browserDestinationAllowed, parseBrowserRoute } from './browser-route-policy';

const remote = { webContentsId: 10, endpointId: 'remote' };
const local = { ...remote, endpointId: 'local' };

test('every normalized loopback spelling follows the captured project, regardless of scheme', () => {
    for (const host of [
        'localhost',
        'localhost.',
        'x.localhost',
        '127.0.0.1',
        '127.1',
        '2130706433',
        '0x7f000001',
        '0.0.0.0',
        '[::1]',
        '[::]',
        '[::ffff:127.0.0.1]',
        '[::ffff:0.0.0.0]'
    ]) {
        for (const scheme of ['http', 'https', 'ws', 'wss']) {
            const url = `${scheme}://${host}:5173/path`;
            expect(browserDestinationAllowed(remote, url)).toBe(false);
            expect(browserDestinationAllowed(local, url)).toBe(true);
        }
    }
    expect(browserDestinationAllowed(remote, 'https://example.org/localhost')).toBe(true);
    expect(browserDestinationAllowed(remote, 'http://localhost.example.org/')).toBe(true);
});

test('an unbound guest can only bootstrap its blank document', () => {
    expect(browserDestinationAllowed(undefined, 'about:blank')).toBe(true);
    for (const url of ['http://localhost/', 'https://example.org/', 'data:text/html,hello']) {
        expect(browserDestinationAllowed(undefined, url)).toBe(false);
    }
});

test('IPC bindings require a valid guest id and a matching local owner identity', () => {
    expect(parseBrowserRoute(remote)).toEqual(remote);
    expect(parseBrowserRoute({ ...local, owner: 'owner', localMachineId: 'owner' })).not.toBeNull();
    for (const value of [
        null,
        [],
        true,
        {},
        { ...remote, webContentsId: '10' },
        { ...remote, webContentsId: -1 },
        { ...remote, webContentsId: 1.5 },
        { ...remote, endpointId: '' },
        { ...remote, endpointId: 'x'.repeat(1025) },
        { ...remote, owner: 'owner', localMachineId: 'owner' },
        { ...local, owner: 'owner' },
        { ...local, owner: 'owner', localMachineId: 'other' }
    ]) {
        expect(parseBrowserRoute(value)).toBeNull();
    }
});
