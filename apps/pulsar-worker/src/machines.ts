import {
    MACHINE_REGISTRATION_MAX_SKEW_MS,
    MachineIdSchema,
    RegisterMachinePayloadSchema,
    machineRegistrationMessage,
    type Machine,
    type MachineIcon
} from '@ruimte/pulsar';
import { verifyEd25519 } from './crypto.ts';
import type { Env } from './env.ts';
import { clientIp, failure, json, noContent, readBody } from './http.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

interface MachineRow {
    id: string;
    name: string;
    icon: string | null;
    public_key: string;
    last_seen_at: number | null;
}

const machineOf = (row: MachineRow): Machine => ({
    id: row.id,
    name: row.name,
    icon: row.icon ? (JSON.parse(row.icon) as MachineIcon) : null,
    publicKey: row.public_key,
    lastSeenAt: row.last_seen_at
});

const signInAgain = (): Response => failure('unauthorized', 'Sign in again');

// `GET /v1/machines`
export const listMachines = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const { results } = await env.DB.prepare(
        'SELECT id, name, icon, public_key, last_seen_at FROM machine WHERE account_id = ?1 ORDER BY name COLLATE NOCASE, id'
    )
        .bind(session.account.id)
        .all<MachineRow>();
    return json({ machines: results.map(machineOf) });
};

// `POST /v1/machines`
export const registerMachine = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const limited = await overAnyLimit(env.DB, [
        [`account:${session.account.id}:register`, LIMITS.registerAccount],
        [`ip:${clientIp(request)}:register`, LIMITS.registerIp]
    ]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, RegisterMachinePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    const payload = body.value;
    const now = Date.now();
    if (Math.abs(now - payload.issuedAt) > MACHINE_REGISTRATION_MAX_SKEW_MS) {
        return failure('bad-request', 'The registration was signed too long ago, or the machine clock is off');
    }
    const message = machineRegistrationMessage(session.account.id, payload.id, payload.publicKey, payload.name, payload.issuedAt);
    if (!(await verifyEd25519(payload.publicKey, message, payload.signature))) {
        return failure('bad-signature', 'The machine did not sign this registration for this account');
    }
    const row = await env.DB.prepare(
        `INSERT INTO machine (account_id, id, name, icon, public_key, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (account_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon, public_key = excluded.public_key, last_seen_at = excluded.last_seen_at
         RETURNING id, name, icon, public_key, last_seen_at`
    )
        .bind(session.account.id, payload.id, payload.name, payload.icon ? JSON.stringify(payload.icon) : null, payload.publicKey, now)
        .first<MachineRow>();
    if (!row) {
        return failure('internal', 'The machine was not saved');
    }
    return json({ machine: machineOf(row) });
};

// `DELETE /v1/machines/<id>`: off the list only; the machine keeps every pairing it has.
export const deleteMachine = async (request: Request, env: Env, rawId: string): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    let id: string;
    try {
        id = decodeURIComponent(rawId);
    } catch {
        return failure('bad-request', 'The machine id is not valid');
    }
    if (!MachineIdSchema.safeParse(id).success) {
        return failure('bad-request', 'The machine id is not valid');
    }
    const result = await env.DB.prepare('DELETE FROM machine WHERE account_id = ?1 AND id = ?2').bind(session.account.id, id).run();
    if (result.meta.changes === 0) {
        return failure('not-found', 'No machine with that id on this account');
    }
    return noContent();
};
