import { describe, expect, test } from 'bun:test';
import type { Handshake } from '../auth/handshake.ts';
import type { ConnectionServices, OpenConnection } from '../connection.ts';
import type { ClientAccess } from '../dispatcher.ts';
import { wireClients, type DirectConnection } from './clients.ts';

interface Closed {
    code: number;
    reason: string;
}

function directClient(access: ClientAccess): { state: DirectConnection; closed: Closed[] } {
    const closed: Closed[] = [];
    const channel = {
        send: () => 1,
        bufferedAmount: () => 0,
        close: (code: number, reason: string) => closed.push({ code, reason }),
        onClose: () => undefined,
        onDrain: () => undefined
    };
    const connection = { client: { id: 'client', access, send: () => undefined }, receive: () => undefined } as OpenConnection;
    return { state: { channel, connection }, closed };
}

describe('disconnecting a session', () => {
    test('closes the direct channel of a machine that works here, and no channel of another session', () => {
        const revoked: string[] = [];
        const clients = wireClients({ revoke: (sessionId: string) => revoked.push(sessionId) } as unknown as Handshake, {} as ConnectionServices);
        const peer = directClient({ reachability: 'lan', sessionId: 'peer-session', peer: { machineId: 'machine-a' } });
        const other = directClient({ reachability: 'lan', sessionId: 'other-session' });
        clients.direct.add(peer.state);
        clients.direct.add(other.state);

        clients.disconnectSession('peer-session');

        expect(revoked).toEqual(['peer-session']);
        expect(peer.closed).toEqual([{ code: 4001, reason: 'Access revoked' }]);
        expect(other.closed).toEqual([]);
    });
});
