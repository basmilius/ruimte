import { describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID } from '../state/endpoints';
import { describeConnection, describeLastSeen, describeMachine, describePing, describeVersion, tooltipMachines } from './connection-info';

describe('describeConnection', () => {
    test('says connected while the socket is open', () => {
        expect(describeConnection({ status: 'open', attempts: 0, retryAt: null }, 0)).toBe('Connected');
        expect(describeConnection({ status: 'open', attempts: 0, retryAt: null, relayed: true }, 0)).toBe('Connected via relay');
    });

    test('counts the attempt and the wait while a retry is pending', () => {
        expect(describeConnection({ status: 'closed', attempts: 3, retryAt: 4_500 }, 1_000)).toBe('Reconnecting, attempt 3, next try in 4s');
    });

    test('never counts down past zero', () => {
        expect(describeConnection({ status: 'closed', attempts: 1, retryAt: 500 }, 9_000)).toBe('Reconnecting, attempt 1, next try in 0s');
    });

    test('leaves the countdown out without a clock', () => {
        expect(describeConnection({ status: 'closed', attempts: 3, retryAt: 4_500 }, null)).toBe('Reconnecting, attempt 3');
    });

    test('drops the countdown while the retry is on the wire', () => {
        expect(describeConnection({ status: 'connecting', attempts: 2, retryAt: null }, 0)).toBe('Reconnecting, attempt 2');
    });

    test('separates the first connect from a reconnect', () => {
        expect(describeConnection({ status: 'connecting', attempts: 0, retryAt: null }, 0)).toBe('Connecting');
        expect(describeConnection({ status: 'closed', attempts: 0, retryAt: null }, 0)).toBe('Disconnected');
    });

    test('says disconnected when nothing is scheduled anymore', () => {
        expect(describeConnection({ status: 'closed', attempts: 4, retryAt: null }, 0)).toBe('Disconnected');
    });
});

describe('describeMachine', () => {
    test('names the local Mac after the machine, not after the endpoint', () => {
        expect(describeMachine({ endpointLabel: 'This machine', machineLabel: 'bas-mbp', reachability: 'loopback', platform: 'darwin' })).toBe('This Mac');
    });

    test('falls back to the hostname on another platform', () => {
        expect(describeMachine({ endpointLabel: 'This machine', machineLabel: 'workshop', reachability: 'loopback', platform: 'linux' })).toBe('workshop');
    });

    test('pairs the endpoint with the hostname when they differ', () => {
        expect(describeMachine({ endpointLabel: 'Studio', machineLabel: 'mac-studio', reachability: 'lan', platform: 'darwin' })).toBe('Studio · mac-studio');
    });

    test('says a name once when both agree', () => {
        expect(describeMachine({ endpointLabel: 'Studio', machineLabel: 'Studio', reachability: 'lan', platform: 'darwin' })).toBe('Studio');
    });

    test('keeps the endpoint name before the machine has answered', () => {
        expect(describeMachine({ endpointLabel: 'Studio', machineLabel: null, reachability: null, platform: null })).toBe('Studio');
    });
});

describe('describeVersion and describePing', () => {
    test('shows a dash for what is not known yet', () => {
        expect(describeVersion(null)).toBe('Version -');
        expect(describePing(null)).toBe('Ping -');
    });

    test('rounds the round trip to whole milliseconds', () => {
        expect(describeVersion('0.4.2')).toBe('Version 0.4.2');
        expect(describePing(11.6)).toBe('Ping 12 ms');
    });
});

describe('a machine without a link', () => {
    test('is not connected rather than disconnected', () => {
        expect(describeConnection({ status: 'closed', attempts: 0, retryAt: null, noLink: true }, 0)).toBe('Not connected');
    });

    test('says when it was last connected, and nothing when it never was', () => {
        expect(describeLastSeen(0, 5 * 60_000)).toBe('Last connected 5m ago');
        expect(describeLastSeen(null, 5 * 60_000)).toBeNull();
    });
});

describe('the machines the connection tooltip lists', () => {
    const rows = [{ id: LOCAL_ENDPOINT_ID }, { id: 'vps' }, { id: 'macbook' }];

    test('a station build lists no local row, even with a link for it in the pool', () => {
        expect(tooltipMachines(rows, [LOCAL_ENDPOINT_ID, 'vps', 'macbook'], false).map((row) => row.id)).toEqual(['vps', 'macbook']);
    });

    test('an app with a daemon behind it lists this machine too, and only machines with a link', () => {
        expect(tooltipMachines(rows, [LOCAL_ENDPOINT_ID, 'vps'], true).map((row) => row.id)).toEqual([LOCAL_ENDPOINT_ID, 'vps']);
    });
});
