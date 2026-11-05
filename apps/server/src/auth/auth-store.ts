import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { PushSubscribePayloadSchema, type AuthSession, type PushSubscribePayload } from '@ruimte/contracts';
import { isPublicKey } from '@ruimte/pulsar/verify-node';
import { z } from 'zod';
import { errorText } from '../error-text.ts';

/*
 * A client a statement let in, by the key it proves per connection. A record of a pairing link from
 * before links went (`origin` absent or `link`, or a session token without a key) still reads, and
 * is dropped as the file loads, so that client has to come back through the account.
 *
 * A peer (another machine of the account) has `origin: 'peer'`, never `statement`: a daemon from before
 * peers drops an origin it does not know, where it would have kept a peer as a full client.
 */
const StoredRecordSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    publicKey: z.string().min(1).optional(),
    origin: z.enum(['link', 'statement', 'peer']).optional().catch(undefined),
    // The machine a peer is, as the account lists it; a peer record without both is dropped as the file loads.
    machineId: z.string().min(1).optional().catch(undefined),
    machinePublicKey: z.string().min(1).optional().catch(undefined),
    // When the address book last vouched for a peer; a peer is let in only for `PEER_ATTESTATION_TTL_MS` after that.
    attestedAt: z.number().optional().catch(undefined),
    // The account whose statement let this client in; absent for a statement that named none.
    account: z.string().min(1).optional().catch(undefined),
    createdAt: z.number(),
    lastSeenAt: z.number(),
    push: PushSubscribePayloadSchema.optional()
});

interface SessionRecord {
    id: string;
    label: string;
    publicKey: string;
    origin: 'statement' | 'peer';
    // Set on a peer only.
    machineId?: string;
    machinePublicKey?: string;
    attestedAt?: number;
    account?: string;
    createdAt: number;
    lastSeenAt: number;
    push?: PushSubscribePayload;
}

/*
 * How long a peer stays let in after the last statement the address book signed for it. A machine that
 * left the account, or was taken off it, stops being vouched for, and nothing here would otherwise
 * notice; the machine that works here renews the statement silently while a person uses the link.
 */
export const PEER_ATTESTATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function emptyState(account: Binding): State {
    return { sessions: [], spentNonces: [], revokedKeys: [], account };
}

function statementRecord(record: z.infer<typeof StoredRecordSchema>): SessionRecord | null {
    if (record.publicKey === undefined) {
        return null;
    }
    if (record.origin === 'statement') {
        return { ...record, publicKey: record.publicKey, origin: 'statement' };
    }
    if (record.origin === 'peer' && record.machineId !== undefined && record.machinePublicKey !== undefined) {
        return { ...record, publicKey: record.publicKey, origin: 'peer', machineId: record.machineId, machinePublicKey: record.machinePublicKey };
    }
    return null;
}

// What a session that still has its access is: a client (`peer` null) or the machine a peer is.
export interface SessionStanding {
    peer: { machineId: string; machinePublicKey: string } | null;
}

function standingOf(record: SessionRecord): SessionStanding {
    return {
        peer:
            record.origin === 'peer' && record.machineId !== undefined && record.machinePublicKey !== undefined
                ? { machineId: record.machineId, machinePublicKey: record.machinePublicKey }
                : null
    };
}

const AccountBindingSchema = z.object({ id: z.string().min(1), since: z.number() });
export type AccountBinding = z.infer<typeof AccountBindingSchema>;

const FileSchema = z.object({
    sessions: z.array(StoredRecordSchema),
    /*
     * Nonces are kept until their statement could no longer be believed anyway, and revoked keys for good,
     * both on disk: a restart must not make a nonce new again, and a revoked device must not walk back in
     * on the next statement. Dropped rather than refused when they will not read, like the sessions.
     */
    spentNonces: z
        .array(z.object({ nonce: z.string().min(1), until: z.number() }))
        .optional()
        .catch(undefined),
    revokedKeys: z.array(z.string().min(1)).optional().catch(undefined),
    // A binding that will not read takes no statement, as one a person took off, until the machine signs again.
    account: AccountBindingSchema.nullable().optional().catch(null)
});

/*
 * The one address book account this machine is on. It is set when the machine signs a registration,
 * only a person on the machine takes it off, and a statement never sets it. Absent on a machine that
 * signed none since this was kept; null once a person took it off.
 */
type Binding = AccountBinding | null | undefined;

interface State {
    sessions: SessionRecord[];
    spentNonces: { nonce: string; until: number }[];
    revokedKeys: string[];
    account: Binding;
}

export interface StatementEntry {
    publicKey: string;
    label: string;
    nonce: string;
    // When the nonce may be forgotten: past the statement's expiry and the clock skew allowed on it.
    keepNonceUntil: number;
    // The account a statement v2 named and the address book signed; null for a statement that names none.
    accountId: string | null;
    // Set for a peer statement: the machine that works here and the key the account lists it with.
    peer?: { machineId: string; machinePublicKey: string };
}

type StatementAccountRefusal = 'wrong-account' | 'account-required' | 'no-account';

export type StatementAdmission =
    | { sessionId: string; created: boolean }
    // `key-in-use`: the key is a client here and a peer is asked, or the other way round, or it is another machine's peer key.
    | { refused: 'replayed' | 'revoked' | 'bad-key' | 'key-in-use' | StatementAccountRefusal };

/* Whether a statement of `accountId` may let a client in on this binding; null when it may. */
export function statementAccountRefusal(binding: Binding, accountId: string | null): StatementAccountRefusal | null {
    if (binding === null) {
        return 'no-account';
    }
    if (binding !== undefined) {
        if (accountId === null) {
            return 'account-required';
        }
        return accountId === binding.id ? null : 'wrong-account';
    }
    // Its key in a statement v2 says an account lists this machine, which only a registration the machine signed puts there.
    return accountId === null ? 'account-required' : null;
}

export interface AccountChange {
    // False when the machine is on another account, which a person on the machine has to take it off first.
    bound: boolean;
    // The clients another account let in on a statement, which lose their access now.
    revoked: string[];
}

/*
 * Who may talk to this daemon from another machine: a client a statement from the address book let
 * in, by the public key it proves per connection, kept in `$RUIMTE_HOME/auth.json`. A process on the
 * daemon's own machine presents the local secret instead.
 */
export class AuthStore {
    readonly path: string;
    private state: Promise<State> | null = null;
    // Every change reads, decides and writes inside one turn here, so two changes at once never undo each other.
    private readonly transitions = new Serializer();
    private readonly now: () => number;
    private readonly leftListeners: Array<() => Promise<void> | void> = [];

    constructor(home: string, now: () => number = Date.now) {
        this.path = join(home, 'auth.json');
        this.now = now;
    }

    /*
     * Lets a key in on a statement the caller already checked. The nonce is spent before anything
     * else is decided, so a statement is good for one admission whatever that admission turns out to
     * be. A key that already has a record keeps it; a revoked key gets nothing, since revoking a
     * device has to hold while that device is still signed in to the account.
     */
    async admitStatement(entry: StatementEntry): Promise<StatementAdmission> {
        if (!isPublicKey(entry.publicKey)) {
            return { refused: 'bad-key' };
        }

        return this.transition((state) => this.admit(state, entry));
    }

    private async admit(state: State, entry: StatementEntry): Promise<StatementAdmission> {
        const now = this.now();
        const spentNonces = state.spentNonces.filter((spent) => spent.until >= now);
        if (spentNonces.some((spent) => spent.nonce === entry.nonce)) {
            return { refused: 'replayed' };
        }
        spentNonces.push({ nonce: entry.nonce, until: entry.keepNonceUntil });
        if (state.revokedKeys.includes(entry.publicKey)) {
            await this.save({ ...state, spentNonces });
            return { refused: 'revoked' };
        }
        // Decided here rather than by the caller, so a person taking the machine off its account in between is never missed.
        const accountRefusal = statementAccountRefusal(state.account, entry.accountId);
        if (accountRefusal !== null) {
            await this.save({ ...state, spentNonces });
            return { refused: accountRefusal };
        }
        const known = state.sessions.find((record) => record.publicKey === entry.publicKey);
        if (known) {
            const sameKind =
                entry.peer === undefined
                    ? known.origin === 'statement'
                    : known.origin === 'peer' && known.machineId === entry.peer.machineId && known.machinePublicKey === entry.peer.machinePublicKey;
            if (!sameKind) {
                await this.save({ ...state, spentNonces });
                return { refused: 'key-in-use' };
            }
            known.lastSeenAt = now;
            if (known.origin === 'peer') {
                known.attestedAt = now;
            }
            await this.save({ ...state, spentNonces });
            return { sessionId: known.id, created: false };
        }
        const record: SessionRecord = {
            id: randomBytes(6).toString('base64url'),
            label: entry.label,
            publicKey: entry.publicKey,
            origin: entry.peer === undefined ? 'statement' : 'peer',
            ...(entry.peer === undefined ? {} : { machineId: entry.peer.machineId, machinePublicKey: entry.peer.machinePublicKey, attestedAt: now }),
            ...(entry.accountId === null ? {} : { account: entry.accountId }),
            createdAt: now,
            lastSeenAt: now
        };
        await this.save({ ...state, sessions: [...state.sessions, record], spentNonces });
        return { sessionId: record.id, created: true };
    }

    /* The account this machine is on: absent when it never signed for one since this was kept, null once a person took it off. */
    async accountBinding(): Promise<Binding> {
        const { account } = await this.load();
        return account && { ...account };
    }

    /*
     * Puts the machine on an account, which signing a registration for it does. The same account again
     * changes nothing; another one is refused. A client another account let in on a statement loses its
     * access, since a machine is on one account. One whose statement named no account stays: it most
     * likely came from this account before accounts were written down, and nothing says otherwise.
     */
    async bindAccount(accountId: string): Promise<AccountChange> {
        return this.transition(async (state) => {
            if (state.account !== undefined && state.account !== null) {
                return { bound: state.account.id === accountId, revoked: [] };
            }

            const revoked = state.sessions.filter((record) => record.account !== undefined && record.account !== accountId);

            await this.save({
                ...state,
                sessions: state.sessions.filter((record) => !revoked.includes(record)),
                account: { id: accountId, since: this.now() }
            });

            return { bound: true, revoked: revoked.map((record) => record.id) };
        });
    }

    /*
     * Takes the machine off its account, which only a person on the machine does. Every client a statement
     * let in loses its access, and no statement lets anyone in until the machine signs for an account again.
     * A key that loses its access this way is not revoked: the same device may come back through the next account.
     */
    async leaveAccount(): Promise<string[]> {
        const revoked = await this.transition(async (state) => {
            const left = state.account?.id;
            const leaving = state.sessions.filter((record) => record.account === undefined || record.account === left);
            await this.save({ ...state, sessions: state.sessions.filter((record) => !leaving.includes(record)), account: null });

            return leaving;
        });

        // Outside the transition, so a listener that asks the store something does not wait on itself.
        for (const listener of this.leftListeners) {
            await listener();
        }
        return revoked.map((record) => record.id);
    }

    /* Told once the machine left its account, so what it holds of that account's other machines goes with it. */
    onLeft(listener: () => Promise<void> | void): void {
        this.leftListeners.push(listener);
    }

    /* The session a public key belongs to; the caller checks the signature that goes with it. */
    async sessionForPublicKey(publicKey: string): Promise<string | null> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.publicKey === publicKey);
        return record !== undefined && this.attested(record) ? record.id : null;
    }

    /*
     * Until when the address book vouches for the machine that works here, whether or not that has run
     * out already; null for a machine that never worked here. A peer whose time ran out stays on record
     * so that a new statement brings it back under the same session, and its links with it.
     */
    async attestedUntil(machineId: string): Promise<number | null> {
        const times = (await this.load()).sessions.flatMap((record) =>
            record.origin === 'peer' && record.machineId === machineId ? [(record.attestedAt ?? record.createdAt) + PEER_ATTESTATION_TTL_MS] : []
        );
        return times.length === 0 ? null : Math.max(...times);
    }

    /* A client is let in until it is revoked, a peer for as long as the address book last vouched for it. */
    private attested(record: SessionRecord): boolean {
        return record.origin !== 'peer' || this.now() <= (record.attestedAt ?? record.createdAt) + PEER_ATTESTATION_TTL_MS;
    }

    /* The machine a session is, or null for a client; a peer is a machine of the account and never an owner. */
    async peerOf(sessionId: string): Promise<{ machineId: string; machinePublicKey: string } | null> {
        const record = (await this.load()).sessions.find((entry) => entry.id === sessionId);

        return record === undefined ? null : standingOf(record).peer;
    }

    /* Whether a session still has its access, which a credential handed out before a revoke has to ask again. */
    async hasSession(sessionId: string): Promise<boolean> {
        return (await this.standing(sessionId)) !== null;
    }

    /* Whether a session still has its access and as what, read together; null once it is gone or ran out. */
    async standing(sessionId: string): Promise<SessionStanding | null> {
        const record = (await this.load()).sessions.find((entry) => entry.id === sessionId);

        return record === undefined || !this.attested(record) ? null : standingOf(record);
    }

    /* Notes that a client proved its key just now, answering what it is; null when it was revoked since it was looked up. */
    async noteSeen(sessionId: string): Promise<SessionStanding | null> {
        return this.transition(async (state) => {
            const record = state.sessions.find((entry) => entry.id === sessionId);
            if (!record || !this.attested(record)) {
                return null;
            }

            record.lastSeenAt = this.now();
            await this.save(state);

            return standingOf(record);
        });
    }

    async setPush(sessionId: string, subscription: PushSubscribePayload): Promise<boolean> {
        return this.transition(async (state) => {
            const record = state.sessions.find((entry) => entry.id === sessionId);
            if (!record) {
                return false;
            }

            record.push = PushSubscribePayloadSchema.parse(subscription);
            await this.save(state);

            return true;
        });
    }

    async removePush(sessionId: string, handle: string): Promise<void> {
        await this.transition(async (state) => {
            const record = state.sessions.find((entry) => entry.id === sessionId && entry.push?.handle === handle);
            if (record) {
                delete record.push;
                await this.save(state);
            }
        });
    }

    async pushSubscriptions(): Promise<Array<{ sessionId: string; subscription: PushSubscribePayload }>> {
        return (await this.load()).sessions.flatMap((record) => (record.push ? [{ sessionId: record.id, subscription: structuredClone(record.push) }] : []));
    }

    async list(currentId: string | null): Promise<AuthSession[]> {
        return (await this.load()).sessions.map((entry) => ({
            id: entry.id,
            label: entry.label,
            origin: entry.origin === 'peer' ? 'statement' : entry.origin,
            ...(entry.origin === 'peer' ? { machineId: entry.machineId } : {}),
            createdAt: entry.createdAt,
            lastSeenAt: entry.lastSeenAt,
            current: entry.id === currentId
        }));
    }

    /*
     * Takes a client's access away. Its key is remembered, so a statement for it gets nothing: a device
     * signed in to the account comes back only under a key of its own that is new.
     */
    async revoke(id: string): Promise<boolean> {
        return this.transition(async (state) => {
            const record = state.sessions.find((entry) => entry.id === id);
            if (!record) {
                return false;
            }

            const key = record.publicKey;
            const revokedKeys = state.revokedKeys.includes(key) ? state.revokedKeys : [...state.revokedKeys, key];
            const sessions = state.sessions.filter((entry) => entry.id !== id && entry.publicKey !== key);
            await this.save({ ...state, sessions, revokedKeys });

            return true;
        });
    }

    private transition<T>(work: (state: State) => Promise<T>): Promise<T> {
        return this.transitions.run(async () => work(await this.load()));
    }

    // One read of the file per store, shared by every caller, so a late first read never replaces a change made since.
    private load(): Promise<State> {
        this.state ??= this.read();

        return this.state;
    }

    private async read(): Promise<State> {
        try {
            const parsed = FileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));

            return parsed.success
                ? {
                      sessions: parsed.data.sessions.flatMap((record) => statementRecord(record) ?? []),
                      spentNonces: parsed.data.spentNonces ?? [],
                      revokedKeys: parsed.data.revokedKeys ?? [],
                      account: parsed.data.account
                  }
                : emptyState(null);
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The auth file would not parse; starting with no sessions:', errorText(e));
            }

            return emptyState(isNotFound(e) ? undefined : null);
        }
    }

    /* Only from inside a transition, which keeps the writes in order as well. */
    private async save(state: State): Promise<void> {
        this.state = Promise.resolve(state);
        await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
        await writeAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`, 0o600, { durable: true });
    }
}
