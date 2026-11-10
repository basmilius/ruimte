import { beforeEach, describe, expect, test } from 'bun:test';
import type { AuthTicketPayload } from '@ruimte/contracts';
import { clientAuthMessage, clientChannelMessage, daemonChallengeMessage, daemonChannelMessage } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { AuthStore } from './auth-store.ts';
import { CHALLENGE_TTL_MS, Handshake, TICKET_TTL_MS } from './handshake.ts';
import { generateKeyPair, signMessage } from './keys.ts';
import { admitClient } from './test-admit.ts';

let home: string;
let clock: number;
let store: AuthStore;
let handshake: Handshake;

const daemon = generateKeyPair();
const DAEMON_ID = 'daemon-abc';

const identity = {
    id: DAEMON_ID,
    publicKey: daemon.publicKey,
    sign: (message: string) => signMessage(daemon.privateKey, message)
};

// The binding of one direct channel, which every challenge and signature here is made over.
const BINDING = '[["sha-256 AA"],["sha-256 BB"]]';

type Key = { publicKey: string; privateKey: string };

function proof(key: Key, daemonId = DAEMON_ID, target = handshake) {
    const { challenge } = target.challenge(BINDING);
    return {
        publicKey: key.publicKey,
        challenge,
        signature: signMessage(key.privateKey, clientChannelMessage(daemonId, challenge, key.publicKey, BINDING))
    };
}

async function redeem(payload: AuthTicketPayload) {
    return (await handshake.redeemChannel(payload, BINDING))?.ticket ?? null;
}

function signIn(key: Key, daemonId = DAEMON_ID) {
    return redeem(proof(key, daemonId));
}

function admit(key: { publicKey: string }): Promise<string> {
    return admitClient(store, key.publicKey);
}

async function sessionOf(ticket: string) {
    return (await handshake.ticketAccess(ticket, 'bytes'))?.sessionId;
}

const newHome = tempHomes('ruimte-handshake-');

beforeEach(async () => {
    home = await newHome();
    clock = 5_000_000;
    store = new AuthStore(home, () => clock);
    handshake = new Handshake(store, identity, () => clock);
});

describe('Handshake', () => {
    test('the daemon signs its own challenge, so a client can tell which machine answered', () => {
        const answer = handshake.challenge(BINDING);
        expect(answer.daemon.id).toBe(DAEMON_ID);
        expect(answer.daemon.publicKey).toBe(daemon.publicKey);
        expect(verifySignature(daemon.publicKey, daemonChannelMessage(DAEMON_ID, answer.challenge, BINDING), answer.daemon.signature)).toBe(true);
        // Another machine's key does not open this, which is the whole of the pinning.
        expect(verifySignature(generateKeyPair().publicKey, daemonChannelMessage(DAEMON_ID, answer.challenge, BINDING), answer.daemon.signature)).toBe(false);
        expect(handshake.challenge(BINDING).challenge).not.toBe(answer.challenge);
    });

    test('a key the machine let in signs its way to a ticket that opens the socket', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const ticket = await signIn(key);
        expect(ticket?.expiresIn).toBe(TICKET_TTL_MS);
        expect(await sessionOf(ticket!.ticket)).toBe(sessionId);
        expect(await handshake.ticketAccess('made-up', 'bytes')).toBeNull();
        // Every connection signs again, and no two connections carry the same credential.
        const second = await signIn(key);
        expect(second!.ticket).not.toBe(ticket!.ticket);
    });

    test('a signature that is not over the challenge gets nothing', async () => {
        const key = generateKeyPair();
        await admit(key);
        const first = handshake.challenge(BINDING).challenge;
        expect(await redeem({ publicKey: key.publicKey, challenge: first, signature: signMessage(key.privateKey, 'something else') })).toBeNull();
        const second = handshake.challenge(BINDING).challenge;
        expect(await redeem({ publicKey: key.publicKey, challenge: second, signature: 'not-a-signature' })).toBeNull();
    });

    test('a signature made for another daemon does not open this one', async () => {
        const key = generateKeyPair();
        await admit(key);
        expect(await signIn(key, 'some-other-daemon')).toBeNull();
    });

    test('a challenge is good for one attempt and one minute', async () => {
        const key = generateKeyPair();
        await admit(key);
        const signed = proof(key);

        expect(await redeem(signed)).not.toBeNull();
        // The same signature over the same nonce, which is exactly what a replay looks like.
        expect(await redeem(signed)).toBeNull();

        const stale = proof(key);
        clock += CHALLENGE_TTL_MS + 1;
        expect(await redeem(stale)).toBeNull();
    });

    test('a key this daemon never let in signs correctly and still gets nowhere', async () => {
        expect(await signIn(generateKeyPair())).toBeNull();
    });

    test('revoking takes the tickets away as well as the access', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const ticket = await signIn(key);

        await store.revoke(sessionId);
        handshake.revoke(sessionId);
        expect(await handshake.ticketAccess(ticket!.ticket, 'bytes')).toBeNull();
        expect(await signIn(key)).toBeNull();
    });

    test('a ticket goes stale on its own, and using it puts its life back', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const ticket = await signIn(key);

        clock += TICKET_TTL_MS - 1;
        expect(await sessionOf(ticket!.ticket)).toBe(sessionId);
        clock += TICKET_TTL_MS - 1;
        expect(await sessionOf(ticket!.ticket)).toBe(sessionId);
        clock += TICKET_TTL_MS + 1;
        expect(await handshake.ticketAccess(ticket!.ticket, 'bytes')).toBeNull();
    });

    test('a client that keeps reconnecting does not pile up tickets on the daemon', async () => {
        const key = generateKeyPair();
        await admit(key);
        const tickets = [];
        for (let i = 0; i < 12; i++) {
            tickets.push((await signIn(key))!.ticket);
        }
        const alive = [];
        for (const ticket of tickets) {
            if ((await handshake.ticketAccess(ticket, 'bytes')) !== null) {
                alive.push(ticket);
            }
        }
        expect(alive.length).toBe(8);
        expect(alive).toEqual(tickets.slice(-8));
    });

    test('a ticket opens one socket and serves bytes for as long as it lives', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const { ticket } = (await signIn(key))!;

        expect(await handshake.ticketAccess(ticket, 'socket')).toEqual({ sessionId: sessionId });
        expect(await handshake.ticketAccess(ticket, 'socket')).toBeNull();
        expect(await sessionOf(ticket)).toBe(sessionId);
        handshake.socketClosed(ticket);
        expect(await handshake.ticketAccess(ticket, 'socket')).toBeNull();
        expect(await sessionOf(ticket)).toBe(sessionId);
    });

    test('a ticket behind an open socket outlives its time, and lives its time again once the socket closes', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const { ticket } = (await signIn(key))!;
        await handshake.ticketAccess(ticket, 'socket');

        clock += 3 * TICKET_TTL_MS;
        // Reconnects elsewhere hand out tickets and sweep; neither takes the one the open socket stands on.
        for (let i = 0; i < 12; i++) {
            await signIn(key);
        }
        expect(await sessionOf(ticket)).toBe(sessionId);
        handshake.socketClosed(ticket);
        clock += TICKET_TTL_MS + 1;
        expect(await handshake.ticketAccess(ticket, 'bytes')).toBeNull();
    });

    test('the local secret trades for a ticket that lets in the app on this machine', async () => {
        const { ticket, expiresIn } = handshake.issueLocalTicket();
        expect(expiresIn).toBe(TICKET_TTL_MS);
        expect(await handshake.ticketAccess(ticket, 'socket')).toEqual({ sessionId: null });
        expect(await handshake.ticketAccess(ticket, 'socket')).toBeNull();
        expect(await handshake.ticketAccess(ticket, 'bytes')).toEqual({ sessionId: null });
    });

    test('a revoke between looking the key up and handing out the ticket leaves no ticket', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const racing = Object.create(store) as AuthStore;
        racing.sessionForPublicKey = async (publicKey) => {
            const sessionId = await store.sessionForPublicKey(publicKey);
            await store.revoke(sessionId!);
            handshake.revoke(sessionId!);
            return sessionId;
        };
        handshake = new Handshake(racing, identity, () => clock);
        expect(await signIn(key)).toBeNull();
        expect(await store.hasSession(sessionId)).toBe(false);
    });

    test.each([
        ['client', undefined],
        ['peer', { machineId: 'machine-a', machinePublicKey: generateKeyPair().publicKey }]
    ])('a %s revoked right after it was seen gets nothing, never a client grant', async (_kind, peer) => {
        const key = generateKeyPair();
        const sessionId = await admitClient(store, key.publicKey, 'Laptop', 'owner', peer);
        const racing = Object.create(store) as AuthStore;
        racing.noteSeen = async (sessionId) => {
            const noted = await store.noteSeen(sessionId);
            await store.revoke(sessionId);
            handshake.revoke(sessionId);
            return noted;
        };
        handshake = new Handshake(racing, identity, () => clock);
        expect(await handshake.redeemChannel(proof(key), BINDING)).toBeNull();
        expect(await store.hasSession(sessionId)).toBe(false);
    });

    test('a grant revoked before its channel is registered is no longer granted', async () => {
        const key = generateKeyPair();
        const sessionId = await admit(key);
        const grant = await handshake.redeemChannel(proof(key), BINDING);
        expect(grant).toMatchObject({ sessionId });
        expect(handshake.granted(sessionId)).toBe(true);

        handshake.revoke(sessionId);

        expect(handshake.granted(sessionId)).toBe(false);
        expect(await handshake.ticketAccess(grant!.ticket!.ticket, 'socket')).toBeNull();
    });
});

describe('Handshake on a direct channel', () => {
    const pairedKey = async () => {
        const key = generateKeyPair();
        await admit(key);
        return key;
    };

    test('the daemon signs the binding with the challenge, and not the message the HTTP handshake signs', () => {
        const { challenge, daemon: signed } = handshake.challenge(BINDING);
        expect(verifySignature(daemon.publicKey, daemonChannelMessage(DAEMON_ID, challenge, BINDING), signed.signature)).toBe(true);
        expect(verifySignature(daemon.publicKey, daemonChallengeMessage(DAEMON_ID, challenge), signed.signature)).toBe(false);
    });

    test('a signature over another DTLS session, or over no session at all, gets nothing', async () => {
        const key = await pairedKey();
        const other = handshake.challenge(BINDING).challenge;
        const elsewhere = signMessage(key.privateKey, clientChannelMessage(DAEMON_ID, other, key.publicKey, '[["sha-256 CC"],["sha-256 BB"]]'));
        expect(await redeem({ publicKey: key.publicKey, challenge: other, signature: elsewhere })).toBeNull();

        const plain = handshake.challenge(BINDING).challenge;
        const http = signMessage(key.privateKey, clientAuthMessage(DAEMON_ID, plain, key.publicKey));
        expect(await redeem({ publicKey: key.publicKey, challenge: plain, signature: http })).toBeNull();
    });

    test('a challenge from one channel cannot be spent on another', () => {
        expect(handshake.spend(handshake.challenge(BINDING).challenge, '[[],[]]')).toBe(false);
        const challenge = handshake.challenge(BINDING).challenge;
        expect(handshake.spend(challenge, BINDING)).toBe(true);
        expect(handshake.spend(challenge, BINDING)).toBe(false);
    });
});

describe('Handshake and a peer', () => {
    function admitPeer(key: { publicKey: string }): Promise<string> {
        return admitClient(store, key.publicKey, 'Studio', 'owner', { machineId: 'machine-a', machinePublicKey: generateKeyPair().publicKey });
    }

    test('a peer proves its key and is let in as a machine, with no ticket for the HTTP routes', async () => {
        const key = generateKeyPair();
        const sessionId = await admitPeer(key);
        expect(await handshake.redeemChannel(proof(key), BINDING)).toEqual({ sessionId, ticket: null, peer: { machineId: 'machine-a' } });
    });

    test('a client beside a peer still gets its own ticket', async () => {
        await admitPeer(generateKeyPair());

        const client = generateKeyPair();
        const clientSession = await admit(client);
        const grant = await handshake.redeemChannel(proof(client), BINDING);
        expect(grant).toMatchObject({ sessionId: clientSession, peer: null });
        expect(await sessionOf(grant!.ticket!.ticket)).toBe(clientSession);
    });

    test('a ticket that somehow names a peer session opens nothing', async () => {
        let becamePeer = false;
        const swappable = {
            sessionForPublicKey: (publicKey: string) => store.sessionForPublicKey(publicKey),
            noteSeen: (id: string) => store.noteSeen(id),
            standing: async (id: string) =>
                becamePeer ? { peer: { machineId: 'machine-a', machinePublicKey: generateKeyPair().publicKey } } : store.standing(id)
        };
        const own = new Handshake(swappable as unknown as AuthStore, identity, () => clock);
        const client = generateKeyPair();
        const sessionId = await admit(client);
        const grant = await own.redeemChannel(proof(client, DAEMON_ID, own), BINDING);
        expect(await own.ticketAccess(grant!.ticket!.ticket, 'bytes')).toEqual({ sessionId });
        becamePeer = true;
        expect(await own.ticketAccess(grant!.ticket!.ticket, 'bytes')).toBeNull();
    });
});
