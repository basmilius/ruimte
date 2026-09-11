import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthSession } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { isPublicKey } from './keys.ts';

// A pairing URL that nobody used in ten minutes is not going to be.
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/*
 * Both credentials are optional and a record needs one of them. `publicKey` is what a client pairs
 * with now: it signs a challenge per connection and nothing long lived ever travels. `tokenHash` is
 * what a client paired with before there were key pairs, kept so nobody has to pair again; it goes
 * the moment that client has proved it can sign.
 */
const SessionRecordSchema = z
    .object({
        id: z.string().min(1),
        label: z.string(),
        tokenHash: z.string().min(1).optional(),
        publicKey: z.string().min(1).optional(),
        createdAt: z.number(),
        lastSeenAt: z.number()
    })
    .refine((record) => record.tokenHash !== undefined || record.publicKey !== undefined);
type SessionRecord = z.infer<typeof SessionRecordSchema>;

const FileSchema = z.object({ sessions: z.array(SessionRecordSchema) });

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

/*
 * Who may talk to this daemon from another machine. A client registers a public key when it pairs
 * and proves it per connection; a client from before that holds a session token, stored as a hash
 * in `$RUIMTE_HOME/auth.json`. Either way it pairs once, for a token the daemon printed that dies
 * after one use or ten minutes. Loopback needs none of this.
 */
export class AuthStore {
    readonly path: string;
    private sessions: SessionRecord[] | null = null;
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
            createdAt: this.now(),
            lastSeenAt: this.now()
        };
        const sessions = await this.load();
        await this.save([...sessions, record]);
        return sessionToken === undefined ? { id: record.id } : { id: record.id, sessionToken };
    }

    /* The session a token belongs to, with its last-seen time moved to now. */
    async authenticate(token: string): Promise<string | null> {
        const wanted = hash(token);
        const sessions = await this.load();
        const record = sessions.find((entry) => entry.tokenHash !== undefined && sameHash(entry.tokenHash, wanted));
        if (!record) {
            return null;
        }
        return this.touch(record, sessions);
    }

    /* The session a public key belongs to; the caller checks the signature that goes with it. */
    async sessionForPublicKey(publicKey: string): Promise<string | null> {
        const sessions = await this.load();
        return sessions.find((entry) => entry.publicKey === publicKey)?.id ?? null;
    }

    /*
     * Marks a client as having signed for itself. The session token goes with it: keeping it until
     * this moment is what lets a client that paired before key pairs move over without pairing
     * again, and dropping it the moment a signature lands means the thing that used to sit in every
     * socket URL stops working for good.
     */
    async noteSignedIn(sessionId: string): Promise<void> {
        const sessions = await this.load();
        const record = sessions.find((entry) => entry.id === sessionId);
        if (!record) {
            return;
        }
        delete record.tokenHash;
        record.lastSeenAt = this.now();
        await this.save(sessions);
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
        const sessions = await this.load();
        const record = sessions.find((entry) => entry.id === sessionId);
        if (!record || sessions.some((entry) => entry.id !== sessionId && entry.publicKey === publicKey)) {
            return false;
        }
        if (record.publicKey === publicKey) {
            return true;
        }
        record.publicKey = publicKey;
        await this.save(sessions);
        return true;
    }

    async list(currentId: string | null): Promise<AuthSession[]> {
        return (await this.load()).map((entry) => ({
            id: entry.id,
            label: entry.label,
            createdAt: entry.createdAt,
            lastSeenAt: entry.lastSeenAt,
            current: entry.id === currentId
        }));
    }

    async revoke(id: string): Promise<boolean> {
        const sessions = await this.load();
        const next = sessions.filter((entry) => entry.id !== id);
        if (next.length === sessions.length) {
            return false;
        }
        await this.save(next);
        return true;
    }

    private touch(record: SessionRecord, sessions: SessionRecord[]): string {
        record.lastSeenAt = this.now();
        void this.save(sessions).catch(() => undefined);
        return record.id;
    }

    private async load(): Promise<SessionRecord[]> {
        if (this.sessions) {
            return this.sessions;
        }
        try {
            const parsed = FileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
            this.sessions = parsed.success ? parsed.data.sessions : [];
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The auth file would not parse; starting with no sessions', e);
            }
            this.sessions = [];
        }
        return this.sessions;
    }

    private async save(sessions: SessionRecord[]): Promise<void> {
        this.sessions = sessions;
        await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
        await writeAtomic(this.path, `${JSON.stringify({ sessions }, null, 2)}\n`);
    }
}
