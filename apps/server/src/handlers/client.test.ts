import { describe, expect, test } from 'bun:test';
import type { AuthSession } from '@ruimte/contracts';
import { ConnectedClients } from '../clients/connected-clients.ts';
import { Dispatcher } from '../dispatcher.ts';
import { ACTIVE_USE_MS, CredentialStore } from '../tunnels/credential-store.ts';
import { registerClientHandlers } from './client.ts';
import { askOnce } from './test-helpers.ts';

const SESSION: AuthSession = { id: 'session-1', label: 'Station on a Pixel', origin: 'statement', createdAt: 1, lastSeenAt: 1, current: false };
const PERSON = { id: 'client-1', access: { reachability: 'lan', sessionId: 'session-1' } } as const;

function machine() {
    const clock = { now: 1_000_000 };
    const connected = new ConnectedClients(() => clock.now);
    const credentials = new CredentialStore({ now: () => clock.now, random: (bytes) => 'x'.repeat(bytes) });
    const dispatcher = new Dispatcher();
    registerClientHandlers(dispatcher, { connected, auth: { list: async () => [SESSION] }, external: () => credentials.active() });
    connected.opened(PERSON.id, PERSON.access);

    return { clock, connected, credentials, dispatcher };
}

describe('client.list', () => {
    test('names the session of a channel and marks the asking one', async () => {
        const { dispatcher } = machine();

        expect(await askOnce(dispatcher, PERSON, 'client.list', {})).toMatchObject({
            ok: true,
            result: { clients: [{ id: 'client-1', access: 'account', label: 'Station on a Pixel', reachability: 'lan', current: true }] }
        });
    });

    test('lists an external MCP client by its name while it made a request lately, and not once it went quiet', async () => {
        const { clock, credentials, dispatcher } = machine();
        const { secret, credential } = await credentials.createBearer({ label: 'Claude' });
        credentials.authenticate(secret, 'loopback');
        clock.now += 60_000;

        expect(await askOnce(dispatcher, PERSON, 'client.list', {})).toMatchObject({
            ok: true,
            result: {
                clients: [
                    { id: 'client-1' },
                    { id: `external-${credential.id}`, access: 'mcp', client: 'mcp', label: 'Claude', lastRequestAt: 1_000_000, current: false }
                ]
            }
        });

        clock.now += ACTIVE_USE_MS;

        expect(await askOnce(dispatcher, PERSON, 'client.list', {})).toMatchObject({ ok: true, result: { clients: [{ id: 'client-1' }] } });
    });

    test('is refused to another machine', async () => {
        const { dispatcher } = machine();
        const peer = { id: 'client-2', access: { reachability: 'lan', sessionId: 'peer-1', peer: { machineId: 'machine-b' } } } as const;

        for (const type of ['client.list', 'client.watch', 'client.unwatch']) {
            expect(await askOnce(dispatcher, peer, type, {})).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
    });
});
