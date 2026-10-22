import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../auth/auth-store.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { PeerKey } from '../remote/peer-key.ts';
import { PendingAdmissions } from '../remote/pending-admissions.ts';
import { wireRemote } from './remote.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { MachineBundle } from './machine.ts';

let home: string;
let auth: AuthStore;
let machine: MachineBundle;
const NOW = Date.UTC(2026, 9, 1);

beforeEach(async () => {
    setSystemTime(NOW);
    home = await mkdtemp(join(tmpdir(), 'ruimte-wire-remote-'));
    auth = new AuthStore(home);
    machine = { auth, peerKey: new PeerKey(home), pendingAdmissions: new PendingAdmissions() } as unknown as MachineBundle;
});

afterEach(async () => {
    setSystemTime();
    await rm(home, { recursive: true, force: true });
});

describe('what this machine holds of the machines it works in', () => {
    test('goes when the machine leaves its account: the peer key, the machines it knew, the statements it held and what is built on them', async () => {
        const outbox = new OutboxStore(home);
        await outbox.load();
        const remote = await wireRemote({ home, identity: { label: 'Studio' } as EndpointIdentity, machine, outbox, later: { brokerUrl: () => null } });
        await auth.bindAccount('owner');
        const before = await machine.peerKey.publicKey();
        await remote.machines.put({ machineId: 'machine-b', publicKey: 'B'.repeat(43) }, 1);
        machine.pendingAdmissions.hold({
            machineId: 'machine-b',
            machinePublicKey: 'B'.repeat(43),
            accountId: 'owner',
            peerPublicKey: before,
            peerMachineId: 'machine-a',
            peerMachinePublicKey: 'A'.repeat(43),
            nonce: 'n'.repeat(22),
            issuedAt: NOW,
            expiresAt: NOW + 600_000,
            signature: 's'.repeat(86)
        });
        const left: string[] = [];
        remote.onLeave(() => void left.push('reconnect'));

        await auth.leaveAccount();

        expect(remote.machines.all()).toEqual([]);
        expect(machine.pendingAdmissions.peek('machine-b')).toBeNull();
        expect(left).toEqual(['reconnect']);
        await expect(stat(join(home, 'peer-key.json'))).rejects.toThrow();
        // Asking again makes a key of its own, which no machine of the old account ever vouched for.
        expect(await machine.peerKey.publicKey()).not.toBe(before);
        await expect(stat(join(home, 'peer-machines', 'machine-b.json'))).rejects.toThrow();
    });
});
