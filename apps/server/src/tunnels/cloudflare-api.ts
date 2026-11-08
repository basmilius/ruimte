import { z } from 'zod';

/* Deliberately not configurable: the token is sent to Cloudflare and nowhere else, and a redirect is an error. */
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 50;
// More pages than any account has, so paging stops rather than follows a count that never ends.
const MAX_PAGES = 20;
const MAX_REASON = 300;

export type CloudflareFetch = (url: string, init: RequestInit) => Promise<Response>;

export type CloudflareErrorCode = 'token-refused' | 'no-permission' | 'not-found' | 'conflict' | 'rate-limited' | 'unreachable' | 'cloudflare';

/* A failure in the words of a person: what Ruimte was doing and why Cloudflare would not. Never holds the token. */
export class CloudflareError extends Error {
    readonly code: CloudflareErrorCode;

    constructor(code: CloudflareErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

const EnvelopeSchema = z.object({
    success: z.boolean().optional(),
    errors: z.array(z.object({ message: z.string().optional() })).optional(),
    result: z.unknown().optional(),
    result_info: z.object({ total_pages: z.number().optional() }).optional()
});

const NamedSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const TokenStatusSchema = z.object({ status: z.string() });
const ZoneSchema = NamedSchema.extend({ account: NamedSchema });
const TunnelSchema = NamedSchema.extend({
    deleted_at: z.string().nullish(),
    config_src: z.string().nullish(),
    remote_config: z.boolean().nullish(),
    status: z.string().nullish(),
    connections: z.array(z.object({ is_pending_reconnect: z.boolean().nullish() })).nullish()
});
const RecordSchema = z.object({
    id: z.string().min(1),
    type: z.string(),
    name: z.string(),
    content: z.string().optional(),
    proxied: z.boolean().optional(),
    comment: z.string().nullish()
});
const ConfigSchema = z.object({ config: z.looseObject({ ingress: z.array(z.record(z.string(), z.unknown())).optional() }).nullish() });

export type CloudflareNamed = z.infer<typeof NamedSchema>;
export type CloudflareZone = z.infer<typeof ZoneSchema>;
export type CloudflareTunnel = z.infer<typeof TunnelSchema>;
export type CloudflareRecord = z.infer<typeof RecordSchema>;

/* Whether the tunnel's settings live in the dashboard, which is the only kind whose hostnames the API changes. */
export function isDashboardManaged(tunnel: CloudflareTunnel): boolean {
    return tunnel.config_src === 'cloudflare' || tunnel.remote_config === true;
}

/*
 * Whether something runs the tunnel now, from its connections, or from its status where Cloudflare leaves the
 * connections out. A connection waiting to reconnect is no runner.
 */
export function isRunning(tunnel: CloudflareTunnel): boolean {
    if (tunnel.connections !== null && tunnel.connections !== undefined) {
        return tunnel.connections.some((connection) => connection.is_pending_reconnect !== true);
    }

    return tunnel.status === 'healthy' || tunnel.status === 'degraded';
}

/* A rule of a tunnel's ingress as Cloudflare keeps it. Rules Ruimte did not write keep every key they had. */
export type CloudflareIngressRule = Record<string, unknown>;

/* A tunnel's configuration: its ingress, and the settings beside it (such as `warp-routing`) that Ruimte never changes. */
export interface CloudflareTunnelConfig {
    readonly ingress: readonly CloudflareIngressRule[];
    readonly rest: Readonly<Record<string, unknown>>;
}

export interface CloudflareRecordInput {
    readonly name: string;
    readonly content: string;
    readonly comment: string;
}

/*
 * The part of Cloudflare's v4 API Tunnels use, with the API token the person typed. Every call names what it does in
 * words a person reads, so a failure says what did not happen. Nothing here logs, and the token is cut out of any
 * sentence Cloudflare sent back before it leaves.
 */
export class CloudflareApi {
    private readonly token: string;
    private readonly send: CloudflareFetch;

    constructor(token: string, send: CloudflareFetch) {
        this.token = token;
        this.send = send;
    }

    /* The token is active; Cloudflare's own check, which needs no permission. */
    async verifyToken(): Promise<void> {
        const what = 'Checking the API token';
        let status: z.infer<typeof TokenStatusSchema>;

        try {
            status = TokenStatusSchema.parse(await this.call('GET', '/user/tokens/verify', what));
        } catch (e) {
            if (!(e instanceof CloudflareError && e.code === 'token-refused')) {
                throw e;
            }

            // The check under /user refuses a token an account owns; such a token that lists zones works all the same.
            await this.call('GET', '/zones?per_page=5', what).catch(() => {
                throw e;
            });

            return;
        }

        if (status.status !== 'active') {
            throw new CloudflareError('token-refused', `Cloudflare says this API token is ${status.status}. Make a new token and paste it here.`);
        }
    }

    /* Every active zone the token reads, each with its account, which is how Ruimte learns the accounts without a permission to list them. */
    zones(): Promise<CloudflareZone[]> {
        return this.pages('/zones?status=active', 'Listing your Cloudflare zones', ZoneSchema);
    }

    async findTunnel(accountId: string, name: string): Promise<CloudflareTunnel | null> {
        const path = `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`;
        const found = z.array(TunnelSchema).parse(await this.call('GET', path, `Looking for the tunnel ${name}`));

        return found.find((tunnel) => tunnel.name === name) ?? null;
    }

    /* Every tunnel on the account that is not deleted, whoever made it. */
    tunnels(accountId: string): Promise<CloudflareTunnel[]> {
        return this.pages(`/accounts/${accountId}/cfd_tunnel?is_deleted=false`, 'Listing the tunnels of the account', TunnelSchema);
    }

    /* A tunnel whose ingress lives in Cloudflare, so the dashboard shows the same as Ruimte. */
    async createTunnel(accountId: string, name: string): Promise<CloudflareTunnel> {
        return TunnelSchema.parse(
            await this.call('POST', `/accounts/${accountId}/cfd_tunnel`, `Creating the tunnel ${name}`, { name, config_src: 'cloudflare' })
        );
    }

    /* Null for a tunnel that is gone from the account, or was deleted. */
    async tunnel(accountId: string, tunnelId: string): Promise<CloudflareTunnel | null> {
        try {
            const tunnel = TunnelSchema.parse(await this.call('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}`, 'Looking up the tunnel'));

            return tunnel.deleted_at ? null : tunnel;
        } catch (e) {
            if (e instanceof CloudflareError && e.code === 'not-found') {
                return null;
            }

            throw e;
        }
    }

    /* The token `cloudflared` runs the tunnel with; the caller hands it to the child's environment and keeps it nowhere else. */
    async tunnelToken(accountId: string, tunnelId: string): Promise<string> {
        const token = z
            .string()
            .min(1)
            .parse(await this.call('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, "Fetching the tunnel's run token"));

        return token;
    }

    async configuration(accountId: string, tunnelId: string): Promise<CloudflareTunnelConfig> {
        const { config } = ConfigSchema.parse(
            await this.call('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, "Reading the tunnel's hostnames")
        );
        const { ingress, ...rest } = config ?? {};

        return { ingress: ingress ?? [], rest };
    }

    /* Writes the ingress back with every other setting the configuration had, since Cloudflare replaces it whole. */
    async putConfiguration(accountId: string, tunnelId: string, config: CloudflareTunnelConfig): Promise<void> {
        await this.call('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, "Saving the tunnel's hostnames", {
            config: { ...config.rest, ingress: config.ingress }
        });
    }

    /* Every record with this name, of any type, since a CNAME cannot sit beside another one. */
    async recordsNamed(zoneId: string, name: string): Promise<CloudflareRecord[]> {
        return z
            .array(RecordSchema)
            .parse(await this.call('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`, `Looking for DNS records named ${name}`));
    }

    createRecord(zoneId: string, input: CloudflareRecordInput): Promise<CloudflareRecord> {
        return this.writeRecord('POST', `/zones/${zoneId}/dns_records`, input);
    }

    updateRecord(zoneId: string, recordId: string, input: CloudflareRecordInput): Promise<CloudflareRecord> {
        return this.writeRecord('PUT', `/zones/${zoneId}/dns_records/${recordId}`, input);
    }

    async deleteRecord(zoneId: string, recordId: string, name: string): Promise<void> {
        try {
            await this.call('DELETE', `/zones/${zoneId}/dns_records/${recordId}`, `Deleting the DNS record for ${name}`);
        } catch (e) {
            // Gone already is what the caller wanted.
            if (!(e instanceof CloudflareError && e.code === 'not-found')) {
                throw e;
            }
        }
    }

    private async writeRecord(method: 'POST' | 'PUT', path: string, input: CloudflareRecordInput): Promise<CloudflareRecord> {
        const body = { type: 'CNAME', name: input.name, content: input.content, proxied: true, ttl: 1, comment: input.comment };

        return RecordSchema.parse(await this.call(method, path, `Writing the DNS record for ${input.name}`, body));
    }

    private async pages<T>(path: string, what: string, item: z.ZodType<T>): Promise<T[]> {
        const found: T[] = [];
        const joiner = path.includes('?') ? '&' : '?';

        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const envelope = await this.envelope('GET', `${path}${joiner}per_page=${PAGE_SIZE}&page=${page}`, what);

            found.push(...z.array(item).parse(envelope.result ?? []));

            if (page >= (envelope.result_info?.total_pages ?? 1)) {
                break;
            }
        }

        return found;
    }

    private async call(method: string, path: string, what: string, body?: unknown): Promise<unknown> {
        return (await this.envelope(method, path, what, body)).result;
    }

    private async envelope(method: string, path: string, what: string, body?: unknown): Promise<z.infer<typeof EnvelopeSchema>> {
        let response: Response;

        try {
            response = await this.send(`${CLOUDFLARE_API}${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${this.token}`,
                    accept: 'application/json',
                    ...(body === undefined ? {} : { 'content-type': 'application/json' })
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
        } catch {
            throw new CloudflareError('unreachable', `${what} failed. Ruimte could not reach Cloudflare. Check the internet connection.`);
        }

        const parsed = EnvelopeSchema.safeParse(await response.json().catch(() => null));
        const envelope = parsed.success ? parsed.data : {};

        if (response.ok && envelope.success !== false) {
            return envelope;
        }

        throw this.failure(response.status, what, envelope.errors?.[0]?.message);
    }

    private failure(status: number, what: string, said: string | undefined): CloudflareError {
        const reason = said === undefined ? '' : ` Cloudflare said: ${this.withoutToken(said).slice(0, MAX_REASON)}`;

        if (status === 401) {
            return new CloudflareError(
                'token-refused',
                `${what} failed. Cloudflare does not accept this API token. Make a new one and paste it here.${reason}`
            );
        }

        if (status === 403) {
            return new CloudflareError(
                'no-permission',
                `${what} failed. The API token may not do that. It needs Zone read, DNS edit and Cloudflare Tunnel edit.${reason}`
            );
        }

        if (status === 404) {
            return new CloudflareError('not-found', `${what} failed. Cloudflare could not find it.${reason}`);
        }

        if (status === 409) {
            return new CloudflareError('conflict', `${what} failed. It already exists.${reason}`);
        }

        if (status === 429) {
            return new CloudflareError('rate-limited', `${what} failed. Cloudflare asks Ruimte to slow down. Try again in a minute.`);
        }

        return new CloudflareError('cloudflare', `${what} failed (Cloudflare answered ${status}).${reason}`);
    }

    private withoutToken(text: string): string {
        return text.replaceAll(this.token, '[token]');
    }
}
