import { describe, expect, test } from 'bun:test';
import { ClientSinks } from '../client-sinks.ts';
import { Dispatcher } from '../dispatcher.ts';
import { PortStreams } from '../ports/port-streams.ts';
import { base64Of, FakeNetwork, FakeTimers, testGrants } from '../ports/port-test-helpers.ts';
import type { ClientAccess } from '../wire.ts';
import { portsArea } from './ports.ts';
import { askOnce } from './test-helpers.ts';

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const ACCOUNT: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };
const PEER: ClientAccess = { reachability: 'lan', sessionId: 'session-2', peer: { machineId: 'machine-b' } };

function setup() {
    const { grants } = testGrants();
    const network = new FakeNetwork();
    const streams = new PortStreams({ grants, connect: network.connect, timers: new FakeTimers() });
    const dispatcher = new Dispatcher();

    portsArea({ grants, streams, changes: new ClientSinks() }).handlers?.(dispatcher);

    return { dispatcher, grants, network };
}

describe('port handlers', () => {
    test('only the local secret shares and revokes a port', async () => {
        const { dispatcher, grants } = setup();

        expect(await askOnce(dispatcher, { id: 'a', access: ACCOUNT }, 'port.share', { projectId: 'project-1', port: 3000 })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(grants.list()).toEqual([]);

        const shared = await askOnce(dispatcher, { id: 'o', access: OWNER }, 'port.share', { projectId: 'project-1', port: 3000 });

        expect(shared).toMatchObject({ ok: true, result: { grant: { port: 3000, host: '127.0.0.1', sharedBy: 'person' } } });

        const id = grants.list()[0]!.id;

        expect(await askOnce(dispatcher, { id: 'a', access: ACCOUNT }, 'port.revoke', { id })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await askOnce(dispatcher, { id: 'o', access: OWNER }, 'port.revoke', { id })).toMatchObject({ ok: true });
        expect(await askOnce(dispatcher, { id: 'o', access: OWNER }, 'port.revoke', { id })).toMatchObject({ ok: false, error: { code: 'unknown-grant' } });
    });

    test('any client of the account reads the list and opens a stream, while the owner may too', async () => {
        const { dispatcher, grants, network } = setup();
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');

        expect(await askOnce(dispatcher, { id: 'a', access: ACCOUNT }, 'port.list', {})).toMatchObject({ ok: true, result: { grants: [{ id: grant.id }] } });
        expect(await askOnce(dispatcher, { id: 'a', access: ACCOUNT }, 'port.open', { streamId: 'stream-01', grantId: grant.id })).toMatchObject({
            ok: true,
            result: { window: 262144 }
        });
        expect(network.asked).toEqual([{ host: '127.0.0.1', port: 3000 }]);
    });

    test('another machine gets nothing, before any handler runs', async () => {
        const { dispatcher, grants, network } = setup();
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');

        for (const [type, payload] of [
            ['port.list', {}],
            ['port.share', { projectId: 'project-1', port: 3001 }],
            ['port.revoke', { id: grant.id }],
            ['port.open', { streamId: 'stream-01', grantId: grant.id }],
            ['port.write', { streamId: 'stream-01', offset: 0, data: base64Of('x') }],
            ['port.credit', { streamId: 'stream-01', offset: 0 }],
            ['port.close', { streamId: 'stream-01' }]
        ] as const) {
            expect(await askOnce(dispatcher, { id: 'p', access: PEER }, type, payload)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }

        expect(network.asked).toEqual([]);
        expect(grants.list()).toHaveLength(1);
        expect(dispatcher.peerTypes().filter((type) => type.startsWith('port.'))).toEqual([]);
    });

    test('refuses a port of Ruimte itself with its own code', async () => {
        const { dispatcher } = setup();

        expect(await askOnce(dispatcher, { id: 'o', access: OWNER }, 'port.share', { projectId: 'project-1', port: 4210 })).toMatchObject({
            ok: false,
            error: { code: 'port-denied' }
        });
    });

    test('writes decoded bytes and refuses an empty write', async () => {
        const { dispatcher, grants, network } = setup();
        const grant = grants.share('project-1', 3000, '127.0.0.1', 'person');
        const client = { id: 'a', access: ACCOUNT };

        await askOnce(dispatcher, client, 'port.open', { streamId: 'stream-01', grantId: grant.id });

        expect(await askOnce(dispatcher, client, 'port.write', { streamId: 'stream-01', offset: 0, data: base64Of('GET /') })).toMatchObject({
            ok: true,
            result: { flushed: 5 }
        });
        expect(new TextDecoder().decode(network.services[0]!.written[0])).toBe('GET /');
        expect(await askOnce(dispatcher, client, 'port.write', { streamId: 'stream-01', offset: 5, data: '' })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });
});
