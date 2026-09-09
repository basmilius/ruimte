import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthSession } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

// A pairing URL that nobody used in ten minutes is not going to be.
export const PAIRING_TTL_MS = 10 * 60 * 1000;

const SessionRecordSchema = z.object({
    id: z.string().min(1),
    label: z.string(),
    tokenHash: z.string().min(1),
    createdAt: z.number(),
    lastSeenAt: z.number()
});
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

/*
 * Who may talk to this daemon from another machine. Session tokens are long-lived, stored as
 * hashes in `$RUIMTE_HOME/auth.json`, and handed out once for a pairing token that the daemon
 * printed and that dies after one use or ten minutes. Loopback needs none of this.
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

    /* Trades a pairing token for a session token; null when the token is unknown, used or stale. */
    async pair(token: string, label: string): Promise<{ id: string; sessionToken: string } | null> {
        const pairing = this.pairing;
        if (!pairing || this.now() > pairing.expiresAt || !sameHash(hash(token), pairing.tokenHash)) {
            return null;
        }
        this.pairing = null;
        const sessionToken = randomBytes(32).toString('base64url');
        const record: SessionRecord = {
            id: randomBytes(6).toString('base64url'),
            label,
            tokenHash: hash(sessionToken),
            createdAt: this.now(),
            lastSeenAt: this.now()
        };
        const sessions = await this.load();
        await this.save([...sessions, record]);
        return { id: record.id, sessionToken };
    }

    /* The session a token belongs to, with its last-seen time moved to now. */
    async authenticate(token: string): Promise<string | null> {
        const wanted = hash(token);
        const sessions = await this.load();
        const record = sessions.find((entry) => sameHash(entry.tokenHash, wanted));
        if (!record) {
            return null;
        }
        record.lastSeenAt = this.now();
        void this.save(sessions).catch(() => undefined);
        return record.id;
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
