import { ACCESS_STATEMENT_LIFETIME_MS, AccessRequestPayloadSchema, accessRequestMessage, accessStatementMessage, type AccessStatement } from '@ruimte/pulsar';
import { signEd25519, statementKeyOf, verifyEd25519 } from './crypto.ts';
import { toBase64Url } from './encoding.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, readBody } from './http.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

// `POST /v1/statements`
export const issueStatement = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return failure('unauthorized', 'Sign in again');
    }
    const ip = clientIp(request);
    const limited = await overAnyLimit(env.DB, [
        [`account:${session.account.id}:statement`, LIMITS.statementAccount],
        [`ip:${ip}:statement`, LIMITS.statementIp]
    ]);
    if (limited) {
        return limited;
    }
    if (!env.STATEMENT_PRIVATE_KEY) {
        return failure('not-configured', 'The address book has no statement key');
    }
    const body = await readBody(request, AccessRequestPayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const { machineId, clientPublicKey, nonce, signature } = body.value;
    if (!(await verifyEd25519(clientPublicKey, accessRequestMessage(machineId, clientPublicKey, nonce), signature))) {
        return failure('bad-signature', 'The request is not signed by the key it names');
    }
    // A machine on another account answers the same as one that does not exist, so ids cannot be probed.
    const machine = await env.DB.prepare('SELECT id FROM machine WHERE account_id = ?1 AND id = ?2')
        .bind(session.account.id, machineId)
        .first<{ id: string }>();
    if (!machine) {
        return failure('not-found', 'No machine with that id on this account');
    }
    const key = await statementKeyOf(env.STATEMENT_PRIVATE_KEY);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ACCESS_STATEMENT_LIFETIME_MS;
    const statement: AccessStatement = {
        machineId,
        clientPublicKey,
        nonce,
        issuedAt,
        expiresAt,
        signature: toBase64Url(await signEd25519(key.privateKey, accessStatementMessage(machineId, clientPublicKey, nonce, issuedAt, expiresAt)))
    };
    await env.DB.batch([
        env.DB.prepare(
            `INSERT INTO device (account_id, public_key, label, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT (account_id, public_key) DO UPDATE SET label = COALESCE(excluded.label, device.label), last_seen_at = excluded.last_seen_at`
        ).bind(session.account.id, clientPublicKey, session.label, issuedAt),
        env.DB.prepare(
            'INSERT INTO statement_log (account_id, machine_id, device_public_key, session_id, ip, issued_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
        ).bind(session.account.id, machineId, clientPublicKey, session.id, ip, issuedAt, expiresAt)
    ]);
    return json(statement);
};
