import { expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { SessionPorts } from '../sessions/ports.ts';
import { registerSessionPortHandlers } from './session-ports.ts';

test('remote or unproven clients cannot turn a session listener into a local browser URL', async () => {
    const dispatcher = new Dispatcher();
    const ports = new SessionPorts({ machineId: 'owner-machine', sampler: null, probe: null, uid: 501, sessions: () => [], current: () => undefined });
    registerSessionPortHandlers(dispatcher, ports);
    const payload = { sessionId: 'one', listener: { pid: 12, startTime: 1234, port: 3000, bindAddress: '127.0.0.1', host: '127.0.0.1' } };
    for (const access of [undefined, { reachability: 'loopback', sessionId: 'remote-owner' }, { reachability: 'lan', sessionId: 'remote-owner' }] as (
        | ClientAccess
        | undefined
    )[]) {
        const frames: ServerFrame[] = [];
        await dispatcher.handle(
            { id: 'client', access, send: (frame) => frames.push(frame) },
            JSON.stringify({ id: 'request', type: 'session.verifyPort', payload })
        );
        expect(frames[0]).toMatchObject({ ok: false, error: { code: 'session-port-route-unavailable' } });
    }
    const frames: ServerFrame[] = [];
    await dispatcher.handle(
        { id: 'local', access: { reachability: 'loopback', sessionId: null }, send: (frame) => frames.push(frame) },
        JSON.stringify({ id: 'request', type: 'session.verifyPort', payload })
    );
    expect(frames[0]).toMatchObject({ ok: false, error: { code: 'session-port-closed' } });
});
