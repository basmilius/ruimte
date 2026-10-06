import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PushSubscribePayloadSchema, type AuthSession, type PushSubscribePayload } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '@adecore/agents/fs';
import { isPublicKey } from '@ruimte/pulsar/verify-node';
import { errorText } from '../error-text.ts';
import { Serializer } from '@adecore/agents/serializer';

/*
 * A client a statement let in, by the key it proves per connection. A record of a pairing link from
 * before links went (`origin` absent or `link`, or a session token without a key) still reads, and
 * is dropped as the file loads, so that client has to come back through the account.
 */
const StoredRecordSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    publicKey: z.string().min(1).optional(),
    origin: z.enum(['link', 'statement']).optional().catch(undefined),
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
    origin: 'statement';
    account?: string;
    createdAt: number;
    lastSeenAt: number;
    push?: PushSubscribePayload;
}

function statementRecord(record: z.infer<typeof StoredRecordSchema>): SessionRecord | null {
    return record.origin === 'statement' && record.publicKey !== undefined ? { ...record, publicKey: record.publicKey, origin: 'statement' } : null;
}

/*
 * The nonces of statements this machine took, kept until the statement could no longer be believed
 * anyway, and the keys a person revoked. Both are on disk: a restart inside a statement's lifetime
 * must not make its nonce new again, and a revoked device must not walk back in on the next statement
 * the address book hands it. Dropped rather than refused when they will not read, like the sessions.
 */
const AccountBindingSchema = z.object({ id: z.string().min(1), since: z.number() });
export type AccountBinding = z.infer<typeof AccountBindingSchema>;

const FileSchema = z.object({
    sessions: z.array(StoredRecordSchema),
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
}

export type StatementAccountRefusal = 'wrong-account' | 'account-required' | 'no-account';

export type StatementAdmission = { sessionId: string; created: boolean } | { refused: 'replayed' | 'revoked' | 'bad-key' | StatementAccountRefusal };

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
    private state: State | null = null;
    private readonly writes = new Serializer();
    private readonly now: () => number;

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
        const state = await this.load();
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
            known.lastSeenAt = now;
            await this.save({ ...state, spentNonces });
            return { sessionId: known.id, created: false };
        }
        const record: SessionRecord = {
            id: randomBytes(6).toString('base64url'),
            label: entry.label,
            publicKey: entry.publicKey,
            origin: 'statement',
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
        return account === undefined || account === null ? account : { ...account };
    }

    /*
     * Puts the machine on an account, which signing a registration for it does. The same account again
     * changes nothing; another one is refused. A client another account let in on a statement loses its
     * access, since a machine is on one account. One whose statement named no account stays: it most
     * likely came from this account before accounts were written down, and nothing says otherwise.
     */
    async bindAccount(accountId: string): Promise<AccountChange> {
        const state = await this.load();
        if (state.account !== undefined && state.account !== null) {
            return { bound: state.account.id === accountId, revoked: [] };
        }
        const revoked = state.sessions.filter((record) => record.origin === 'statement' && record.account !== undefined && record.account !== accountId);
        await this.save({
            ...state,
            sessions: state.sessions.filter((record) => !revoked.includes(record)),
            account: { id: accountId, since: this.now() }
        });
        return { bound: true, revoked: revoked.map((record) => record.id) };
    }

    /*
     * Takes the machine off its account, which only a person on the machine does. Every client a statement
     * let in loses its access, and no statement lets anyone in until the machine signs for an account again.
     * A key that loses its access this way is not revoked: the same device may come back through the next account.
     */
    async leaveAccount(): Promise<string[]> {
        const state = await this.load();
        const left = state.account?.id;
        const revoked = state.sessions.filter((record) => record.origin === 'statement' && (record.account === undefined || record.account === left));
        await this.save({ ...state, sessions: state.sessions.filter((record) => !revoked.includes(record)), account: null });
        return revoked.map((record) => record.id);
    }

    /* The session a public key belongs to; the caller checks the signature that goes with it. */
    async sessionForPublicKey(publicKey: string): Promise<string | null> {
        const state = await this.load();
        return state.sessions.find((entry) => entry.publicKey === publicKey)?.id ?? null;
    }

    /* Whether a session still has its access, which a credential handed out before a revoke has to ask again. */
    async hasSession(sessionId: string): Promise<boolean> {
        return (await this.load()).sessions.some((entry) => entry.id === sessionId);
    }

    /* Notes that a client proved its key just now; false when it was revoked since it was looked up. */
    async noteSeen(sessionId: string): Promise<boolean> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId);
        if (!record) {
            return false;
        }
        record.lastSeenAt = this.now();
        await this.save(state);
        return true;
    }

    async setPush(sessionId: string, subscription: PushSubscribePayload): Promise<boolean> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId);
        if (!record) {
            return false;
        }
        record.push = PushSubscribePayloadSchema.parse(subscription);
        await this.save(state);
        return true;
    }

    async removePush(sessionId: string, handle: string): Promise<void> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId && entry.push?.handle === handle);
        if (record) {
            delete record.push;
            await this.save(state);
        }
    }

    async pushSubscriptions(): Promise<Array<{ sessionId: string; subscription: PushSubscribePayload }>> {
        return (await this.load()).sessions.flatMap((record) => (record.push ? [{ sessionId: record.id, subscription: structuredClone(record.push) }] : []));
    }

    async list(currentId: string | null): Promise<AuthSession[]> {
        return (await this.load()).sessions.map((entry) => ({
            id: entry.id,
            label: entry.label,
            origin: entry.origin,
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
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === id);
        if (!record) {
            return false;
        }
        const key = record.publicKey;
        const revokedKeys = state.revokedKeys.includes(key) ? state.revokedKeys : [...state.revokedKeys, key];
        const sessions = state.sessions.filter((entry) => entry.id !== id && entry.publicKey !== key);
        await this.save({ ...state, sessions, revokedKeys });
        return true;
    }

    private async load(): Promise<State> {
        if (this.state) {
            return this.state;
        }
        try {
            const parsed = FileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
            this.state = parsed.success
                ? {
                      sessions: parsed.data.sessions.flatMap((record) => statementRecord(record) ?? []),
                      spentNonces: parsed.data.spentNonces ?? [],
                      revokedKeys: parsed.data.revokedKeys ?? [],
                      account: parsed.data.account
                  }
                : { sessions: [], spentNonces: [], revokedKeys: [], account: null };
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The auth file would not parse; starting with no sessions:', errorText(e));
            }
            this.state = { sessions: [], spentNonces: [], revokedKeys: [], account: isNotFound(e) ? undefined : null };
        }
        return this.state;
    }

    private async save(state: State): Promise<void> {
        this.state = state;
        const text = `${JSON.stringify(state, null, 2)}\n`;
        await this.writes.run(async () => {
            await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
            await writeAtomic(this.path, text, 0o600, { durable: true });
        });
    }
}
