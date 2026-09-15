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
    broker_url: string | null;
    public_key: string;
    last_seen_at: number | null;
}

const machineOf = (row: MachineRow): Machine => ({
    id: row.id,
    name: row.name,
    icon: row.icon ? (JSON.parse(row.icon) as MachineIcon) : null,
    publicKey: row.public_key,
    brokerUrl: row.broker_url,
    lastSeenAt: row.last_seen_at
});

const signInAgain = (): Response => failure('unauthorized', 'Sign in again');

// `GET /v1/machines`
export const listMachines = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const [machines, removed] = await env.DB.batch([
        env.DB.prepare('SELECT id, name, icon, broker_url, public_key, last_seen_at FROM machine WHERE account_id = ?1 ORDER BY name COLLATE NOCASE, id').bind(
            session.account.id
        ),
        env.DB.prepare('SELECT machine_id FROM removed_machine WHERE account_id = ?1 ORDER BY machine_id').bind(session.account.id)
    ]);
    return json({
        machines: ((machines?.results ?? []) as MachineRow[]).map(machineOf),
        removedMachineIds: ((removed?.results ?? []) as { machine_id: string }[]).map((row) => row.machine_id)
    });
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
    if (payload.automatic === true) {
        const removed = await env.DB.prepare('SELECT 1 AS removed FROM removed_machine WHERE account_id = ?1 AND machine_id = ?2')
            .bind(session.account.id, payload.id)
            .first<{ removed: number }>();
        if (removed) {
            return failure('removed', 'This machine was taken off the account; add it again from its row');
        }
    }
    const stored = await storeMachine(env.DB, session.account.id, { ...payload, brokerUrl: payload.brokerUrl ?? null }, payload.automatic !== true, now);
    return 'response' in stored ? stored.response : json({ machine: stored.machine });
};

export interface SignedMachine {
    id: string;
    name: string;
    icon: MachineIcon | null;
    brokerUrl: string | null;
    publicKey: string;
}

/*
 * Puts a machine whose signature already held on an account. A registration a person asked for clears
 * a removal; the caller refuses an automatic one for a removed machine before it gets here.
 */
export const storeMachine = async (
    db: D1Database,
    accountId: string,
    machine: SignedMachine,
    clearsRemoval: boolean,
    now: number
): Promise<{ machine: Machine } | { response: Response }> => {
    if (clearsRemoval) {
        await db.prepare('DELETE FROM removed_machine WHERE account_id = ?1 AND machine_id = ?2').bind(accountId, machine.id).run();
    }
    /*
     * An upsert only by the key the machine is listed with: anyone who can sign a registration for another
     * key could otherwise take over the row, and every client that opens the machine pins the listed key.
     * A machine with a new key comes back after a person removes it from the account.
     */
    const row = await db
        .prepare(
            `INSERT INTO machine (account_id, id, name, icon, broker_url, public_key, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT (account_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon, broker_url = excluded.broker_url, last_seen_at = excluded.last_seen_at
         WHERE machine.public_key = excluded.public_key
         RETURNING id, name, icon, broker_url, public_key, last_seen_at`
        )
        .bind(accountId, machine.id, machine.name, machine.icon ? JSON.stringify(machine.icon) : null, machine.brokerUrl, machine.publicKey, now)
        .first<MachineRow>();
    if (!row) {
        return { response: failure('bad-signature', 'This machine is on the account with another key; remove it from the account and add it again') };
    }
    return { machine: machineOf(row) };
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
    const [result] = await env.DB.batch([
        env.DB.prepare('DELETE FROM machine WHERE account_id = ?1 AND id = ?2').bind(session.account.id, id),
        // Remembered whether or not the machine was listed, so a client that registers it a moment later does not undo the removal.
        env.DB.prepare(
            'INSERT INTO removed_machine (account_id, machine_id, removed_at) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, machine_id) DO UPDATE SET removed_at = excluded.removed_at'
        ).bind(session.account.id, id, Date.now())
    ]);
    if (!result || result.meta.changes === 0) {
        return failure('not-found', 'No machine with that id on this account');
    }
    return noContent();
};
