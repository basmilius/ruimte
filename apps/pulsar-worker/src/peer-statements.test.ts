import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import {
    PEER_STATEMENT_LIFETIME_MS,
    PeerStatementSchema,
    accessStatementV2Message,
    machineRegistrationMessage,
    peerAccessRequestMessage,
    peerStatementMessage,
    randomToken,
    type PeerAccessRequestPayload,
    type RegisterMachinePayload
} from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { registerMachine } from './machines.ts';
import { issuePeerStatement } from './peer-statements.ts';
import { LIMITS } from './rate-limit.ts';
import { createSession } from './sessions.ts';
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
const NOW = Date.UTC(2026, 9, 1);

let sqlite: Database;
let env: Env;

async function signIn(accountId: string): Promise<string> {
    sqlite.query('INSERT INTO account (id, provider, subject, created_at) VALUES (?, ?, ?, ?)').run(accountId, 'github', accountId, NOW);
    const session = await createSession(env.DB, { id: accountId, provider: 'github', login: accountId, displayName: null }, 'laptop', newPair().publicKey);
    return session.accessToken;
}

function post(token: string, body: unknown, ip = '192.0.2.1'): Request {
    return new Request('https://pulsar.test/v1', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': ip },
        body: JSON.stringify(body)
    });
}

async function addMachine(token: string, accountId: string, machineId: string): Promise<Pair> {
    const machine = newPair();
    const issuedAt = NOW;
    const payload: RegisterMachinePayload = {
        id: machineId,
        name: machineId,
        icon: null,
        brokerUrl: 'wss://broker.ruimte.test',
        publicKey: machine.publicKey,
        issuedAt,
        signature: signWith(machine, machineRegistrationMessage(accountId, machineId, machine.publicKey, machineId, issuedAt))
    };
    expect((await registerMachine(post(token, payload), env)).status).toBe(200);
    return machine;
}

// What `endpoint.signPeerAccess` on machine A hands the page, with the machine ids around it.
function request(
    peer: Pair,
    peerMachine: Pair,
    machineId: string,
    peerMachineId: string,
    patch: Partial<PeerAccessRequestPayload> = {}
): PeerAccessRequestPayload {
    const nonce = randomToken(18);
    const message = peerAccessRequestMessage(machineId, peer.publicKey, peerMachineId, nonce);
    return {
        machineId,
        peerMachineId,
        peerPublicKey: peer.publicKey,
        nonce,
        peerSignature: signWith(peer, message),
        machineSignature: signWith(peerMachine, message),
        ...patch
    };
}

async function errorCode(response: Response): Promise<string> {
    return ((await response.json()) as { error: { code: string } }).error.code;
}

function logged(): unknown[] {
    return sqlite.query("SELECT machine_id, device_public_key, kind, peer_machine_id FROM statement_log WHERE kind = 'peer'").all();
}

beforeEach(() => {
    setSystemTime(NOW);
    sqlite = migratedDatabase();
    env = {
        DB: d1(sqlite),
        PUBLIC_ORIGIN: 'https://pulsar.test',
        STATEMENT_PRIVATE_KEY: statementKey.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
    };
});

afterEach(() => {
    setSystemTime();
});

describe('a peer statement', () => {
    test('is signed for two machines of the account, valid for ten minutes, and logged as a peer statement', async () => {
        const token = await signIn('owner');
        const studio = await addMachine(token, 'owner', 'studio');
        const laptop = await addMachine(token, 'owner', 'laptop');
        const peer = newPair();
        const body = request(peer, laptop, 'studio', 'laptop');

        const response = await issuePeerStatement(post(token, body), env);
        expect(response.status).toBe(200);
        const statement = PeerStatementSchema.parse(await response.json());
        expect(statement).toMatchObject({
            machineId: 'studio',
            machinePublicKey: studio.publicKey,
            accountId: 'owner',
            peerPublicKey: peer.publicKey,
            peerMachineId: 'laptop',
            peerMachinePublicKey: laptop.publicKey,
            nonce: body.nonce
        });
        expect(statement.expiresAt - statement.issuedAt).toBe(PEER_STATEMENT_LIFETIME_MS);
        const message = peerStatementMessage(
            'studio',
            studio.publicKey,
            'owner',
            peer.publicKey,
            'laptop',
            laptop.publicKey,
            body.nonce,
            statement.issuedAt,
            statement.expiresAt
        );
        expect(verify(null, Buffer.from(message), statementKey.publicKey, Buffer.from(statement.signature, 'base64url'))).toBe(true);
        // The statement is no client statement: the same fields under the other purpose do not verify.
        const asClient = accessStatementV2Message('studio', studio.publicKey, 'owner', peer.publicKey, body.nonce, statement.issuedAt, statement.expiresAt);
        expect(verify(null, Buffer.from(asClient), statementKey.publicKey, Buffer.from(statement.signature, 'base64url'))).toBe(false);
        expect(logged()).toEqual([{ machine_id: 'studio', device_public_key: peer.publicKey, kind: 'peer', peer_machine_id: 'laptop' }]);
    });

    test('is refused when the machine worked in belongs to another account, as for a machine that does not exist', async () => {
        const owner = await signIn('owner');
        const stranger = await signIn('stranger');
        await addMachine(owner, 'owner', 'studio');
        const laptop = await addMachine(stranger, 'stranger', 'laptop');

        const response = await issuePeerStatement(post(stranger, request(newPair(), laptop, 'studio', 'laptop')), env);
        expect(response.status).toBe(404);
        expect(await errorCode(response)).toBe('not-found');
        const missing = await issuePeerStatement(post(stranger, request(newPair(), laptop, 'nowhere', 'laptop')), env);
        expect(missing.status).toBe(404);
        expect(logged()).toEqual([]);
    });

    test('is refused when the machine that works belongs to another account', async () => {
        const owner = await signIn('owner');
        const stranger = await signIn('stranger');
        await addMachine(owner, 'owner', 'studio');
        const laptop = await addMachine(stranger, 'stranger', 'laptop');

        const response = await issuePeerStatement(post(owner, request(newPair(), laptop, 'studio', 'laptop')), env);
        expect(response.status).toBe(404);
        expect(await errorCode(response)).toBe('not-found');
        expect(logged()).toEqual([]);
    });

    test('is refused for a machine working in itself', async () => {
        const token = await signIn('owner');
        const studio = await addMachine(token, 'owner', 'studio');

        const response = await issuePeerStatement(post(token, request(newPair(), studio, 'studio', 'studio')), env);
        expect(response.status).toBe(400);
        expect(await errorCode(response)).toBe('bad-request');
        expect(logged()).toEqual([]);
    });

    test('is refused when only one of the two signatures covers the request', async () => {
        const token = await signIn('owner');
        await addMachine(token, 'owner', 'studio');
        const laptop = await addMachine(token, 'owner', 'laptop');
        const peer = newPair();
        const other = newPair();

        const valid = request(peer, laptop, 'studio', 'laptop');
        const message = peerAccessRequestMessage('studio', peer.publicKey, 'laptop', valid.nonce);
        const unsigned: Partial<PeerAccessRequestPayload>[] = [
            // A key nobody holds a signature of: the machine alone vouches for it.
            { peerSignature: signWith(other, message) },
            // The peer key alone, without the machine behind it.
            { machineSignature: signWith(peer, message) },
            // The machine signed some other request.
            { machineSignature: signWith(laptop, peerAccessRequestMessage('studio', other.publicKey, 'laptop', valid.nonce)) },
            { peerSignature: signWith(peer, peerAccessRequestMessage('studio', peer.publicKey, 'laptop', randomToken(18))) }
        ];
        for (const patch of unsigned) {
            const response = await issuePeerStatement(post(token, { ...valid, ...patch }), env);
            expect(response.status).toBe(403);
            expect(await errorCode(response)).toBe('bad-signature');
        }
        expect(logged()).toEqual([]);
    });

    test('is refused when the machine signature is by a key the account does not list for that machine', async () => {
        const token = await signIn('owner');
        await addMachine(token, 'owner', 'studio');
        await addMachine(token, 'owner', 'laptop');
        const namesake = newPair();

        const response = await issuePeerStatement(post(token, request(newPair(), namesake, 'studio', 'laptop')), env);
        expect(response.status).toBe(403);
        expect(await errorCode(response)).toBe('bad-signature');
    });

    test('is refused without a session, and rate limited per account', async () => {
        const token = await signIn('owner');
        const laptop = await addMachine(token, 'owner', 'laptop');
        await addMachine(token, 'owner', 'studio');

        expect((await issuePeerStatement(post('x'.repeat(43), request(newPair(), laptop, 'studio', 'laptop')), env)).status).toBe(401);
        for (let attempt = 0; attempt < LIMITS.peerStatementAccount; attempt += 1) {
            expect((await issuePeerStatement(post(token, request(newPair(), laptop, 'studio', 'laptop'), `192.0.2.${attempt + 10}`), env)).status).toBe(200);
        }
        const limited = await issuePeerStatement(post(token, request(newPair(), laptop, 'studio', 'laptop'), '192.0.2.99'), env);
        expect(limited.status).toBe(429);
        expect(await errorCode(limited)).toBe('rate-limited');
    });
});
