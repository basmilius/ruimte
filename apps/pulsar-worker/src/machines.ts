import {
    MACHINE_REGISTRATION_MAX_SKEW_MS,
    MachineIconSchema,
    MachineIdSchema,
    RegisterMachinePayloadSchema,
    machineRegistrationMessage,
    type Machine,
    type MachineIcon
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-web';
import type { Env } from './env.ts';
import { failure, json, noContent, readBody, signInAgain } from './http.ts';
import { LIMITS, sessionWithinLimits } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

interface MachineRow {
    id: string;
    name: string;
    icon: string | null;
    broker_url: string | null;
    public_key: string;
    last_seen_at: number | null;
}

/* A mark stored by a build that wrote other kinds of mark is decoration nobody can draw any more.
   It comes back as no mark, because a row nobody can validate is still a machine to connect to. */
function iconOf(stored: string): MachineIcon | null {
    const parsed = MachineIconSchema.safeParse(JSON.parse(stored) as unknown);
    return parsed.success ? parsed.data : null;
}

function machineOf(row: MachineRow): Machine {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon ? iconOf(row.icon) : null,
        publicKey: row.public_key,
        brokerUrl: row.broker_url,
        lastSeenAt: row.last_seen_at
    };
}

// `GET /v1/machines`
export async function listMachines(request: Request, env: Env): Promise<Response> {
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
}

// `POST /v1/machines`
export async function registerMachine(request: Request, env: Env): Promise<Response> {
    const session = await sessionWithinLimits(request, env, ['register', LIMITS.registerAccount], ['register', LIMITS.registerIp]);
    if (session instanceof Response) {
        return session;
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
    if (!(await verifySignature(payload.publicKey, message, payload.signature))) {
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
}

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
export async function storeMachine(
    db: D1Database,
    accountId: string,
    machine: SignedMachine,
    clearsRemoval: boolean,
    now: number
): Promise<{ machine: Machine } | { response: Response }> {
    /*
     * A machine is on one account at a time and only the machine moves itself, so its key on a second
     * account is refused, in the insert itself so two accounts registering one key at once cannot both
     * pass a check read before either wrote. A row this account already holds for the key keeps
     * updating: two accounts that listed one machine before this rule keep it, which is why the key is
     * not unique.
     *
     * The upsert goes only by the key the machine is listed with: anyone who can sign a registration for
     * another key could otherwise take over the row, and every client that opens the machine pins the
     * listed key. A machine with a new key comes back after a person removes it from the account.
     */
    const upsert = db
        .prepare(
            `INSERT INTO machine (account_id, id, name, icon, broker_url, public_key, last_seen_at, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7
             WHERE NOT EXISTS (
                 SELECT 1 FROM machine AS other WHERE other.public_key = ?6 AND other.account_id != ?1
                 AND NOT EXISTS (SELECT 1 FROM machine AS own WHERE own.account_id = ?1 AND own.id = ?2 AND own.public_key = ?6)
             )
         ON CONFLICT (account_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon, broker_url = excluded.broker_url, last_seen_at = excluded.last_seen_at
         WHERE machine.public_key = excluded.public_key
         RETURNING id, name, icon, broker_url, public_key, last_seen_at`
        )
        .bind(accountId, machine.id, machine.name, machine.icon ? JSON.stringify(machine.icon) : null, machine.brokerUrl, machine.publicKey, now);
    // Cleared only once the machine is on the account with this key, in the same batch.
    const clearRemoval = db
        .prepare(
            `DELETE FROM removed_machine WHERE account_id = ?1 AND machine_id = ?2
             AND EXISTS (SELECT 1 FROM machine WHERE account_id = ?1 AND id = ?2 AND public_key = ?3)`
        )
        .bind(accountId, machine.id, machine.publicKey);
    const [upserted] = await db.batch(clearsRemoval ? [upsert, clearRemoval] : [upsert]);
    const row = (upserted?.results ?? [])[0] as MachineRow | undefined;
    if (!row) {
        // Only which refusal to name; the insert above already decided.
        const elsewhere = await db
            .prepare('SELECT 1 AS taken FROM machine WHERE public_key = ?1 AND account_id != ?2')
            .bind(machine.publicKey, accountId)
            .first<{ taken: number }>();
        return elsewhere
            ? { response: failure('machine-on-other-account', 'This machine is on another account. Disconnect it on the machine itself first.') }
            : { response: failure('bad-signature', 'This machine is on the account with another key; remove it from the account and add it again') };
    }
    return { machine: machineOf(row) };
}

// `DELETE /v1/machines/<id>`: off the list only; the machine keeps every pairing it has.
export async function deleteMachine(request: Request, env: Env, rawId: string): Promise<Response> {
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
}
