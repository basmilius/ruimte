import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PushSubscribePayloadSchema, type AuthSession, type PairingOrigin, type PushSubscribePayload } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { isPublicKey } from './keys.ts';
import { errorText } from '../error-text.ts';

// A pairing URL that nobody used in ten minutes is not going to be.
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/*
 * Both credentials are optional and a record needs one of them. `publicKey` is what a client pairs
 * with now: it signs a challenge per connection and nothing long lived ever travels. `tokenHash` is
 * what a client paired with before there were key pairs, kept so nobody has to pair again; it goes
 * the moment that client has proved it can sign. `origin` says how the client got in: a pairing link
 * a person handed over, or a statement from the address book. Absent is a link, which is every
 * record from before statements.
 */
const SessionRecordSchema = z
    .object({
        id: z.string().min(1),
        label: z.string(),
        tokenHash: z.string().min(1).optional(),
        publicKey: z.string().min(1).optional(),
        origin: z.enum(['link', 'statement']).optional().catch(undefined),
        createdAt: z.number(),
        lastSeenAt: z.number(),
        push: PushSubscribePayloadSchema.optional()
    })
    .refine((record) => record.tokenHash !== undefined || record.publicKey !== undefined);
type SessionRecord = z.infer<typeof SessionRecordSchema>;

/*
 * The nonces of statements this machine took, kept until the statement could no longer be believed
 * anyway, and the keys a person revoked. Both are on disk: a restart inside a statement's lifetime
 * must not make its nonce new again, and a revoked device must not walk back in on the next statement
 * the address book hands it. Dropped rather than refused when they will not read, like the sessions.
 */
const FileSchema = z.object({
    sessions: z.array(SessionRecordSchema),
    spentNonces: z
        .array(z.object({ nonce: z.string().min(1), until: z.number() }))
        .optional()
        .catch(undefined),
    revokedKeys: z.array(z.string().min(1)).optional().catch(undefined)
});

interface State {
    sessions: SessionRecord[];
    spentNonces: { nonce: string; until: number }[];
    revokedKeys: string[];
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

const sameHash = (a: string, b: string): boolean => {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
};

interface Pairing {
    tokenHash: string;
    expiresAt: number;
}

export interface PairOptions {
    label: string;
    // The client's ed25519 public key; without one the client is handed a session token instead.
    publicKey?: string;
}

export interface StatementEntry {
    publicKey: string;
    label: string;
    nonce: string;
    // When the nonce may be forgotten: past the statement's expiry and the clock skew allowed on it.
    keepNonceUntil: number;
}

export type StatementAdmission = { sessionId: string; created: boolean } | { refused: 'replayed' | 'revoked' | 'bad-key' };

/*
 * Who may talk to this daemon from another machine. A client registers a public key when it pairs
 * and proves it per connection; a client from before that holds a session token, stored as a hash
 * in `$RUIMTE_HOME/auth.json`. Either way it pairs once, for a token the daemon printed that dies
 * after one use or ten minutes, or through a statement from the address book. A process on the
 * daemon's own machine presents the local secret instead.
 */
export class AuthStore {
    readonly path: string;
    private state: State | null = null;
    private writes: Promise<void> = Promise.resolve();
    private pairing: Pairing | null = null;
    private readonly now: () => number;

    constructor(home: string, now: () => number = Date.now) {
        this.path = join(home, 'auth.json');
        this.now = now;
    }

    /* A fresh one-time token; the previous one, used or not, stops working. */
    issuePairingToken(): string {
        const token = randomBytes(24).toString('base64url');
        this.pairing = { tokenHash: hash(token), expiresAt: this.now() + PAIRING_TTL_MS };
        return token;
    }

    /* Trades a pairing token for a registered key or a session token; null when the token is unknown, used or stale. */
    async pair(token: string, options: PairOptions): Promise<{ id: string; sessionToken?: string } | null> {
        const pairing = this.pairing;
        if (!pairing || this.now() > pairing.expiresAt || !sameHash(hash(token), pairing.tokenHash)) {
            return null;
        }
        this.pairing = null;
        const keyed = options.publicKey !== undefined && isPublicKey(options.publicKey);
        const sessionToken = keyed ? undefined : randomBytes(32).toString('base64url');
        const record: SessionRecord = {
            id: randomBytes(6).toString('base64url'),
            label: options.label,
            ...(keyed ? { publicKey: options.publicKey } : { tokenHash: hash(sessionToken!) }),
            origin: 'link',
            createdAt: this.now(),
            lastSeenAt: this.now()
        };
        const state = await this.load();
        // A person handing out a link for a key they once revoked is taking that revocation back.
        const revokedKeys = keyed ? state.revokedKeys.filter((key) => key !== options.publicKey) : state.revokedKeys;
        await this.save({ ...state, sessions: [...state.sessions, record], revokedKeys });
        return sessionToken === undefined ? { id: record.id } : { id: record.id, sessionToken };
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
            createdAt: now,
            lastSeenAt: now
        };
        await this.save({ ...state, sessions: [...state.sessions, record], spentNonces });
        return { sessionId: record.id, created: true };
    }

    /* The session a token belongs to, with its last-seen time moved to now. */
    async authenticate(token: string): Promise<string | null> {
        const wanted = hash(token);
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.tokenHash !== undefined && sameHash(entry.tokenHash, wanted));
        if (!record) {
            return null;
        }
        return this.touch(record, state);
    }

    /* The session a public key belongs to; the caller checks the signature that goes with it. */
    async sessionForPublicKey(publicKey: string): Promise<string | null> {
        const state = await this.load();
        return state.sessions.find((entry) => entry.publicKey === publicKey)?.id ?? null;
    }

    /*
     * Marks a client as having signed for itself. The session token goes with it: keeping it until
     * this moment is what lets a client that paired before key pairs move over without pairing
     * again, and dropping it the moment a signature lands means the thing that used to sit in every
     * socket URL stops working for good.
     */
    async noteSignedIn(sessionId: string): Promise<void> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId);
        if (!record) {
            return;
        }
        delete record.tokenHash;
        record.lastSeenAt = this.now();
        await this.save(state);
    }

    /*
     * Hangs a public key on a session that has none, which is how a client paired before key pairs
     * upgrades over its own authenticated connection. A key another session already holds is
     * refused: the daemon looks a client up by its key, so two records on one key is an ambiguity.
     */
    async registerKey(sessionId: string, publicKey: string): Promise<boolean> {
        if (!isPublicKey(publicKey)) {
            return false;
        }
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId);
        if (!record || state.sessions.some((entry) => entry.id !== sessionId && entry.publicKey === publicKey)) {
            return false;
        }
        if (record.publicKey === publicKey) {
            return true;
        }
        record.publicKey = publicKey;
        await this.save(state);
        return true;
    }

    async setPush(sessionId: string, subscription: PushSubscribePayload): Promise<boolean> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === sessionId && entry.publicKey !== undefined);
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
        return (await this.load()).sessions.flatMap((record) =>
            record.publicKey && record.push ? [{ sessionId: record.id, subscription: structuredClone(record.push) }] : []
        );
    }

    async list(currentId: string | null): Promise<AuthSession[]> {
        return (await this.load()).sessions.map((entry) => ({
            id: entry.id,
            label: entry.label,
            origin: (entry.origin ?? 'link') satisfies PairingOrigin,
            createdAt: entry.createdAt,
            lastSeenAt: entry.lastSeenAt,
            current: entry.id === currentId
        }));
    }

    /* Takes a client's access away. Its key is remembered, so a statement for it gets nothing until a person pairs it again with a link. */
    async revoke(id: string): Promise<boolean> {
        const state = await this.load();
        const record = state.sessions.find((entry) => entry.id === id);
        if (!record) {
            return false;
        }
        const revokedKeys =
            record.publicKey === undefined || state.revokedKeys.includes(record.publicKey) ? state.revokedKeys : [...state.revokedKeys, record.publicKey];
        await this.save({ ...state, sessions: state.sessions.filter((entry) => entry.id !== id), revokedKeys });
        return true;
    }

    private touch(record: SessionRecord, state: State): string {
        record.lastSeenAt = this.now();
        void this.save(state).catch(() => undefined);
        return record.id;
    }

    private async load(): Promise<State> {
        if (this.state) {
            return this.state;
        }
        try {
            const parsed = FileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
            this.state = parsed.success
                ? { sessions: parsed.data.sessions, spentNonces: parsed.data.spentNonces ?? [], revokedKeys: parsed.data.revokedKeys ?? [] }
                : { sessions: [], spentNonces: [], revokedKeys: [] };
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The auth file would not parse; starting with no sessions:', errorText(e));
            }
            this.state = { sessions: [], spentNonces: [], revokedKeys: [] };
        }
        return this.state;
    }

    private async save(state: State): Promise<void> {
        this.state = state;
        const text = `${JSON.stringify(state, null, 2)}\n`;
        const write = this.writes
            .catch(() => undefined)
            .then(async () => {
                await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
                await writeAtomic(this.path, text);
            });
        this.writes = write;
        await write;
    }
}
