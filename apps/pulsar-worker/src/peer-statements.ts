import {
    PEER_STATEMENT_LIFETIME_MS,
    PeerAccessRequestPayloadSchema,
    peerAccessRequestMessage,
    peerStatementMessage,
    toBase64Url,
    type PeerStatement
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import { signEd25519, statementKeyOf } from './crypto.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, readBody } from './http.ts';
import { LIMITS, sessionWithinLimits } from './rate-limit.ts';

// `POST /v1/peer-statements`
export async function issuePeerStatement(request: Request, env: Env): Promise<Response> {
    const session = await sessionWithinLimits(request, env, ['peer-statement', LIMITS.peerStatementAccount], ['peer-statement', LIMITS.peerStatementIp]);
    if (session instanceof Response) {
        return session;
    }
    if (!env.STATEMENT_PRIVATE_KEY) {
        return failure('not-configured', 'The address book has no statement key');
    }
    const body = await readBody(request, PeerAccessRequestPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const { machineId, peerMachineId, peerPublicKey, nonce, peerSignature, machineSignature } = body.value;
    // A machine on another account answers the same as one that does not exist, so ids cannot be probed.
    const rows = await env.DB.prepare('SELECT id, public_key FROM machine WHERE account_id = ?1 AND id IN (?2, ?3)')
        .bind(session.account.id, machineId, peerMachineId)
        .all<{ id: string; public_key: string }>();
    const machine = rows.results.find((row) => row.id === machineId);
    const peerMachine = rows.results.find((row) => row.id === peerMachineId);
    if (!machine || !peerMachine) {
        return failure('not-found', 'No machine with that id on this account');
    }
    const message = peerAccessRequestMessage(machineId, peerPublicKey, peerMachineId, nonce);
    // The key from the account's own row for the machine, so a namesake's key proves nothing here.
    const [peerSigned, machineSigned] = await Promise.all([
        verifySignature(peerPublicKey, message, peerSignature),
        verifySignature(peerMachine.public_key, message, machineSignature)
    ]);
    if (!peerSigned || !machineSigned) {
        return failure('bad-signature', 'The request is signed by neither the peer key nor the machine key it names');
    }
    if (peerMachineId === machineId) {
        return failure('bad-request', 'A machine cannot work in itself');
    }
    const key = await statementKeyOf(env.STATEMENT_PRIVATE_KEY);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + PEER_STATEMENT_LIFETIME_MS;
    const accountId = session.account.id;
    const statement: PeerStatement = {
        machineId,
        machinePublicKey: machine.public_key,
        accountId,
        peerPublicKey,
        peerMachineId,
        peerMachinePublicKey: peerMachine.public_key,
        nonce,
        issuedAt,
        expiresAt,
        signature: toBase64Url(
            await signEd25519(
                key.privateKey,
                peerStatementMessage(machineId, machine.public_key, accountId, peerPublicKey, peerMachineId, peerMachine.public_key, nonce, issuedAt, expiresAt)
            )
        )
    };
    await env.DB.prepare(
        `INSERT INTO statement_log (account_id, machine_id, device_public_key, session_id, ip, issued_at, expires_at, kind, peer_machine_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'peer', ?8)`
    )
        .bind(accountId, machineId, peerPublicKey, session.id, clientIp(request), issuedAt, expiresAt, peerMachineId)
        .run();
    return json(statement);
}
