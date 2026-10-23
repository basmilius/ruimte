import { describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { linkUsage, localUsage } from './local-usage';
import type { Transport, TransportStatus } from './transport';

function fakeLink(status: TransportStatus, features: string[]) {
    const asked: { type: string; payload: unknown }[] = [];
    const link = {
        status,
        connection: { status, attempts: 0, retryAt: null, failure: null, features },
        request: async (type: string, payload: unknown) => {
            asked.push({ type, payload });
            return {};
        }
    } as unknown as Transport;
    return { link, asked };
}

describe('what this app hands its machine for the usage counts', () => {
    test('goes over the machine own link only while it is open and answers the request', () => {
        const open = fakeLink('open', ['usage.count', 'usage.timing']);
        localUsage(() => open.link).count('dictations');
        localUsage(() => open.link).timing('remoteConnectMs', 640.4);
        expect(open.asked).toEqual([
            { type: 'usage.count', payload: { counter: 'dictations' } },
            { type: 'usage.timing', payload: { timing: 'remoteConnectMs', ms: 640 } }
        ]);

        const older = fakeLink('open', []);
        localUsage(() => older.link).count('dictations');
        const closed = fakeLink('closed', ['usage.count']);
        localUsage(() => closed.link).count('dictations');
        localUsage(() => null).count('dictations');
        expect([...older.asked, ...closed.asked]).toEqual([]);
    });

    test('counts the path of a link that opened, why an attempt failed, and the time to a machine elsewhere', () => {
        const machine = fakeLink('open', ['usage.count', 'usage.timing']);
        const usage = localUsage(() => machine.link);
        let endpointId = 'remote-machine';
        const meter = linkUsage(
            usage,
            () => endpointId,
            (link) => (link.relayed ? 'connections.turn' : 'connections.direct')
        );
        meter.connected({ relayed: true, signaled: 'broker' }, 'ok', 820);
        meter.connected({ relayed: false, signaled: null }, 'failed', 300);
        meter.reconnecting('timeout');
        meter.reconnecting('dropped');
        meter.reconnecting('switch');
        endpointId = LOCAL_ENDPOINT_ID;
        meter.connected({ relayed: false, signaled: null }, 'ok', 12);
        expect(machine.asked.map((ask) => ask.payload)).toEqual([
            { counter: 'connections.turn' },
            { timing: 'remoteConnectMs', ms: 820 },
            { counter: 'connectFailures.timeout' },
            { counter: 'connections.direct' }
        ]);
    });
});
