import { describe, expect, test } from 'bun:test';
import type { SessionEvent } from '../wire.ts';
import { ConnectedClients } from './connected-clients.ts';

const ACCOUNT = { reachability: 'lan', sessionId: 'session-1' } as const;

function clients() {
    const clock = { now: 1_000 };
    const connected = new ConnectedClients(() => clock.now);
    const heard: Record<string, SessionEvent[]> = {};
    const listen = (clientId: string): void => {
        heard[clientId] = [];
        connected.subscribe(clientId, (event) => heard[clientId]!.push(event));
    };

    return { clock, connected, heard, listen };
}

describe('ConnectedClients', () => {
    test('shows what a client told of itself, with the label of its session', () => {
        const { clock, connected } = clients();
        connected.opened('client-1', ACCOUNT);
        clock.now = 2_000;
        connected.announce('client-1', { client: 'ios', clientVersion: '0.31.0', clientOs: 'ios', clientOsVersion: '27.1', clientDevice: 'phone' });

        expect(connected.list('client-1', (sessionId) => (sessionId === 'session-1' ? "Bas's iPhone" : undefined))).toEqual([
            {
                id: 'client-1',
                access: 'account',
                label: "Bas's iPhone",
                client: 'ios',
                version: '0.31.0',
                os: 'ios',
                osVersion: '27.1',
                device: 'phone',
                reachability: 'lan',
                connectedAt: 1_000,
                current: true
            }
        ]);
    });

    test('a later endpoint.info without a client wipes nothing', () => {
        const { connected } = clients();
        connected.opened('client-1', { reachability: 'loopback', sessionId: null });
        connected.announce('client-1', { client: 'desktop', clientOs: 'macos' });
        connected.announce('client-1', {});

        expect(connected.list('client-2', () => undefined)).toEqual([
            { id: 'client-1', access: 'local', client: 'desktop', os: 'macos', reachability: 'loopback', connectedAt: 1_000, current: false }
        ]);
    });

    test('keeps what a client reads beyond its wire until it says so again, and shows none of it', () => {
        const { connected } = clients();
        connected.opened('client-1', ACCOUNT);
        connected.announce('client-1', { client: 'ios', clientFeatures: ['tolerantWire'] });
        connected.announce('client-1', {});

        expect(connected.readsNewerWire('client-1')).toBe(true);
        expect(connected.list('client-1', () => undefined)[0]).not.toHaveProperty('features');

        connected.announce('client-1', { client: 'ios' });

        expect(connected.readsNewerWire('client-1')).toBe(false);
    });

    describe('reads a newer wire', () => {
        test('for a desktop, Station or iPhone that reported tolerantWire', () => {
            const { connected } = clients();
            connected.opened('desktop', { reachability: 'loopback', sessionId: null });
            connected.opened('station', ACCOUNT);
            connected.opened('phone', ACCOUNT);
            connected.announce('desktop', { client: 'desktop', clientFeatures: ['tolerantWire'] });
            connected.announce('station', { client: 'station', clientFeatures: ['tolerantWire'] });
            connected.announce('phone', { client: 'ios', clientFeatures: ['otherFeature', 'tolerantWire'] });

            expect(['desktop', 'station', 'phone'].map((id) => connected.readsNewerWire(id))).toEqual([true, true, true]);
        });

        test('not for a client of before tolerantWire, or one that never told of itself', () => {
            const { connected } = clients();
            connected.opened('old-phone', ACCOUNT);
            connected.opened('old-station', ACCOUNT);
            connected.opened('silent', { reachability: 'loopback', sessionId: null });
            connected.announce('old-phone', { client: 'ios', clientVersion: '0.30.2' });
            connected.announce('old-station', { client: 'station', clientFeatures: ['otherFeature'] });

            expect(['old-phone', 'old-station', 'silent'].map((id) => connected.readsNewerWire(id))).toEqual([false, false, false]);
        });

        test('not for a peer, even one that reported tolerantWire', () => {
            const { connected } = clients();
            connected.opened('peer', { reachability: 'public', sessionId: 'peer-1', peer: { machineId: 'machine-b' } });
            connected.announce('peer', { client: 'desktop', clientFeatures: ['tolerantWire'] });

            expect(connected.readsNewerWire('peer')).toBe(false);
        });

        test('not for a channel that closed or was never open', () => {
            const { connected } = clients();
            connected.opened('client-1', ACCOUNT);
            connected.announce('client-1', { client: 'ios', clientFeatures: ['tolerantWire'] });
            connected.closed('client-1');

            expect(connected.readsNewerWire('client-1')).toBe(false);
            expect(connected.readsNewerWire('client-2')).toBe(false);
        });
    });

    test('passes a value it does not know through as it came', () => {
        const { connected } = clients();
        connected.opened('client-1', ACCOUNT);
        connected.announce('client-1', { client: 'android', clientOs: 'android', clientDevice: 'watch' });

        expect(connected.list('client-1', () => undefined)[0]).toMatchObject({ client: 'android', os: 'android', device: 'watch' });
    });

    test('marks only the asking client as current, and drops a channel once it closed', () => {
        const { connected } = clients();
        connected.opened('client-1', ACCOUNT);
        connected.opened('client-2', { reachability: 'public', sessionId: 'peer-1', peer: { machineId: 'machine-b' } });

        expect(connected.list('client-2', () => undefined).map(({ id, access, machineId, current }) => ({ id, access, machineId, current }))).toEqual([
            { id: 'client-1', access: 'account', machineId: undefined, current: false },
            { id: 'client-2', access: 'machine', machineId: 'machine-b', current: true }
        ]);

        connected.closed('client-1');
        expect(connected.list('client-2', () => undefined).map(({ id }) => id)).toEqual(['client-2']);
    });

    test('tells only the clients that watch of a change', () => {
        const { connected, heard, listen } = clients();
        listen('client-1');
        listen('client-2');
        connected.watch('client-1');
        connected.opened('client-3', ACCOUNT);
        connected.announce('client-3', { client: 'station' });
        connected.closed('client-3');

        expect(heard['client-1']).toEqual([
            { event: 'client.changed', payload: {} },
            { event: 'client.changed', payload: {} },
            { event: 'client.changed', payload: {} }
        ]);
        expect(heard['client-2']).toEqual([]);
    });

    test('tells only the owner of a change among the external MCP clients', () => {
        const { connected, heard, listen } = clients();
        listen('owner');
        listen('phone');
        connected.opened('owner', { reachability: 'loopback', sessionId: null });
        connected.opened('phone', ACCOUNT);
        connected.watch('owner');
        connected.watch('phone');
        connected.externalChanged();

        expect(heard['owner']).toEqual([{ event: 'client.changed', payload: {} }]);
        expect(heard['phone']).toEqual([]);
    });
});
