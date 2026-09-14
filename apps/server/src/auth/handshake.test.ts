import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientAuthMessage, clientChannelMessage, daemonChallengeMessage, daemonChannelMessage } from '@ruimte/contracts';
import { AuthStore } from './auth-store.ts';
import { CHALLENGE_TTL_MS, Handshake, TICKET_TTL_MS } from './handshake.ts';
import { generateKeyPair, signMessage, verifySignature } from './keys.ts';

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

/* What a client does: take the nonce, sign what the contract says, hand it back. */
const signIn = async (key: { publicKey: string; privateKey: string }, daemonId = DAEMON_ID) => {
    const { challenge } = handshake.challenge();
    return handshake.redeem({
        publicKey: key.publicKey,
        challenge,
        signature: signMessage(key.privateKey, clientAuthMessage(daemonId, challenge, key.publicKey))
    });
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-handshake-'));
    clock = 5_000_000;
    store = new AuthStore(home, () => clock);
    handshake = new Handshake(store, identity, () => clock);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('Handshake', () => {
    test('the daemon signs its own challenge, so a client can tell which machine answered', () => {
        const answer = handshake.challenge();
        expect(answer.daemon.id).toBe(DAEMON_ID);
        expect(answer.daemon.publicKey).toBe(daemon.publicKey);
        expect(verifySignature(daemon.publicKey, daemonChallengeMessage(DAEMON_ID, answer.challenge), answer.daemon.signature)).toBe(true);
        // Another machine's key does not open this, which is the whole of the pinning.
        expect(verifySignature(generateKeyPair().publicKey, daemonChallengeMessage(DAEMON_ID, answer.challenge), answer.daemon.signature)).toBe(false);
        expect(handshake.challenge().challenge).not.toBe(answer.challenge);
    });

    test('a paired key signs its way to a ticket that opens the socket', async () => {
        const key = generateKeyPair();
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const ticket = await signIn(key);
        expect(ticket?.expiresIn).toBe(TICKET_TTL_MS);
        expect(handshake.ticketSession(ticket!.ticket)).toBe(paired!.id);
        expect(handshake.ticketSession('made-up')).toBeNull();
        // Every connection signs again, and no two connections carry the same credential.
        const second = await signIn(key);
        expect(second!.ticket).not.toBe(ticket!.ticket);
    });

    test('a signature that is not over the challenge gets nothing', async () => {
        const key = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const { challenge } = handshake.challenge();

        expect(await handshake.redeem({ publicKey: key.publicKey, challenge, signature: signMessage(key.privateKey, 'something else') })).toBeNull();
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge, signature: 'not-a-signature' })).toBeNull();
    });

    test('a signature made for another daemon does not open this one', async () => {
        const key = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        expect(await signIn(key, 'some-other-daemon')).toBeNull();
    });

    test('a challenge is good for one attempt and one minute', async () => {
        const key = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const { challenge } = handshake.challenge();
        const signature = signMessage(key.privateKey, clientAuthMessage(DAEMON_ID, challenge, key.publicKey));

        expect(await handshake.redeem({ publicKey: key.publicKey, challenge, signature })).not.toBeNull();
        // The same signature over the same nonce, which is exactly what a replay looks like.
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge, signature })).toBeNull();

        const stale = handshake.challenge();
        clock += CHALLENGE_TTL_MS + 1;
        expect(
            await handshake.redeem({
                publicKey: key.publicKey,
                challenge: stale.challenge,
                signature: signMessage(key.privateKey, clientAuthMessage(DAEMON_ID, stale.challenge, key.publicKey))
            })
        ).toBeNull();
    });

    test('a key this daemon never paired with signs correctly and still gets nowhere', async () => {
        expect(await signIn(generateKeyPair())).toBeNull();
    });

    test('revoking takes the tickets away as well as the pairing', async () => {
        const key = generateKeyPair();
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const ticket = await signIn(key);

        await store.revoke(paired!.id);
        handshake.revoke(paired!.id);
        expect(handshake.ticketSession(ticket!.ticket)).toBeNull();
        expect(await signIn(key)).toBeNull();
    });

    test('a ticket goes stale on its own, and using it puts its life back', async () => {
        const key = generateKeyPair();
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const ticket = await signIn(key);

        clock += TICKET_TTL_MS - 1;
        expect(handshake.ticketSession(ticket!.ticket)).toBe(paired!.id);
        clock += TICKET_TTL_MS - 1;
        expect(handshake.ticketSession(ticket!.ticket)).toBe(paired!.id);
        clock += TICKET_TTL_MS + 1;
        expect(handshake.ticketSession(ticket!.ticket)).toBeNull();
    });

    test('a client that keeps reconnecting does not pile up tickets on the daemon', async () => {
        const key = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const tickets = [];
        for (let i = 0; i < 12; i++) {
            tickets.push((await signIn(key))!.ticket);
        }
        const alive = tickets.filter((ticket) => handshake.ticketSession(ticket) !== null);
        expect(alive.length).toBe(8);
        expect(alive).toEqual(tickets.slice(-8));
    });

    test('a caller that asks for nonces and never signs one does not grow the daemon', async () => {
        const key = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'laptop', publicKey: key.publicKey });
        const first = handshake.challenge().challenge;
        for (let i = 0; i < 600; i++) {
            handshake.challenge();
        }
        const signature = signMessage(key.privateKey, clientAuthMessage(DAEMON_ID, first, key.publicKey));
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge: first, signature })).toBeNull();
        // The one that was just handed out still works, so a flood costs a re-ask and nothing more.
        expect(await signIn(key)).not.toBeNull();
    });

    test('signing in for the first time drops the session token that client paired with', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'container' });
        const key = generateKeyPair();
        await store.registerKey(paired!.id, key.publicKey);
        expect(await store.authenticate(paired!.sessionToken!)).toBe(paired!.id);

        expect(await signIn(key)).not.toBeNull();
        expect(await store.authenticate(paired!.sessionToken!)).toBeNull();
    });
});

describe('Handshake on a direct channel', () => {
    const BINDING = '[["sha-256 AA"],["sha-256 BB"]]';

    const pairedKey = async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'phone' });
        const key = generateKeyPair();
        await store.registerKey(paired!.id, key.publicKey);
        return key;
    };

    test('the daemon signs the binding with the challenge, and not the message the HTTP handshake signs', () => {
        const { challenge, daemon: signed } = handshake.challenge(BINDING);
        expect(verifySignature(daemon.publicKey, daemonChannelMessage(DAEMON_ID, challenge, BINDING), signed.signature)).toBe(true);
        expect(verifySignature(daemon.publicKey, daemonChallengeMessage(DAEMON_ID, challenge), signed.signature)).toBe(false);
    });

    test('a key that signs the same binding gets a ticket', async () => {
        const key = await pairedKey();
        const { challenge } = handshake.challenge(BINDING);
        const signature = signMessage(key.privateKey, clientChannelMessage(DAEMON_ID, challenge, key.publicKey, BINDING));
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge, signature }, BINDING)).not.toBeNull();
    });

    test('a signature over another DTLS session, or over no session at all, gets nothing', async () => {
        const key = await pairedKey();
        const other = handshake.challenge(BINDING).challenge;
        const elsewhere = signMessage(key.privateKey, clientChannelMessage(DAEMON_ID, other, key.publicKey, '[["sha-256 CC"],["sha-256 BB"]]'));
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge: other, signature: elsewhere }, BINDING)).toBeNull();

        const plain = handshake.challenge(BINDING).challenge;
        const http = signMessage(key.privateKey, clientAuthMessage(DAEMON_ID, plain, key.publicKey));
        expect(await handshake.redeem({ publicKey: key.publicKey, challenge: plain, signature: http })).toBeNull();
    });

    test('a challenge from the HTTP route cannot be spent on a channel, nor one from a channel on another', () => {
        expect(handshake.spend(handshake.challenge().challenge, BINDING)).toBe(false);
        expect(handshake.spend(handshake.challenge(BINDING).challenge, '[[],[]]')).toBe(false);
        const challenge = handshake.challenge(BINDING).challenge;
        expect(handshake.spend(challenge, BINDING)).toBe(true);
        expect(handshake.spend(challenge, BINDING)).toBe(false);
    });
});
