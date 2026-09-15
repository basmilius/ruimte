import { beforeEach, describe, expect, test } from 'bun:test';
import type { EndpointInfo } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { noteDaemonIdentity } from './identity';

const row = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: `token-${id}`,
    daemonId: id,
    daemonPublicKey: null,
    ...overrides
});

const local = (daemonId: string | null): Endpoint =>
    row(LOCAL_ENDPOINT_ID, {
        label: 'This machine',
        httpBaseUrl: 'http://127.0.0.1:4210',
        wsBaseUrl: 'ws://127.0.0.1:4210',
        reachability: 'loopback',
        token: null,
        daemonId
    });

// Merging a row awaits nothing but promises that are already settled, and no timer of the code under test is due this soon.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* What a daemon answers `endpoint.info` with, without a public key: nothing here is about pinning. */
const answers = (id: string): EndpointInfo => ({ id, label: id, platform: 'linux', version: '0.0.0', reachability: 'lan', authenticated: true });

describe('a row that turns out to be a machine already in the list', () => {
    beforeEach(() => {
        useEndpoints.setState({ endpoints: [local(null)], activeId: LOCAL_ENDPOINT_ID, mismatched: {} });
        useToasts.setState({ toasts: [] });
    });

    test('an address that answers as the machine behind this page leaves the local row and drops the other', async () => {
        useEndpoints.setState({ endpoints: [local('daemon-here'), row('10.0.0.4:4210', { daemonId: null })] });

        expect(noteDaemonIdentity('10.0.0.4:4210', answers('daemon-here'))).toBe(LOCAL_ENDPOINT_ID);
        await settle();

        expect(useEndpoints.getState().endpoints.map((entry) => entry.id)).toEqual([LOCAL_ENDPOINT_ID]);
        expect(useToasts.getState().toasts[0]?.description).toContain('another address of This machine');
    });

    test('a machine paired over the LAN before this page said who it is folds into the local row', async () => {
        useEndpoints.setState({ endpoints: [local(null), row('daemon-here')] });

        expect(noteDaemonIdentity(LOCAL_ENDPOINT_ID, answers('daemon-here'))).toBe(LOCAL_ENDPOINT_ID);
        await settle();

        const rows = useEndpoints.getState().endpoints;
        expect(rows.map((entry) => entry.id)).toEqual([LOCAL_ENDPOINT_ID]);
        expect(rows[0]?.daemonId).toBe('daemon-here');
        expect(useToasts.getState().toasts[0]?.title).toBe('daemon-here is already in the list');
    });

    test('a row keyed on an address moves onto a daemon another row holds, and the two become one', async () => {
        useEndpoints.setState({
            endpoints: [
                local(null),
                row('daemon-a', { httpBaseUrl: 'http://old:4210', token: 'old', daemonPublicKey: 'pinned-key' }),
                row('192.168.1.9:4210', { httpBaseUrl: 'http://new:4210', token: 'new', daemonId: null })
            ]
        });

        expect(noteDaemonIdentity('192.168.1.9:4210', answers('daemon-a'))).toBe('daemon-a');
        await settle();

        const rows = useEndpoints.getState().endpoints;
        expect(rows.map((entry) => entry.id)).toEqual([LOCAL_ENDPOINT_ID, 'daemon-a']);
        // The row that just answered is the one whose address and credential are known to work.
        expect(rows[1]?.httpBaseUrl).toBe('http://new:4210');
        expect(rows[1]?.token).toBe('new');
        expect(rows[1]?.daemonPublicKey).toBe('pinned-key');
        expect(useToasts.getState().toasts[0]?.title).toBe('daemon-a is already in the list');
    });

    test('a paired row that answers as a different daemon is warned about, never merged', async () => {
        useEndpoints.setState({ endpoints: [local(null), row('daemon-a'), row('daemon-b')] });

        expect(noteDaemonIdentity('daemon-a', answers('daemon-b'))).toBe('daemon-a');
        await settle();

        expect(useEndpoints.getState().endpoints.map((entry) => entry.id)).toEqual([LOCAL_ENDPOINT_ID, 'daemon-a', 'daemon-b']);
        expect(useEndpoints.getState().mismatched['daemon-a']).toBe('daemon-b');
        expect(useToasts.getState().toasts[0]?.kind).toBe('error');
    });
});
