import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ACCESS_STATEMENT_LIFETIME_MS,
    PULSAR_STATEMENT_PUBLIC_KEYS,
    accessStatementMessage,
    accessStatementV2Message,
    type AccessStatement,
    type SignalAccess
} from '@ruimte/pulsar';
import { AuthStore } from '../auth/auth-store.ts';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { STATEMENT_CLOCK_SKEW_MS, StatementGate, TEST_STATEMENT_KEY_VARIABLE, checkStatement, trustedStatementKeys } from './statement.ts';

const MACHINE_ID = 'machine-under-test';
const NOW = 1_800_000_000_000;

// A stand-in for the address book, with a key of its own and nothing to do with the pinned one.
const addressBook = generateKeyPair();

const statementFor = (clientPublicKey: string, overrides: Partial<AccessStatement> = {}, signer = addressBook): AccessStatement => {
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
};

// This machine's own key, which a statement v2 has to name.
const machine = generateKeyPair();

/* A statement as the address book signs it now: the v1 signature, and the v2 one over the key its row lists and the account. */
const statementV2For = (
    clientPublicKey: string,
    accountId: string,
    machinePublicKey = machine.publicKey,
    overrides: Partial<AccessStatement> = {},
    signer = addressBook
): AccessStatement => {
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
};

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

describe('StatementGate', () => {
    let home: string;
    let store: AuthStore;
    let refuses: boolean;
    let now: number;

    let warnings: string[];

    const gate = (): StatementGate =>
        new StatementGate({
            machineId: MACHINE_ID,
            machinePublicKey: machine.publicKey,
            trustedKeys: [addressBook.publicKey],
            refusesStatements: () => refuses,
            store,
            now: () => now,
            log: { log: () => undefined, warn: (line: string) => warnings.push(line) }
        });

    const access = (statement: AccessStatement, label = 'Laptop'): SignalAccess => ({ statement, label });

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-statement-'));
        store = new AuthStore(home, () => now);
        refuses = false;
        now = NOW + 1_000;
        warnings = [];
    });

    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });

    test('a good statement pairs the key with the origin statement, under the label the offer gave', async () => {
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey), 'Work laptop'))).toBe('admitted');
        expect(await store.sessionForPublicKey(client.publicKey)).not.toBeNull();
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'Work laptop', origin: 'statement' })]);
    });

    test('a spent nonce stays spent across a restart', async () => {
        const client = generateKeyPair();
        const statement = statementFor(client.publicKey);
        expect(await gate().admit(client.publicKey, access(statement))).toBe('admitted');

        store = new AuthStore(home, () => now);
        expect(
            await store.admitStatement({ publicKey: client.publicKey, label: 'Laptop', nonce: statement.nonce, keepNonceUntil: now + 1, accountId: null })
        ).toEqual({
            refused: 'replayed'
        });
        expect(await gate().admit(client.publicKey, access(statement))).toBe('refused');
    });

    test('a replayed nonce gets nothing even for a key that is still paired, and an expired statement pairs nobody', async () => {
        const client = generateKeyPair();
        const statement = statementFor(client.publicKey);
        expect(await gate().admit(client.publicKey, access(statement))).toBe('admitted');
        expect(await gate().admit(client.publicKey, access(statement))).toBe('refused');

        const late = generateKeyPair();
        now = NOW + ACCESS_STATEMENT_LIFETIME_MS + STATEMENT_CLOCK_SKEW_MS + 1;
        expect(await gate().admit(late.publicKey, access(statementFor(late.publicKey)))).toBe('refused');
        expect(await store.sessionForPublicKey(late.publicKey)).toBeNull();
    });

    test('a statement for another machine, or offered by another key than the one it names, pairs nobody', async () => {
        const client = generateKeyPair();
        const thief = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey, { machineId: 'the-machine-next-door' })))).toBe('refused');
        expect(await gate().admit(thief.publicKey, access(statementFor(client.publicKey)))).toBe('refused');
        expect(await store.list(null)).toEqual([]);
    });

    test('with the refusal switch on a good statement gets statements-refused and nothing else, and its nonce is left unspent', async () => {
        const client = generateKeyPair();
        const statement = statementFor(client.publicKey);
        refuses = true;
        expect(await gate().admit(client.publicKey, access(statement))).toBe('statements-refused');
        expect(await store.list(null)).toEqual([]);
        // A bad statement never learns about the switch.
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey, {}, generateKeyPair())))).toBe('refused');

        refuses = false;
        expect(await gate().admit(client.publicKey, access(statement))).toBe('admitted');
    });

    test('a device a person revoked does not walk back in on a statement, until it is paired with a link again', async () => {
        const client = generateKeyPair();
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey)))).toBe('admitted');
        await store.revoke((await store.list(null))[0]!.id);
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey)))).toBe('refused');
        expect(await store.sessionForPublicKey(client.publicKey)).toBeNull();

        await store.pair(store.issuePairingToken(), { label: 'By hand', publicKey: client.publicKey });
        await store.revoke((await store.list(null))[0]!.id);
        await store.pair(store.issuePairingToken(), { label: 'By hand again', publicKey: client.publicKey });
        expect(await gate().admit(client.publicKey, access(statementFor(client.publicKey)))).toBe('admitted');
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'By hand again', origin: 'link' })]);
    });

    test('the auth file keeps the spent nonces and forgets them once the statement could not be believed anyway', async () => {
        const client = generateKeyPair();
        const statement = statementFor(client.publicKey);
        await gate().admit(client.publicKey, access(statement));
        const onDisk = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { spentNonces: { nonce: string }[] };
        expect(onDisk.spentNonces.map((spent) => spent.nonce)).toEqual([statement.nonce]);

        now = statement.expiresAt + STATEMENT_CLOCK_SKEW_MS + 1;
        const other = generateKeyPair();
        await store.admitStatement({ publicKey: other.publicKey, label: 'Later', nonce: 'a-later-nonce', keepNonceUntil: now + 1, accountId: null });
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

    test('a machine on no account still takes a v1 statement, with a warning, and learns no account from any statement', async () => {
        const old = generateKeyPair();
        expect(await gate().admit(old.publicKey, access(statementFor(old.publicKey)))).toBe('admitted');
        expect(warnings.some((line) => line.includes('names no account'))).toBe(true);
        const current = generateKeyPair();
        expect(await gate().admit(current.publicKey, access(statementV2For(current.publicKey, 'someone')))).toBe('admitted');
        expect(await store.accountBinding()).toBeUndefined();
    });

    test('leaving the account takes the clients a statement let in and lets no statement in until the machine signs again', async () => {
        await store.bindAccount('owner');
        const phone = generateKeyPair();
        expect(await gate().admit(phone.publicKey, access(statementV2For(phone.publicKey, 'owner')))).toBe('admitted');
        const laptop = generateKeyPair();
        await store.pair(store.issuePairingToken(), { label: 'By link', publicKey: laptop.publicKey });
        const phoneSession = await store.sessionForPublicKey(phone.publicKey);

        expect(await store.leaveAccount()).toEqual([phoneSession!]);
        expect(await store.sessionForPublicKey(phone.publicKey)).toBeNull();
        expect(await store.list(null)).toEqual([expect.objectContaining({ label: 'By link', origin: 'link' })]);
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
        expect(await gate().admit(old.publicKey, access(statementFor(old.publicKey)))).toBe('admitted');
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
});
