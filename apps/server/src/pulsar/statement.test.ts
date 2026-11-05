import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PushSubscribePayloadSchema, clientChannelMessage } from '@ruimte/contracts';
import {
    ACCESS_STATEMENT_LIFETIME_MS,
    PULSAR_STATEMENT_PUBLIC_KEYS,
    accessStatementMessage,
    accessStatementV2Message,
    peerStatementMessage,
    type AccessStatement,
    type PeerStatement,
    type SignalAccess,
    type SignalOfferAccess
} from '@ruimte/pulsar';
import { z } from 'zod';
import { AuthStore, PEER_ATTESTATION_TTL_MS } from '../auth/auth-store.ts';
import { Handshake } from '../auth/handshake.ts';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { PeerLinks } from '../projects/peer-links.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { SignalGate } from './signal-gate.ts';
import { STATEMENT_CLOCK_SKEW_MS, StatementGate, TEST_STATEMENT_KEY_VARIABLE, checkPeerStatement, checkStatement, trustedStatementKeys } from './statement.ts';
import { signedSignal } from './test-helpers.ts';

const MACHINE_ID = 'machine-under-test';
const NOW = 1_800_000_000_000;

// A stand-in for the address book, with a key of its own and nothing to do with the pinned one.
const addressBook = generateKeyPair();

function statementFor(clientPublicKey: string, overrides: Partial<AccessStatement> = {}, signer = addressBook): AccessStatement {
    const base = {
        machineId: MACHINE_ID,
        clientPublicKey,
        nonce: `nonce-${Math.random().toString(36).slice(2)}-${'n'.repeat(16)}`,
        issuedAt: NOW,
        expiresAt: NOW + ACCESS_STATEMENT_LIFETIME_MS,
        ...overrides
    };
    return {
        ...base,
        signature: signMessage(signer.privateKey, accessStatementMessage(base.machineId, base.clientPublicKey, base.nonce, base.issuedAt, base.expiresAt))
    };
}

// This machine's own key, which a statement v2 has to name.
const machine = generateKeyPair();

/* A statement as the address book signs it now: the v1 signature, and the v2 one over the key its row lists and the account. */
function statementV2For(
    clientPublicKey: string,
    accountId: string,
    machinePublicKey = machine.publicKey,
    overrides: Partial<AccessStatement> = {},
    signer = addressBook
): AccessStatement {
    const v1 = statementFor(clientPublicKey, overrides, signer);
    return {
        ...v1,
        machinePublicKey,
        accountId,
        accountSignature: signMessage(
            signer.privateKey,
            accessStatementV2Message(v1.machineId, machinePublicKey, accountId, v1.clientPublicKey, v1.nonce, v1.issuedAt, v1.expiresAt)
        )
    };
}

describe('checkStatement', () => {
    const client = generateKeyPair();
    const expected = {
        machineId: MACHINE_ID,
        machinePublicKey: machine.publicKey,
        clientPublicKey: client.publicKey,
        trustedKeys: [addressBook.publicKey],
        now: NOW + 1_000
    };

    test('a v2 statement that names this machine key and is signed over it holds', () => {
        expect(checkStatement(statementV2For(client.publicKey, 'account-1'), expected)).toBeNull();
    });

    test('a v2 statement naming another key for this machine id is refused, however well it is signed', () => {
        const squatter = generateKeyPair();
        expect(checkStatement(statementV2For(client.publicKey, 'account-1', squatter.publicKey), expected)).toBe('wrong-machine-key');
    });

    test('a v2 statement whose account was changed after signing, or that carries half of v2, is refused', () => {
        expect(checkStatement({ ...statementV2For(client.publicKey, 'account-1'), accountId: 'account-2' }, expected)).toBe('bad-signature');
        expect(checkStatement(statementV2For(client.publicKey, 'account-1', machine.publicKey, {}, generateKeyPair()), expected)).toBe('bad-signature');
        const { accountSignature: _dropped, ...half } = statementV2For(client.publicKey, 'account-1');
        expect(checkStatement(half, expected)).toBe('bad-signature');
    });

    test('a statement for this machine and this key, inside its lifetime and signed by a trusted key, holds', () => {
        expect(checkStatement(statementFor(client.publicKey), expected)).toBeNull();
    });

    test('a statement that ran out is refused, with the skew allowed on either side and no more', () => {
        const statement = statementFor(client.publicKey);
        expect(checkStatement(statement, { ...expected, now: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS })).toBeNull();
        expect(checkStatement(statement, { ...expected, now: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS + 1 })).toBe('expired');
        expect(checkStatement(statement, { ...expected, now: statement.issuedAt - STATEMENT_CLOCK_SKEW_MS - 1 })).toBe('not-yet-valid');
    });

    test('a statement for another machine or another key is refused', () => {
        expect(checkStatement(statementFor(client.publicKey, { machineId: 'the-machine-next-door' }), expected)).toBe('wrong-machine');
        expect(checkStatement(statementFor(generateKeyPair().publicKey), expected)).toBe('wrong-key');
    });

    test('a statement signed by anyone but a trusted key is refused, and so is one whose fields were changed after signing', () => {
        expect(checkStatement(statementFor(client.publicKey, {}, generateKeyPair()), expected)).toBe('bad-signature');
        const stretched = { ...statementFor(client.publicKey), expiresAt: NOW + ACCESS_STATEMENT_LIFETIME_MS - 1 };
        expect(checkStatement(stretched, expected)).toBe('bad-signature');
        expect(checkStatement(statementFor(client.publicKey), { ...expected, trustedKeys: PULSAR_STATEMENT_PUBLIC_KEYS })).toBe('bad-signature');
    });
});

describe('trustedStatementKeys', () => {
    const testKey = generateKeyPair().publicKey;

    test('the pinned keys, unless a daemon running from source is handed a test key', () => {
        expect(trustedStatementKeys({}, false)).toBe(PULSAR_STATEMENT_PUBLIC_KEYS);
        expect(trustedStatementKeys({ [TEST_STATEMENT_KEY_VARIABLE]: testKey }, false)).toEqual([testKey]);
    });

    test('a compiled daemon never takes a test key, and something that is not a key is ignored', () => {
        expect(trustedStatementKeys({ [TEST_STATEMENT_KEY_VARIABLE]: testKey }, true)).toBe(PULSAR_STATEMENT_PUBLIC_KEYS);
        expect(trustedStatementKeys({ [TEST_STATEMENT_KEY_VARIABLE]: 'not-a-key' }, false)).toBe(PULSAR_STATEMENT_PUBLIC_KEYS);
    });
});

// The machine that works here, as the account lists it.
const peerMachine = generateKeyPair();

/* A peer statement as the address book signs it: both machine keys, the account and the peer key. */
function peerStatementFor(peerPublicKey: string, accountId: string, overrides: Partial<PeerStatement> = {}, signer = addressBook): PeerStatement {
    const base = {
        machineId: MACHINE_ID,
        machinePublicKey: machine.publicKey,
        accountId,
        peerPublicKey,
        peerMachineId: 'machine-a',
        peerMachinePublicKey: peerMachine.publicKey,
        nonce: `peer-nonce-${Math.random().toString(36).slice(2)}-${'n'.repeat(16)}`,
        issuedAt: NOW,
        expiresAt: NOW + 600_000,
        ...overrides
    };
    return {
        ...base,
        signature: signMessage(
            signer.privateKey,
            peerStatementMessage(
                base.machineId,
                base.machinePublicKey,
                base.accountId,
                base.peerPublicKey,
                base.peerMachineId,
                base.peerMachinePublicKey,
                base.nonce,
                base.issuedAt,
                base.expiresAt
            )
        )
    };
}

describe('checkPeerStatement', () => {
    const peer = generateKeyPair();
    const expected = {
        machineId: MACHINE_ID,
        machinePublicKey: machine.publicKey,
        clientPublicKey: peer.publicKey,
        trustedKeys: [addressBook.publicKey],
        now: NOW + 1_000
    };

    test('a peer statement for this machine and this key, inside its ten minutes, holds', () => {
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner'), expected)).toBeNull();
        const statement = peerStatementFor(peer.publicKey, 'owner');
        expect(checkPeerStatement(statement, { ...expected, now: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS })).toBeNull();
        expect(checkPeerStatement(statement, { ...expected, now: statement.expiresAt + STATEMENT_CLOCK_SKEW_MS + 1 })).toBe('expired');
        expect(checkPeerStatement(statement, { ...expected, now: statement.issuedAt - STATEMENT_CLOCK_SKEW_MS - 1 })).toBe('not-yet-valid');
    });

    test('is refused for another machine, another machine key or another offering key', () => {
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner', { machineId: 'next-door' }), expected)).toBe('wrong-machine');
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner', { machinePublicKey: generateKeyPair().publicKey }), expected)).toBe(
            'wrong-machine-key'
        );
        expect(checkPeerStatement(peerStatementFor(generateKeyPair().publicKey, 'owner'), expected)).toBe('wrong-key');
    });

    test('is refused when the peer is this machine itself, by id or by either key', () => {
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner', { peerMachineId: MACHINE_ID }), expected)).toBe('wrong-peer');
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner', { peerMachinePublicKey: machine.publicKey }), expected)).toBe('wrong-peer');
        expect(checkPeerStatement(peerStatementFor(machine.publicKey, 'owner'), { ...expected, clientPublicKey: machine.publicKey })).toBe('wrong-peer');
    });

    test('is refused when signed by anyone but a trusted key, or changed after signing', () => {
        expect(checkPeerStatement(peerStatementFor(peer.publicKey, 'owner', {}, generateKeyPair()), expected)).toBe('bad-signature');
        expect(checkPeerStatement({ ...peerStatementFor(peer.publicKey, 'owner'), accountId: 'attacker' }, expected)).toBe('bad-signature');
        expect(checkPeerStatement({ ...peerStatementFor(peer.publicKey, 'owner'), peerMachineId: 'machine-z' }, expected)).toBe('bad-signature');
    });

    test('a client statement does not verify as a peer statement, and the other way round', () => {
        const key = generateKeyPair();
        const client = statementV2For(key.publicKey, 'owner');
        const asPeer = { ...peerStatementFor(key.publicKey, 'owner'), signature: client.signature };
        expect(checkPeerStatement(asPeer, { ...expected, clientPublicKey: key.publicKey })).toBe('bad-signature');
        const peerSigned = peerStatementFor(key.publicKey, 'owner');
        expect(
            checkStatement(
                { ...client, signature: peerSigned.signature, accountSignature: peerSigned.signature },
                { ...expected, clientPublicKey: key.publicKey }
            )
        ).toBe('bad-signature');
    });
});

describe('StatementGate', () => {
    let home: string;
    let store: AuthStore;
    let now: number;

    let warnings: string[];

    const gate = (): StatementGate =>
        new StatementGate({
            machineId: MACHINE_ID,
            machinePublicKey: machine.publicKey,
            trustedKeys: [addressBook.publicKey],
            store,
            now: () => now,
            log: { log: () => undefined, warn: (line: string) => warnings.push(line) }
        });

    const access = (statement: AccessStatement, label = 'Laptop'): SignalAccess => ({ statement, label });

    const newHome = tempHomes('ruimte-statement-');

    beforeEach(async () => {
        home = await newHome();
        store = new AuthStore(home, () => now);
        now = NOW + 1_000;
        warnings = [];
    });

    test('a good statement pairs the key with the origin statement, under the label the offer gave', async () => {
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'owner'), 'Work laptop'))).toBe('admitted');
        expect(await store.sessionForPublicKey(client.publicKey)).not.toBeNull();
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'Work laptop', origin: 'statement' })]);
    });

    test('a spent nonce stays spent across a restart', async () => {
        const client = generateKeyPair();
        const statement = statementV2For(client.publicKey, 'owner');
        expect(await gate().admit(client.publicKey, access(statement))).toBe('admitted');

        store = new AuthStore(home, () => now);
        expect(
            await store.admitStatement({ publicKey: client.publicKey, label: 'Laptop', nonce: statement.nonce, keepNonceUntil: now + 1, accountId: 'owner' })
        ).toEqual({
            refused: 'replayed'
        });
        expect(await gate().admit(client.publicKey, access(statement))).toBe('refused');
    });

    test('a replayed nonce gets nothing even for a key that is still paired, and an expired statement pairs nobody', async () => {
        const client = generateKeyPair();
        const statement = statementV2For(client.publicKey, 'owner');
        expect(await gate().admit(client.publicKey, access(statement))).toBe('admitted');
        expect(await gate().admit(client.publicKey, access(statement))).toBe('refused');

        const late = generateKeyPair();
        now = NOW + ACCESS_STATEMENT_LIFETIME_MS + STATEMENT_CLOCK_SKEW_MS + 1;
        expect(await gate().admit(late.publicKey, access(statementV2For(late.publicKey, 'owner')))).toBe('refused');
        expect(await store.sessionForPublicKey(late.publicKey)).toBeNull();
    });

    test('a statement for another machine, or offered by another key than the one it names, pairs nobody', async () => {
        const client = generateKeyPair();
        const thief = generateKeyPair();
        expect(
            await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'owner', machine.publicKey, { machineId: 'the-machine-next-door' })))
        ).toBe('refused');
        expect(await gate().admit(thief.publicKey, access(statementV2For(client.publicKey, 'owner')))).toBe('refused');
        expect(await store.list(null)).toEqual([]);
    });

    test('a device a person revoked does not walk back in on a statement', async () => {
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'owner')))).toBe('admitted');
        await store.revoke((await store.list(null))[0]!.id);
        expect(await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'owner')))).toBe('refused');
        expect(await store.sessionForPublicKey(client.publicKey)).toBeNull();
    });

    test('the auth file keeps the spent nonces and forgets them once the statement could not be believed anyway', async () => {
        const client = generateKeyPair();
        const statement = statementV2For(client.publicKey, 'owner');
        await gate().admit(client.publicKey, access(statement));
        const onDisk = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { spentNonces: { nonce: string }[] };
        expect(onDisk.spentNonces.map((spent) => spent.nonce)).toEqual([statement.nonce]);

        now = statement.expiresAt + STATEMENT_CLOCK_SKEW_MS + 1;
        const other = generateKeyPair();
        await store.admitStatement({ publicKey: other.publicKey, label: 'Later', nonce: 'a-later-nonce', keepNonceUntil: now + 1, accountId: 'owner' });
        const later = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { spentNonces: { nonce: string }[] };
        expect(later.spentNonces.map((spent) => spent.nonce)).toEqual(['a-later-nonce']);
    });
    test('an account that listed this machine id under a key of its own gets nobody in', async () => {
        // The statement as the address book signs it for the squatter's account: its own key, its own account.
        const squatter = generateKeyPair();
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'attacker', squatter.publicKey)))).toBe('refused');
        expect(await store.list(null)).toEqual([]);
    });

    test('a machine on an account takes a statement of that account only, and none without an account', async () => {
        expect(await store.bindAccount('owner')).toMatchObject({ bound: true });
        const stranger = generateKeyPair();
        expect(await gate().admit(stranger.publicKey, access(statementV2For(stranger.publicKey, 'colleague')))).toBe('refused');
        const old = generateKeyPair();
        expect(await gate().admit(old.publicKey, access(statementFor(old.publicKey)))).toBe('refused');
        expect(await store.list(null)).toEqual([]);

        const owner = generateKeyPair();
        expect(await gate().admit(owner.publicKey, access(statementV2For(owner.publicKey, 'owner'), 'Phone'))).toBe('admitted');
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'Phone', origin: 'statement' })]);
    });

    test('a machine on no account refuses a v1 statement, takes a v2 one and learns no account from it', async () => {
        const old = generateKeyPair();
        expect(await gate().admit(old.publicKey, access(statementFor(old.publicKey)))).toBe('refused');
        expect(warnings.some((line) => line.includes('account-required'))).toBe(true);
        const current = generateKeyPair();
        expect(await gate().admit(current.publicKey, access(statementV2For(current.publicKey, 'someone')))).toBe('admitted');
        expect(await store.accountBinding()).toBeUndefined();
    });

    test('leaving the account takes the clients a statement let in and lets no statement in until the machine signs again', async () => {
        await store.bindAccount('owner');
        const phone = generateKeyPair();
        expect(await gate().admit(phone.publicKey, access(statementV2For(phone.publicKey, 'owner')))).toBe('admitted');
        const phoneSession = await store.sessionForPublicKey(phone.publicKey);

        expect(await store.leaveAccount()).toEqual([phoneSession!]);
        expect(await store.sessionForPublicKey(phone.publicKey)).toBeNull();
        expect(await store.list(null)).toEqual([]);
        expect(await store.accountBinding()).toBeNull();

        for (const statement of [statementV2For(phone.publicKey, 'owner'), statementFor(phone.publicKey)]) {
            expect(await gate().admit(phone.publicKey, access(statement))).toBe('refused');
        }

        expect(await store.bindAccount('next')).toMatchObject({ bound: true });
        expect(await gate().admit(phone.publicKey, access(statementV2For(phone.publicKey, 'owner')))).toBe('refused');
        expect(await gate().admit(phone.publicKey, access(statementV2For(phone.publicKey, 'next')))).toBe('admitted');
    });

    test('joining an account takes the clients another account let in on a statement, and keeps the ones it cannot place', async () => {
        const old = generateKeyPair();
        // A client a statement let in before a machine kept the account it came through.
        await writeFile(
            join(home, 'auth.json'),
            JSON.stringify({ sessions: [{ id: 'old-session', label: 'Old', publicKey: old.publicKey, origin: 'statement', createdAt: now, lastSeenAt: now }] })
        );
        store = new AuthStore(home, () => now);
        const colleague = generateKeyPair();
        expect(await gate().admit(colleague.publicKey, access(statementV2For(colleague.publicKey, 'colleague')))).toBe('admitted');
        const owner = generateKeyPair();
        expect(await gate().admit(owner.publicKey, access(statementV2For(owner.publicKey, 'owner')))).toBe('admitted');
        const colleagueSession = await store.sessionForPublicKey(colleague.publicKey);

        expect(await store.bindAccount('owner')).toEqual({ bound: true, revoked: [colleagueSession!] });
        expect(await store.sessionForPublicKey(colleague.publicKey)).toBeNull();
        expect(await store.sessionForPublicKey(old.publicKey)).not.toBeNull();
        expect(await store.sessionForPublicKey(owner.publicKey)).not.toBeNull();

        expect(await store.bindAccount('owner')).toEqual({ bound: true, revoked: [] });
        expect(await store.bindAccount('colleague')).toEqual({ bound: false, revoked: [] });
        expect(await store.accountBinding()).toMatchObject({ id: 'owner' });
    });

    test('the account survives a restart, and so does having left one', async () => {
        await store.bindAccount('owner');
        expect(await new AuthStore(home, () => now).accountBinding()).toMatchObject({ id: 'owner' });
        await store.leaveAccount();
        expect(await new AuthStore(home, () => now).accountBinding()).toBeNull();
    });

    const offer = (statement: PeerStatement, label = 'Studio'): SignalOfferAccess => ({ peer: statement, label });

    test('a good peer statement lets the key in as a peer of that machine, listed as a machine and as a statement', async () => {
        await store.bindAccount('owner');
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        const sessionId = (await store.sessionForPublicKey(peer.publicKey))!;
        expect(await store.peerOf(sessionId)).toEqual({ machineId: 'machine-a', machinePublicKey: peerMachine.publicKey });
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'Studio', origin: 'statement', machineId: 'machine-a' })]);
    });

    test('a peer statement is good once, and stays in the file as a peer across a restart', async () => {
        const peer = generateKeyPair();
        const statement = peerStatementFor(peer.publicKey, 'owner');
        expect(await gate().admit(peer.publicKey, offer(statement))).toBe('admitted');
        expect(await gate().admit(peer.publicKey, offer(statement))).toBe('refused');

        store = new AuthStore(home, () => now);
        const sessionId = (await store.sessionForPublicKey(peer.publicKey))!;
        expect(await store.peerOf(sessionId)).toMatchObject({ machineId: 'machine-a' });
        const onDisk = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { sessions: Array<{ origin: string }> };
        expect(onDisk.sessions.map((record) => record.origin)).toEqual(['peer']);
    });

    test('a machine on an account takes a peer statement of that account only', async () => {
        await store.bindAccount('owner');
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'colleague')))).toBe('refused');
        expect(warnings.some((line) => line.includes('wrong-account'))).toBe(true);
        expect(await store.list(null)).toEqual([]);
    });

    test('a revoked peer key is refused on a new statement for good', async () => {
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        await store.revoke((await store.list(null))[0]!.id);
        expect(await store.sessionForPublicKey(peer.publicKey)).toBeNull();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('refused');
        expect(warnings.some((line) => line.includes('revoked'))).toBe(true);
        expect(await store.sessionForPublicKey(peer.publicKey)).toBeNull();
    });

    test('a key that is a client is not turned into a peer, nor a peer key into a client', async () => {
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementV2For(client.publicKey, 'owner')))).toBe('admitted');
        expect(await gate().admit(client.publicKey, offer(peerStatementFor(client.publicKey, 'owner')))).toBe('refused');
        expect(await store.peerOf((await store.sessionForPublicKey(client.publicKey))!)).toBeNull();

        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        expect(await gate().admit(peer.publicKey, access(statementV2For(peer.publicKey, 'owner')))).toBe('refused');
        // Another machine cannot take over a peer key either.
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner', { peerMachineId: 'machine-z' })))).toBe('refused');
        expect(await store.list(null)).toHaveLength(2);
    });

    test('leaving the account takes the peers with it', async () => {
        await store.bindAccount('owner');
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        const sessionId = (await store.sessionForPublicKey(peer.publicKey))!;
        expect(await store.leaveAccount()).toEqual([sessionId]);
        expect(await store.sessionForPublicKey(peer.publicKey)).toBeNull();
    });

    test('a peer record that lost its machine is dropped as the file loads, and one that has it is read', async () => {
        const peer = generateKeyPair();
        const kept = generateKeyPair();
        await writeFile(
            join(home, 'auth.json'),
            JSON.stringify({
                sessions: [
                    {
                        id: 'a',
                        label: 'Studio',
                        publicKey: peer.publicKey,
                        origin: 'peer',
                        machineId: 'machine-a',
                        machinePublicKey: peerMachine.publicKey,
                        createdAt: 1,
                        lastSeenAt: 1
                    },
                    { id: 'b', label: 'No machine', publicKey: kept.publicKey, origin: 'peer', createdAt: 1, lastSeenAt: 1 }
                ]
            })
        );
        store = new AuthStore(home, () => now);
        expect(await store.peerOf('a')).toMatchObject({ machineId: 'machine-a' });
        expect(await store.sessionForPublicKey(kept.publicKey)).toBeNull();
    });
    test('a daemon from before peers reads the file this one writes and drops the peer, keeping the client beside it', async () => {
        // The record schema and reader of `auth-store.ts` as 0.18 shipped them, copied and frozen.
        const OldStoredRecordSchema = z.object({
            id: z.string().min(1),
            label: z.string(),
            publicKey: z.string().min(1).optional(),
            origin: z.enum(['link', 'statement']).optional().catch(undefined),
            account: z.string().min(1).optional().catch(undefined),
            createdAt: z.number(),
            lastSeenAt: z.number(),
            push: PushSubscribePayloadSchema.optional()
        });
        const OldFileSchema = z.object({ sessions: z.array(OldStoredRecordSchema) });
        const oldReader = (record: z.infer<typeof OldStoredRecordSchema>) =>
            record.origin === 'statement' && record.publicKey !== undefined ? { ...record, publicKey: record.publicKey, origin: 'statement' } : null;

        const client = generateKeyPair();
        const peer = generateKeyPair();
        expect(await gate().admit(client.publicKey, { statement: statementV2For(client.publicKey, 'owner'), label: 'Phone' })).toBe('admitted');
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');

        const written = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as unknown;
        const read = OldFileSchema.parse(written).sessions.flatMap((record) => oldReader(record) ?? []);
        expect(read.map((record) => record.publicKey)).toEqual([client.publicKey]);
    });

    test('joining another account takes the peers the first account attested, as it takes its clients', async () => {
        const peer = generateKeyPair();
        const client = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'colleague')))).toBe('admitted');
        expect(await gate().admit(client.publicKey, { statement: statementV2For(client.publicKey, 'colleague'), label: 'Phone' })).toBe('admitted');
        const owner = generateKeyPair();
        expect(await gate().admit(owner.publicKey, offer(peerStatementFor(owner.publicKey, 'owner', { peerMachineId: 'machine-o' })))).toBe('admitted');
        const sessions = await Promise.all([peer, client, owner].map((key) => store.sessionForPublicKey(key.publicKey)));

        expect(await store.bindAccount('owner')).toEqual({ bound: true, revoked: [sessions[0]!, sessions[1]!] });
        expect(await store.sessionForPublicKey(peer.publicKey)).toBeNull();
        expect(await store.sessionForPublicKey(owner.publicKey)).not.toBeNull();
    });
    test('a peer is let in for thirty days after the address book last vouched for it, and a new statement brings it back under the same session', async () => {
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        const sessionId = (await store.sessionForPublicKey(peer.publicKey))!;
        const links = new PeerLinks(home);
        await links.load();
        await links.bind('machine-a', 'Studio', 'project-1', 'auto-accept-edits');

        now += PEER_ATTESTATION_TTL_MS;
        expect(await store.sessionForPublicKey(peer.publicKey)).toBe(sessionId);
        now += 1;
        expect(await store.sessionForPublicKey(peer.publicKey)).toBeNull();
        expect(await store.hasSession(sessionId)).toBe(false);
        expect(await store.noteSeen(sessionId)).toBeNull();
        // It stays on record as the machine it was, never as a client, and a person can still see and revoke it.
        expect(await store.peerOf(sessionId)).toMatchObject({ machineId: 'machine-a' });
        expect(await store.list(null)).toEqual([expect.objectContaining({ id: sessionId, machineId: 'machine-a' })]);
        expect(await store.attestedUntil('machine-a')).toBeLessThan(now);

        // The gate sees an unknown key again and takes a fresh statement for it.
        const statement = peerStatementFor(peer.publicKey, 'owner', { issuedAt: now, expiresAt: now + 600_000 });
        expect(await gate().admit(peer.publicKey, offer(statement))).toBe('admitted');
        expect(await store.sessionForPublicKey(peer.publicKey)).toBe(sessionId);
        expect(await store.attestedUntil('machine-a')).toBe(now + PEER_ATTESTATION_TTL_MS);
        expect(await store.list(null)).toHaveLength(1);
        // The links a person made here belong to the machine, not to its attestation.
        expect(links.linkOf('machine-a', 'project-1')).toMatchObject({ ceiling: 'auto-accept-edits' });
    });

    test('a peer that is still let in renews its thirty days with the statement its next offer carries', async () => {
        const peer = generateKeyPair();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        const passed: string[] = [];
        const signals = new SignalGate({
            publicKey: machine.publicKey,
            isPaired: async (publicKey) => (await store.sessionForPublicKey(publicKey)) !== null,
            admitStatement: (publicKey, statementAccess) => gate().admit(publicKey, statementAccess),
            receive: (envelope) => passed.push(envelope.connectionId),
            now: () => now
        });
        const send = (connectionId: string, access?: SignalOfferAccess) => {
            const envelope = { connectionId, signal: { kind: 'offer' as const, sdp: 'v=0', ...(access === undefined ? {} : { access }) } };
            const signal = signedSignal(peer, machine.publicKey, envelope);
            return signals.accept(signal.from, signal.envelope, signal.signature, () => undefined);
        };

        now += PEER_ATTESTATION_TTL_MS - 5 * 24 * 60 * 60 * 1000;
        const renewed = peerStatementFor(peer.publicKey, 'owner', { issuedAt: now, expiresAt: now + 600_000 });
        expect(await send('renewal-0001', offer(renewed))).toBe('passed');
        expect(await store.attestedUntil('machine-a')).toBe(now + PEER_ATTESTATION_TTL_MS);

        // A statement that does not hold up, here one already spent, leaves a key that is let in as it was.
        now += 1_000;
        expect(await send('renewal-0002', offer(renewed))).toBe('passed');
        expect(await store.attestedUntil('machine-a')).toBe(now - 1_000 + PEER_ATTESTATION_TTL_MS);
        expect(passed).toEqual(['renewal-0001', 'renewal-0002']);
    });

    test('an expired peer cannot prove its key on a channel until it is renewed', async () => {
        const daemon = generateKeyPair();
        const handshake = new Handshake(
            store,
            { id: MACHINE_ID, publicKey: daemon.publicKey, sign: (message) => signMessage(daemon.privateKey, message) },
            () => now
        );
        const peer = generateKeyPair();
        const proof = async () => {
            const { challenge } = handshake.challenge('binding');
            return handshake.redeemChannel(
                {
                    publicKey: peer.publicKey,
                    challenge,
                    signature: signMessage(peer.privateKey, clientChannelMessage(MACHINE_ID, challenge, peer.publicKey, 'binding'))
                },
                'binding'
            );
        };
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner')))).toBe('admitted');
        expect(await proof()).toMatchObject({ peer: { machineId: 'machine-a' }, ticket: null });
        now += PEER_ATTESTATION_TTL_MS + 1;
        expect(await proof()).toBeNull();
        expect(await gate().admit(peer.publicKey, offer(peerStatementFor(peer.publicKey, 'owner', { issuedAt: now, expiresAt: now + 600_000 })))).toBe(
            'admitted'
        );
        expect(await proof()).toMatchObject({ peer: { machineId: 'machine-a' } });
    });
});
