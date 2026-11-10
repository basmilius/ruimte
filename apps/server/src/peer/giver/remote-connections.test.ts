import { beforeEach, describe, expect, test } from 'bun:test';
import { CodedError } from '@adecore/agents';
import type { PeerStatement } from '@ruimte/pulsar';
import type { SessionEvent } from '../../wire.ts';
import type { PeerLink } from './peer-connection.ts';
import type { PeerMachine } from './peer-machines.ts';
import { PendingAdmissions } from './pending-admissions.ts';
import { RemoteConnections, type PeerDialer } from './remote-connections.ts';
import { RemoteStatus } from './remote-status.ts';

const MACHINE: PeerMachine = { machineId: 'machine-b', publicKey: 'B'.repeat(43), linkedAt: 1 };

class FakeLink implements PeerLink {
    closed = false;
    private lost: Array<() => void> = [];

    async request<T>(): Promise<T> {
        return undefined as T;
    }

    onFrame(): () => void {
        return () => undefined;
    }

    onLost(listener: () => void): void {
        this.lost.push(listener);
    }

    close(): void {
        this.closed = true;
    }

    drop(): void {
        for (const listener of this.lost) {
            listener();
        }
    }
}

function statement(): PeerStatement {
    return {
        machineId: 'machine-b',
        machinePublicKey: MACHINE.publicKey,
        accountId: 'owner',
        peerPublicKey: 'P'.repeat(43),
        peerMachineId: 'machine-a',
        peerMachinePublicKey: 'A'.repeat(43),
        nonce: 'n'.repeat(22),
        issuedAt: 1000,
        expiresAt: 601_000,
        signature: 's'.repeat(86)
    };
}

let known: PeerMachine | null;
let owed: number;
let unstarted: string[];
let dials: Array<PeerStatement | null>;
let next: Promise<PeerLink> | (() => Promise<PeerLink>);
let status: RemoteStatus;
let pending: PendingAdmissions;
let connections: RemoteConnections;
let heard: string[];

beforeEach(() => {
    known = MACHINE;
    owed = 0;
    unstarted = [];
    dials = [];
    heard = [];
    status = new RemoteStatus();
    pending = new PendingAdmissions(() => 2000);
    status.subscribe('client-1', (event: SessionEvent) => {
        if (event.event === 'remote.status') {
            heard.push(`${event.payload.state}:${event.payload.owed}`);
        }
    });
    const dialer: PeerDialer = {
        dial: (_machine, offered) => {
            dials.push(offered);
            return typeof next === 'function' ? next() : next;
        }
    };
    connections = new RemoteConnections({
        machines: { get: () => known },
        pending,
        dialer,
        status,
        owed: () => owed,
        unstarted: (_machineId, except) => unstarted.filter((nodeId) => nodeId !== except)
    });
    next = async () => new FakeLink();
});

describe('the links to other machines', () => {
    test('opens one, offers the pending statement and drops it once the machine let the key in', async () => {
        pending.hold(statement());
        const link = await connections.connect('machine-b');
        expect(dials).toEqual([statement()]);
        expect(connections.isOpen('machine-b')).toBe(true);
        expect(connections.link('machine-b')).toBe(link);
        expect(pending.peek('machine-b')).toBeNull();
        expect(heard).toEqual(['connecting:0', 'open:0']);
    });

    test('hands a statement to a machine whose link is open over a link of its own, and keeps the open one', async () => {
        const open = new FakeLink();
        next = async () => open;
        await connections.connect('machine-b');
        const renewal = new FakeLink();
        next = async () => renewal;
        pending.hold(statement());
        await connections.connectWithStatement('machine-b');
        expect(dials).toEqual([null, statement()]);
        expect(renewal.closed).toBe(true);
        expect(open.closed).toBe(false);
        expect(connections.link('machine-b')).toBe(open);
        expect(pending.peek('machine-b')).toBeNull();
    });

    test('opens a closed link with the statement and dials no second time', async () => {
        pending.hold(statement());
        await connections.connectWithStatement('machine-b');
        expect(dials).toEqual([statement()]);
        expect(connections.isOpen('machine-b')).toBe(true);
    });

    test('hands the open link out without dialing again, and shares one attempt between callers', async () => {
        const [one, two] = await Promise.all([connections.connect('machine-b'), connections.connect('machine-b')]);
        expect(one).toBe(two);
        expect(await connections.connect('machine-b')).toBe(one);
        expect(dials).toHaveLength(1);
    });

    test('keeps the statement for the next try when the attempt failed, and says nothing is wrong while nothing waits on it', async () => {
        pending.hold(statement());
        next = async () => {
            throw new Error('The machine did not answer');
        };
        await expect(connections.connect('machine-b')).rejects.toThrow('did not answer');
        expect(pending.peek('machine-b')).not.toBeNull();
        expect(connections.isOpen('machine-b')).toBe(false);
        expect(heard).toEqual(['connecting:0', 'closed:0']);
    });

    test('tells a refusal by the machine from a machine that does not answer, and does not call it waiting', async () => {
        owed = 1;
        for (const code of ['not-paired', 'statements-refused']) {
            next = async () => {
                throw new CodedError(code, `The machine closed the attempt: ${code}`);
            };
            await expect(connections.connect('machine-b')).rejects.toMatchObject({ code: 'refused', refusal: code });
        }
        expect(heard).not.toContain('waiting:1');
        next = async () => {
            throw new Error('The machine did not answer the offer');
        };
        await expect(connections.connect('machine-b')).rejects.toThrow('did not answer');
        expect(heard.at(-1)).toBe('waiting:1');
    });

    test('takes another version of Ruimte for a machine to wait for, since an update ends it', async () => {
        owed = 1;
        next = async () => {
            throw new Error('This machine and this client run different versions of Ruimte');
        };
        await expect(connections.connect('machine-b')).rejects.not.toMatchObject({ code: 'refused' });
        expect(heard.at(-1)).toBe('waiting:1');
    });

    test('says the link is waiting when it failed while work for the machine is owed', async () => {
        owed = 2;
        next = async () => {
            throw new Error('The machine did not answer');
        };
        await expect(connections.connect('machine-b')).rejects.toThrow();
        expect(heard).toEqual(['connecting:2', 'waiting:2']);
        connections.waiting('machine-b', 5000);
        expect(status.get('machine-b')).toEqual({ machineId: 'machine-b', state: 'waiting', owed: 2, nextAttemptAt: 5000 });
    });

    test('names the broker of a machine that has one of its own in the standing, and the next try when it waits', async () => {
        known = { ...MACHINE, brokerUrl: 'wss://broker.example.com' };
        owed = 1;
        await connections.connect('machine-b');
        expect(status.get('machine-b')).toEqual({ machineId: 'machine-b', state: 'open', owed: 1, brokerUrl: 'wss://broker.example.com' });
        connections.waiting('machine-b', 9000);
        expect(status.get('machine-b')).toMatchObject({ state: 'waiting', nextAttemptAt: 9000, brokerUrl: 'wss://broker.example.com' });
    });

    test('refuses a machine that was never linked, without dialing', async () => {
        known = null;
        await expect(connections.connect('machine-b')).rejects.toMatchObject({ code: 'unknown-machine' });
        expect(dials).toEqual([]);
    });

    test('a lost link is dropped, closed and reported to whoever owes work to the machine', async () => {
        owed = 1;
        const lost: string[] = [];
        connections.onLost((machineId) => lost.push(machineId));
        const link = (await connections.connect('machine-b')) as FakeLink;
        link.drop();
        link.drop();
        expect(lost).toEqual(['machine-b']);
        expect(link.closed).toBe(true);
        expect(connections.isOpen('machine-b')).toBe(false);
        expect(heard.at(-1)).toBe('waiting:1');
    });

    test('closing on purpose is not a loss', async () => {
        const lost: string[] = [];
        connections.onLost((machineId) => lost.push(machineId));
        const link = (await connections.connect('machine-b')) as FakeLink;
        connections.close('machine-b');
        expect(link.closed).toBe(true);
        expect(lost).toEqual([]);
        expect(heard.at(-1)).toBe('closed:0');
        expect(status.get('machine-b')).toBeNull();
    });

    test('a handshake that finishes after the machine left its account is closed at once and kept by nobody', async () => {
        const late = Promise.withResolvers<PeerLink>();
        next = () => late.promise;
        const attempt = connections.connect('machine-b');
        connections.closeAll();
        known = null;
        const link = new FakeLink();
        late.resolve(link);
        await expect(attempt).rejects.toMatchObject({ code: 'closed' });
        expect(link.closed).toBe(true);
        expect(connections.isOpen('machine-b')).toBe(false);
        expect(status.get('machine-b')).toBeNull();
    });

    test('a handshake that finishes after its machine was unlinked is closed, and the next attempt dials anew', async () => {
        const late = Promise.withResolvers<PeerLink>();
        next = () => late.promise;
        const attempt = connections.connect('machine-b');
        connections.close('machine-b');
        next = async () => new FakeLink();
        const fresh = await connections.connect('machine-b');
        const stale = new FakeLink();
        late.resolve(stale);
        await expect(attempt).rejects.toMatchObject({ code: 'closed' });
        expect(stale.closed).toBe(true);
        expect(connections.link('machine-b')).toBe(fresh);
    });
});

describe('the standing of the links', () => {
    test('tells a client that subscribes later what stands now, and tells the clients only of a change', () => {
        status.set({ machineId: 'machine-b', state: 'open', owed: 0 });
        status.set({ machineId: 'machine-b', state: 'open', owed: 0 });
        expect(heard).toEqual(['open:0']);
        const late: string[] = [];
        status.subscribe('client-2', (event: SessionEvent) => {
            if (event.event === 'remote.status') {
                late.push(`${event.payload.machineId}:${event.payload.state}`);
            }
        });
        expect(late).toEqual(['machine-b:open']);
    });
});

describe('the tasks that have not started', () => {
    test('a machine owed work that no standing told of yet, as after a restart, gets one that names only what was not asked', () => {
        connections.refresh('machine-b');
        expect(status.get('machine-b')).toBeNull();
        owed = 1;
        connections.refresh('machine-b');
        expect(status.get('machine-b')).toEqual({ machineId: 'machine-b', state: 'waiting', owed: 1 });
        unstarted = ['chat-a'];
        owed = 2;
        connections.refresh('machine-b');
        expect(status.get('machine-b')).toMatchObject({ state: 'waiting', owed: 2, unstartedNodeIds: ['chat-a'] });
    });

    test('are named in the standing of a link that is down, and left out once they started', async () => {
        const events: Array<string[] | undefined> = [];
        status.subscribe('client-2', (event: SessionEvent) => {
            if (event.event === 'remote.status') {
                events.push(event.payload.unstartedNodeIds);
            }
        });
        owed = 2;
        unstarted = ['chat-a', 'chat-b'];
        next = Promise.reject(new Error('That machine is not online'));
        await connections.connect('machine-b').catch(() => undefined);
        expect(status.get('machine-b')).toMatchObject({ state: 'waiting', unstartedNodeIds: ['chat-a', 'chat-b'] });

        // One was asked and is done; the standing says so before its entry has left the outbox.
        connections.refresh('machine-b', 'chat-a');
        expect(status.get('machine-b')?.unstartedNodeIds).toEqual(['chat-b']);
        unstarted = [];
        connections.refresh('machine-b');
        expect(status.get('machine-b')).not.toHaveProperty('unstartedNodeIds');
        expect(events.at(-1)).toBeUndefined();
    });
});
