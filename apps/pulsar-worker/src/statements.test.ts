import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import {
    accessRequestMessage,
    accessStatementMessage,
    accessStatementV2Message,
    machineRegistrationMessage,
    randomToken,
    type AccessStatement,
    type RegisterMachinePayload
} from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { registerMachine, storeMachine } from './machines.ts';
import { createSession } from './sessions.ts';
import { issueStatement } from './statements.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

interface Pair {
    publicKey: string;
    privateKey: KeyObject;
}

function newPair(): Pair {
    const keys = generateKeyPairSync('ed25519');
    return { publicKey: keys.publicKey.export({ format: 'jwk' }).x!, privateKey: keys.privateKey };
}

function signWith(pair: Pair, message: string): string {
    return sign(null, Buffer.from(message), pair.privateKey).toString('base64url');
}

const statementKey = generateKeyPairSync('ed25519');
const statementPublicKey = statementKey.publicKey;

let sqlite: Database;
let env: Env;

async function signIn(accountId: string): Promise<string> {
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'github', accountId, Date.now());
    const session = await createSession(env.DB, { id: accountId, provider: 'github', login: accountId, displayName: null }, 'laptop', newPair().publicKey);
    return session.accessToken;
}

function post(token: string, body: unknown): Request {
    return new Request('https://pulsar.test/v1', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '192.0.2.1' },
        body: JSON.stringify(body)
    });
}

// What a daemon signs for one account: `endpoint.signRegistration`, or any account a daemon from before this fix was asked for.
function registration(machine: Pair, machineId: string, accountId: string): RegisterMachinePayload {
    const issuedAt = Date.now();
    return {
        id: machineId,
        name: 'Studio',
        icon: null,
        brokerUrl: 'wss://broker.ruimte.test',
        publicKey: machine.publicKey,
        issuedAt,
        signature: signWith(machine, machineRegistrationMessage(accountId, machineId, machine.publicKey, 'Studio', issuedAt))
    };
}

async function askStatement(token: string, machineId: string): Promise<{ status: number; statement: AccessStatement; client: Pair }> {
    const client = newPair();
    const nonce = randomToken(18);
    const response = await issueStatement(
        post(token, {
            machineId,
            clientPublicKey: client.publicKey,
            nonce,
            signature: signWith(client, accessRequestMessage(machineId, client.publicKey, nonce))
        }),
        env
    );
    return { status: response.status, statement: (await response.json()) as AccessStatement, client };
}

async function errorCode(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
}

function signedByAddressBook(message: string, signature: string | undefined): boolean {
    return signature !== undefined && verify(null, Buffer.from(message), statementPublicKey, Buffer.from(signature, 'base64url'));
}

beforeEach(() => {
    sqlite = migratedDatabase();
    env = {
        DB: d1(sqlite),
        PUBLIC_ORIGIN: 'https://pulsar.test',
        STATEMENT_PRIVATE_KEY: statementKey.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
    };
});

describe('a machine id on two accounts', () => {
    test('an account that lists a machine id under a key of its own gets a statement naming that key, which the machine can tell from its own', async () => {
        const victim = await signIn('victim');
        const attacker = await signIn('attacker');
        const machine = newPair();
        expect((await registerMachine(post(victim, registration(machine, 'studio', 'victim')), env)).status).toBe(200);

        // The id is no secret: every paired client knows it, and so does anyone who asks the machine for a challenge.
        const squatter = newPair();
        expect((await registerMachine(post(attacker, registration(squatter, 'studio', 'attacker')), env)).status).toBe(200);

        const { status, statement, client } = await askStatement(attacker, 'studio');
        expect(status).toBe(200);
        expect(statement).toMatchObject({
            machineId: 'studio',
            clientPublicKey: client.publicKey,
            machinePublicKey: squatter.publicKey,
            accountId: 'attacker'
        });
        expect(statement.machinePublicKey).not.toBe(machine.publicKey);
        const v2 = accessStatementV2Message(
            'studio',
            squatter.publicKey,
            'attacker',
            client.publicKey,
            statement.nonce,
            statement.issuedAt,
            statement.expiresAt
        );
        expect(signedByAddressBook(v2, statement.accountSignature)).toBe(true);
    });

    test('the account a machine signed for gets both signatures, the v1 one for a daemon from before v2', async () => {
        const owner = await signIn('owner');
        const machine = newPair();
        expect((await registerMachine(post(owner, registration(machine, 'studio', 'owner')), env)).status).toBe(200);

        const { status, statement, client } = await askStatement(owner, 'studio');
        expect(status).toBe(200);
        expect(statement).toMatchObject({ machinePublicKey: machine.publicKey, accountId: 'owner' });
        const { nonce, issuedAt, expiresAt } = statement;
        expect(signedByAddressBook(accessStatementMessage('studio', client.publicKey, nonce, issuedAt, expiresAt), statement.signature)).toBe(true);
        expect(
            signedByAddressBook(
                accessStatementV2Message('studio', machine.publicKey, 'owner', client.publicKey, nonce, issuedAt, expiresAt),
                statement.accountSignature
            )
        ).toBe(true);
        // Neither signature passes for the other's bytes.
        expect(
            signedByAddressBook(
                accessStatementV2Message('studio', machine.publicKey, 'owner', client.publicKey, nonce, issuedAt, expiresAt),
                statement.signature
            )
        ).toBe(false);
    });
});

describe('a machine key on another account', () => {
    test('a registration the machine signed for a second account is refused, under its own id and under another', async () => {
        const owner = await signIn('owner');
        const colleague = await signIn('colleague');
        const machine = newPair();
        expect((await registerMachine(post(owner, registration(machine, 'studio', 'owner')), env)).status).toBe(200);

        for (const machineId of ['studio', 'studio-again']) {
            const refused = await registerMachine(post(colleague, registration(machine, machineId, 'colleague')), env);
            expect(refused.status).toBe(409);
            expect(await errorCode(refused)).toBe('machine-on-other-account');
        }
        expect(sqlite.query('SELECT account_id FROM machine').all()).toEqual([{ account_id: 'owner' }]);
        expect((await registerMachine(post(owner, registration(machine, 'studio', 'owner')), env)).status).toBe(200);
    });

    test('a machine both accounts listed before this stays on both, and either can still update its row', async () => {
        const owner = await signIn('owner');
        const colleague = await signIn('colleague');
        const machine = newPair();
        for (const accountId of ['owner', 'colleague']) {
            sqlite
                .query('INSERT INTO machine (account_id, id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(accountId, 'studio', 'Studio', machine.publicKey, Date.now());
        }
        expect((await registerMachine(post(owner, registration(machine, 'studio', 'owner')), env)).status).toBe(200);
        expect((await registerMachine(post(colleague, registration(machine, 'studio', 'colleague')), env)).status).toBe(200);
        expect(sqlite.query('SELECT account_id FROM machine ORDER BY account_id').all()).toEqual([{ account_id: 'colleague' }, { account_id: 'owner' }]);
    });

    test('a device link for a second account is refused the same way', async () => {
        await signIn('owner');
        await signIn('colleague');
        const machine = newPair();
        const signed = { id: 'studio', name: 'Studio', icon: null, brokerUrl: null, publicKey: machine.publicKey };
        expect('machine' in (await storeMachine(env.DB, 'owner', signed, true, Date.now()))).toBe(true);
        const refused = await storeMachine(env.DB, 'colleague', signed, true, Date.now());
        expect('response' in refused && (await errorCode(refused.response))).toBe('machine-on-other-account');
    });
});
