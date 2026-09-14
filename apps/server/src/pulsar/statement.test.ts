import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_STATEMENT_LIFETIME_MS, PULSAR_STATEMENT_PUBLIC_KEYS, accessStatementMessage, type AccessStatement, type SignalAccess } from '@ruimte/pulsar';
import { AuthStore } from '../auth/auth-store.ts';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { STATEMENT_CLOCK_SKEW_MS, StatementGate, TEST_STATEMENT_KEY_VARIABLE, checkStatement, trustedStatementKeys } from './statement.ts';

const MACHINE_ID = 'machine-under-test';
const NOW = 1_800_000_000_000;
const quiet = { log: () => undefined, warn: () => undefined };

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

describe('checkStatement', () => {
    const client = generateKeyPair();
    const expected = { machineId: MACHINE_ID, clientPublicKey: client.publicKey, trustedKeys: [addressBook.publicKey], now: NOW + 1_000 };

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

    const gate = (): StatementGate =>
        new StatementGate({
            machineId: MACHINE_ID,
            trustedKeys: [addressBook.publicKey],
            refusesStatements: () => refuses,
            store,
            now: () => now,
            log: quiet
        });

    const access = (statement: AccessStatement, label = 'Laptop'): SignalAccess => ({ statement, label });

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-statement-'));
        store = new AuthStore(home, () => now);
        refuses = false;
        now = NOW + 1_000;
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
        expect(await store.admitStatement({ publicKey: client.publicKey, label: 'Laptop', nonce: statement.nonce, keepNonceUntil: now + 1 })).toEqual({
            refused: 'replayed'
        });
        expect(await gate().admit(client.publicKey, access(statement))).toBe('refused');
    });

    test('a record from before statements lists as a link, and a pairing link records its origin', async () => {
        await Bun.write(
            join(home, 'auth.json'),
            JSON.stringify({ sessions: [{ id: 'old', label: 'Old browser', publicKey: generateKeyPair().publicKey, createdAt: 1, lastSeenAt: 1 }] })
        );
        store = new AuthStore(home, () => now);
        await store.pair(store.issuePairingToken(), { label: 'New browser', publicKey: generateKeyPair().publicKey });
        expect((await store.list(null)).map((session) => [session.label, session.origin])).toEqual([
            ['Old browser', 'link'],
            ['New browser', 'link']
        ]);
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
        await store.admitStatement({ publicKey: other.publicKey, label: 'Later', nonce: 'a-later-nonce', keepNonceUntil: now + 1 });
        const later = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { spentNonces: { nonce: string }[] };
        expect(later.spentNonces.map((spent) => spent.nonce)).toEqual(['a-later-nonce']);
    });
});
