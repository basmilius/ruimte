import { beforeEach, describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import type { ClientAccess } from '../wire.ts';
import { agentServersArea } from './agent-servers.ts';
import { askOnce } from './test-helpers.ts';

let dispatcher: Dispatcher;

beforeEach(() => {
    dispatcher = new Dispatcher();
    agentServersArea().handlers?.(dispatcher);
});

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

function call(type: string, payload: unknown, access: ClientAccess): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client-1', access }, type, payload);
}

describe('agent server handlers', () => {
    test('Antigravity has no server of its own to install, and only the local secret may ask to install one', async () => {
        const none = { ok: true, result: { server: { provider: 'antigravity', state: 'unsupported', installed: null } } };

        expect(await call('provider.server', { provider: 'antigravity' }, GUEST)).toMatchObject(none);
        expect(await call('provider.installServer', { provider: 'antigravity' }, GUEST)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await call('provider.installServer', { provider: 'antigravity' }, OWNER)).toMatchObject(none);
    });
});
