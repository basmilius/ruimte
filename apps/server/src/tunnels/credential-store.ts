import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { CredentialSchema, DEFAULT_EXTERNAL_CEILING, DEFAULT_EXTERNAL_TIER, type Credential, type CredentialKind, type ExternalGrant } from '@ruimte/contracts';
import { z } from 'zod';
import { clientHost } from './client-metadata.ts';
import { tunnelsFolder } from './tunnel-store.ts';

export const BEARER_PREFIX = 'rmb_';
const ACCESS_PREFIX = 'rma_';
const REFRESH_PREFIX = 'rmr_';

export const ACCESS_TOKEN_LIFETIME_MS = 60 * 60_000;
// A rotated refresh token is remembered so that a copy of it, used later, is noticed.
const RETIRED_REFRESH_TOKENS = 8;
// What the settings read as a client "connected lately".
export const RECENT_USE_MS = 10 * 60_000;
const LAST_USED_WRITE_MS = 60_000;
// The settings show "used N minutes ago", so a use is news only after this long without one.
const USE_NEWS_MS = 60_000;

/* The hash of a token, which is all the daemon keeps of one. */
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/* Compares two hex digests without an early exit. */
function sameHash(one: string, other: string): boolean {
    const left = Buffer.from(one);
    const right = Buffer.from(other);

    return left.length === right.length && timingSafeEqual(left, right);
}

const StoredCredentialSchema = CredentialSchema.extend({
    /* A bearer's hash. */
    secretHash: z.string().nullable(),
    oauth: z
        .object({
            clientId: z.string(),
            accessHash: z.string().nullable(),
            accessExpiresAt: z.number(),
            refreshHash: z.string().nullable(),
            retired: z.array(z.string())
        })
        .nullable()
});
type StoredCredential = z.infer<typeof StoredCredentialSchema>;

const FileSchema = z.object({ version: z.literal(1), credentials: z.array(StoredCredentialSchema) });

export interface CredentialStoreOptions {
    /* `$RUIMTE_HOME`; the file is `tunnels/credentials.json`, 0600 in a 0700 folder. Absent keeps nothing, for a test. */
    home?: string;
    now(): number;
    /* Random bytes, as base64url text. */
    random(bytes: number): string;

    /* Called when a credential is used for the first time, or again after a minute without use, so settings can refresh what they show. */
    used?(): void;
}

export type CredentialRefusal = 'unknown' | 'expired' | 'wrong-door';

/* What a request that presented a token is, or why it is nothing. */
export type CredentialCheck = { ok: true; credential: Credential; client: string } | { ok: false; reason: CredentialRefusal };

/* The name a person reads for a client: a bearer's label, or the host of an OAuth client's address, never the unverified name it gave. */
function clientOf(stored: StoredCredential): string {
    return stored.oauth === null ? stored.label : clientHost(stored.oauth.clientId);
}

/* The grant a hosted client gets when a person names none: all projects, Work, `supervised`, no approvals. */
export function defaultGrant(): ExternalGrant {
    return { tier: DEFAULT_EXTERNAL_TIER, projects: null, ceiling: DEFAULT_EXTERNAL_CEILING, approvals: false };
}

export function mergedGrant(base: ExternalGrant, change: Partial<ExternalGrant> | undefined): ExternalGrant {
    return { ...base, ...(change ?? {}) };
}

function publicCredential(stored: StoredCredential): Credential {
    return {
        id: stored.id,
        label: stored.label,
        kind: stored.kind,
        grant: stored.grant,
        bearerOnHostname: stored.bearerOnHostname,
        expiresAt: stored.expiresAt,
        createdAt: stored.createdAt,
        lastUsedAt: stored.lastUsedAt
    };
}

/*
 * The credentials of external MCP clients. The daemon keeps hashes only, in one file under `$RUIMTE_HOME/tunnels`
 * with mode 0600. A secret exists in the clear once, in the answer that makes it; no log, error or event carries one.
 */
export class CredentialStore {
    private readonly options: CredentialStoreOptions;
    private readonly writes = new Serializer();
    private records: StoredCredential[] = [];
    private persistedUse = new Map<string, number>();

    constructor(options: CredentialStoreOptions) {
        this.options = options;
    }

    private get path(): string | null {
        return this.options.home === undefined ? null : join(tunnelsFolder(this.options.home), 'credentials.json');
    }

    async load(): Promise<void> {
        const path = this.path;

        if (path === null) {
            return;
        }

        let text: string;

        try {
            text = await readFile(path, 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return;
            }

            throw e;
        }

        const parsed = FileSchema.safeParse(safeJson(text));

        // Neither the text nor the parser's message, which quote the file: it holds hashes of live credentials.
        if (!parsed.success) {
            console.warn(`The credentials file ${path} would not read; no external client has a credential until new ones are made`);

            return;
        }

        this.records = parsed.data.credentials;
    }

    private persist(): Promise<void> {
        const path = this.path;

        if (path === null) {
            return Promise.resolve();
        }

        const text = `${JSON.stringify({ version: 1, credentials: this.records }, null, 2)}\n`;

        return this.writes.run(async () => {
            await mkdir(tunnelsFolder(this.options.home!), { recursive: true, mode: 0o700 });
            await writeAtomic(path, text, 0o600, { durable: true });
        });
    }

    /* Resolves once the writes started so far are on disk. */
    settled(): Promise<void> {
        return this.writes.run(async () => undefined);
    }

    list(): Credential[] {
        return this.records.map(publicCredential);
    }

    get(id: string): Credential | null {
        const stored = this.records.find((record) => record.id === id);

        return stored === undefined ? null : publicCredential(stored);
    }

    /* How many credentials were used lately. */
    recentlyUsed(): number {
        const since = this.options.now() - RECENT_USE_MS;

        return this.records.filter((record) => (record.lastUsedAt ?? 0) >= since).length;
    }

    private add(kind: CredentialKind, label: string, grant: ExternalGrant, extra: Partial<StoredCredential>): StoredCredential {
        const record: StoredCredential = {
            id: `cred-${this.options.random(9)}`,
            label,
            kind,
            grant,
            bearerOnHostname: false,
            expiresAt: null,
            createdAt: this.options.now(),
            lastUsedAt: null,
            secretHash: null,
            oauth: null,
            ...extra
        };

        this.records.push(record);

        return record;
    }

    /* A bearer made in the app. The secret in the answer is the only time it exists in the clear. */
    async createBearer(input: {
        label: string;
        grant?: Partial<ExternalGrant>;
        bearerOnHostname?: boolean;
        expiresAt?: number | null;
    }): Promise<{ credential: Credential; secret: string }> {
        const secret = `${BEARER_PREFIX}${this.options.random(32)}`;
        const record = this.add('bearer', input.label, mergedGrant(defaultGrant(), input.grant), {
            secretHash: hashToken(secret),
            bearerOnHostname: input.bearerOnHostname ?? false,
            expiresAt: input.expiresAt ?? null
        });

        await this.persist();

        return { credential: publicCredential(record), secret };
    }

    /* The credential an approved OAuth client holds from then on, with its first access and refresh token. */
    async createOAuth(input: {
        label: string;
        clientId: string;
        grant: ExternalGrant;
        expiresAt?: number | null;
    }): Promise<{ credential: Credential; tokens: OAuthTokens }> {
        const record = this.add('oauth', input.label, input.grant, {
            expiresAt: input.expiresAt ?? null,
            oauth: { clientId: input.clientId, accessHash: null, accessExpiresAt: 0, refreshHash: null, retired: [] }
        });
        const tokens = this.rotate(record);

        await this.persist();

        return { credential: publicCredential(record), tokens };
    }

    private rotate(record: StoredCredential): OAuthTokens {
        const oauth = record.oauth!;
        const access = `${ACCESS_PREFIX}${this.options.random(32)}`;
        const refresh = `${REFRESH_PREFIX}${this.options.random(32)}`;

        if (oauth.refreshHash !== null) {
            oauth.retired = [oauth.refreshHash, ...oauth.retired].slice(0, RETIRED_REFRESH_TOKENS);
        }

        oauth.accessHash = hashToken(access);
        oauth.accessExpiresAt = this.options.now() + ACCESS_TOKEN_LIFETIME_MS;
        oauth.refreshHash = hashToken(refresh);

        return { accessToken: access, refreshToken: refresh, expiresInS: ACCESS_TOKEN_LIFETIME_MS / 1000 };
    }

    /*
     * Trades a refresh token for a new pair. A token that was rotated away already is a copy in someone else's
     * hands: the credential is revoked, and the answer says so.
     */
    async refresh(
        token: string,
        clientId: string
    ): Promise<{ ok: true; tokens: OAuthTokens; credential: Credential } | { ok: false; reason: 'unknown' | 'reused' }> {
        const hash = hashToken(token);
        let current: StoredCredential | undefined;
        let reused: StoredCredential | undefined;

        // Every record is compared, so the time taken does not say which one matched.
        for (const record of this.records) {
            if (record.oauth === null) {
                continue;
            }

            if (record.oauth.refreshHash !== null && sameHash(record.oauth.refreshHash, hash)) {
                current = record;
            }

            for (const retired of record.oauth.retired) {
                if (sameHash(retired, hash)) {
                    reused = record;
                }
            }
        }

        if (reused !== undefined && current === undefined) {
            this.records = this.records.filter((record) => record !== reused);
            await this.persist();

            return { ok: false, reason: 'reused' };
        }

        if (current === undefined || current.oauth!.clientId !== clientId || this.isExpired(current)) {
            return { ok: false, reason: 'unknown' };
        }

        const tokens = this.rotate(current);

        await this.persist();

        return { ok: true, tokens, credential: publicCredential(current) };
    }

    private isExpired(record: StoredCredential): boolean {
        return record.expiresAt !== null && record.expiresAt <= this.options.now();
    }

    /*
     * Judges a token: a bearer, or an OAuth access token. Checked on every request, so a revoke counts from the
     * next one. `door` says where the request came in: a bearer on the public hostname works only if the credential allows it.
     */
    authenticate(token: string, door: 'loopback' | 'hostname'): CredentialCheck {
        const hash = hashToken(token);
        let found: StoredCredential | undefined;

        for (const record of this.records) {
            const expected = record.secretHash ?? record.oauth?.accessHash ?? null;

            if (expected !== null && sameHash(expected, hash)) {
                found = record;
            }
        }

        if (found === undefined) {
            return { ok: false, reason: 'unknown' };
        }

        if (this.isExpired(found) || (found.oauth !== null && found.oauth.accessExpiresAt <= this.options.now())) {
            return { ok: false, reason: 'expired' };
        }

        if (found.secretHash !== null && door === 'hostname' && !found.bearerOnHostname) {
            return { ok: false, reason: 'wrong-door' };
        }

        this.touch(found);

        return { ok: true, credential: publicCredential(found), client: clientOf(found) };
    }

    private touch(record: StoredCredential): void {
        const now = this.options.now();
        const previous = record.lastUsedAt;

        record.lastUsedAt = now;

        if (previous === null || now - previous >= USE_NEWS_MS) {
            this.options.used?.();
        }

        if (now - (this.persistedUse.get(record.id) ?? 0) >= LAST_USED_WRITE_MS) {
            this.persistedUse.set(record.id, now);
            void this.persist().catch((e: unknown) => console.warn('Writing the credentials file failed:', e instanceof Error ? e.name : 'error'));
        }
    }

    async update(
        id: string,
        change: { label?: string; grant?: Partial<ExternalGrant>; bearerOnHostname?: boolean; expiresAt?: number | null }
    ): Promise<Credential | null> {
        const record = this.records.find((candidate) => candidate.id === id);

        if (record === undefined) {
            return null;
        }

        if (change.label !== undefined) {
            record.label = change.label;
        }

        record.grant = mergedGrant(record.grant, change.grant);

        if (change.bearerOnHostname !== undefined && record.kind === 'bearer') {
            record.bearerOnHostname = change.bearerOnHostname;
        }

        if (change.expiresAt !== undefined) {
            record.expiresAt = change.expiresAt;
        }

        await this.persist();

        return publicCredential(record);
    }

    /* True when there was a credential to revoke. From the next request on, its tokens are nothing. */
    async revoke(id: string): Promise<boolean> {
        const before = this.records.length;

        this.records = this.records.filter((record) => record.id !== id);

        if (this.records.length === before) {
            return false;
        }

        await this.persist();

        return true;
    }
}

export interface OAuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresInS: number;
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
