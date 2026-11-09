import { createHash } from 'node:crypto';
import type { TunnelOrigin, TunnelRow } from '@ruimte/contracts';

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(\\.${LABEL})+$`);
const MACHINE_NAME_MAX = 40;
const MACHINE_SUFFIX_LENGTH = 4;

export class TunnelConfigError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

/* A hostname as Cloudflare takes it: lowercase labels, at least two, no wildcard and no port. Throws a `TunnelConfigError` otherwise. */
export function normalizedHostname(raw: string): string {
    const hostname = raw.trim().toLowerCase().replace(/\.$/, '');

    if (hostname.length > 253 || !HOSTNAME.test(hostname)) {
        throw new TunnelConfigError(
            'invalid-hostname',
            `${raw.trim()} is not a hostname Cloudflare accepts. Use lowercase letters, digits and hyphens, with a domain after the first label.`
        );
    }

    return hostname;
}

/*
 * The hostname a person's input names in a zone: a label goes in front of the zone, a hostname that already ends in the
 * zone is taken as it is. A hostname in another zone the token reaches is refused rather than nested under this one.
 */
export function hostnameInZone(raw: string, zone: string, otherZones: readonly string[]): string {
    const typed = raw.trim().toLowerCase().replace(/\.$/, '');

    if (typed === zone) {
        throw new TunnelConfigError('apex', `A tunnel needs a name under ${zone}, such as app.${zone}`);
    }

    if (!typed.endsWith(`.${zone}`)) {
        const other = otherZones.find((candidate) => typed.endsWith(`.${candidate}`));

        if (other !== undefined) {
            throw new TunnelConfigError('wrong-zone', `${typed} belongs to ${other}, not to ${zone}. Pick ${other} in the list of domains.`);
        }
    }

    return normalizedHostname(typed.endsWith(`.${zone}`) ? typed : `${typed}.${zone}`);
}

/*
 * The name of this machine's tunnel in the Cloudflare dashboard. Two machines often share a host name, so a short
 * piece of the machine's id keeps their tunnels apart on one account.
 */
export function tunnelNameOf(machine: string, machineId: string): string {
    const slug = machine
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MACHINE_NAME_MAX)
        .replace(/-+$/g, '');

    return `ruimte-${slug === '' ? 'machine' : slug}-${machineMarkOf(machineId)}`;
}

/* A short piece of the machine's id, which tells this machine's tunnel and DNS records from another machine's. */
export function machineMarkOf(machineId: string): string {
    return createHash('sha256').update(machineId).digest('hex').slice(0, MACHINE_SUFFIX_LENGTH);
}

/*
 * Why a dev server may not use this port, or null. A tunnel never points at the daemon's own API: the deny list
 * holds the ports Ruimte listens on, and the external listener only ever belongs to the MCP row.
 */
export function deniedPortReason(port: number, denied: readonly number[]): string | null {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return `${port} is no port`;
    }

    return denied.includes(port) ? `Port ${port} belongs to Ruimte itself, and a tunnel never points at it` : null;
}

const ORIGIN_NAME = new RegExp(`^${LABEL}(\\.${LABEL})*$`);

/* A name a dev server is asked for, one label or more, so `passly.test` and `localhost` both pass. Null for one that is none. */
function originName(raw: string, allowPort: boolean): string | null {
    const typed = raw.trim().toLowerCase().replace(/\.$/, '');
    const match = /^(.*?)(?::(\d{1,5}))?$/.exec(typed);
    const name = match?.[1] ?? '';
    const port = match?.[2];

    if (name.length > 253 || !ORIGIN_NAME.test(name)) {
        return null;
    }

    if (port !== undefined && (!allowPort || Number(port) < 1 || Number(port) > 65535)) {
        return null;
    }

    return port === undefined ? name : `${name}:${Number(port)}`;
}

/*
 * The origin settings of a dev row as they are kept: only what differs from Cloudflare's default, undefined for none.
 * Throws a `TunnelConfigError` for a name that is none, or for a certificate setting without https.
 */
export function normalizedOrigin(origin: TunnelOrigin | undefined): TunnelOrigin | undefined {
    if (origin === undefined) {
        return undefined;
    }

    const hostHeader = origin.hostHeader?.trim() ?? '';
    const serverName = origin.serverName?.trim() ?? '';
    const kept: TunnelOrigin = {};

    if (origin.https === true) {
        kept.https = true;
    }

    if (hostHeader !== '') {
        const name = originName(hostHeader, true);

        if (name === null) {
            throw new TunnelConfigError(
                'invalid-host-header',
                `${hostHeader} is not a host header. Use a hostname such as passly.test, with a port or without.`
            );
        }

        kept.hostHeader = name;
    }

    if ((origin.noTlsVerify === true || serverName !== '') && kept.https !== true) {
        throw new TunnelConfigError('tls-without-https', 'Skip TLS check and Server name only apply to https');
    }

    if (origin.noTlsVerify === true) {
        kept.noTlsVerify = true;
    }

    if (serverName !== '') {
        const name = originName(serverName, false);

        if (name === null) {
            throw new TunnelConfigError('invalid-server-name', `${serverName} is not a server name. Use a hostname such as passly.test, without a port.`);
        }

        kept.serverName = name;
    }

    return Object.keys(kept).length === 0 ? undefined : kept;
}

export interface IngressInput {
    readonly rows: readonly TunnelRow[];
    /* Where the external listener is; the MCP row has no ingress without one. */
    readonly listenerPort: number | null;
    readonly denied: readonly number[];
}

export interface IngressRule {
    readonly hostname: string;
    readonly service: string;
    readonly originRequest?: { httpHostHeader?: string; noTLSVerify?: boolean; originServerName?: string };
}

/* A dev row's rule in Cloudflare's words, with an `originRequest` only when the row sets something. */
function devRule(hostname: string, port: number, origin: TunnelOrigin | undefined): IngressRule {
    const service = `${origin?.https === true ? 'https' : 'http'}://127.0.0.1:${port}`;
    const originRequest = {
        ...(origin?.hostHeader === undefined ? {} : { httpHostHeader: origin.hostHeader }),
        ...(origin?.noTlsVerify === true ? { noTLSVerify: true } : {}),
        ...(origin?.serverName === undefined ? {} : { originServerName: origin.serverName })
    };

    return Object.keys(originRequest).length === 0 ? { hostname, service } : { hostname, service, originRequest };
}

/*
 * The rules of the rows that are on: a dev row points at its one literal loopback port, over http or https, the MCP row
 * at the external listener with no origin settings of its own.
 */
export function ingressRules({ rows, listenerPort, denied }: IngressInput): IngressRule[] {
    const rules: IngressRule[] = [];

    for (const row of rows) {
        if (!row.enabled) {
            continue;
        }

        if (row.kind === 'mcp') {
            if (listenerPort !== null) {
                rules.push({ hostname: row.hostname, service: `http://127.0.0.1:${listenerPort}` });
            }

            continue;
        }

        if (row.port === null) {
            throw new TunnelConfigError('port-denied', 'A dev server needs a port');
        }

        const reason = deniedPortReason(row.port, denied);

        if (reason !== null) {
            throw new TunnelConfigError('port-denied', reason);
        }

        rules.push(devRule(row.hostname, row.port, row.origin));
    }

    return rules;
}

/*
 * What a rule for a row's hostname serves, read back as a row keeps it: null for a rule that answers a status (the 404
 * that holds the name), else whether it serves, with the port and origin of a rule that points at loopback the way
 * `devRule` writes one. A rule changed into something else still serves, so it counts as on.
 */
export function servedBy(rule: Record<string, unknown>): { port?: number; origin?: TunnelOrigin } | null {
    const service = typeof rule.service === 'string' ? rule.service : '';

    if (service.startsWith('http_status:')) {
        return null;
    }

    const loopback = /^(https?):\/\/127\.0\.0\.1:(\d{1,5})$/.exec(service);

    if (loopback === null) {
        return {};
    }

    const request = typeof rule.originRequest === 'object' && rule.originRequest !== null ? (rule.originRequest as Record<string, unknown>) : {};
    const origin: TunnelOrigin = {
        ...(loopback[1] === 'https' ? { https: true } : {}),
        ...(typeof request.httpHostHeader === 'string' && request.httpHostHeader !== '' ? { hostHeader: request.httpHostHeader } : {}),
        ...(request.noTLSVerify === true ? { noTlsVerify: true } : {}),
        ...(typeof request.originServerName === 'string' && request.originServerName !== '' ? { serverName: request.originServerName } : {})
    };

    return { port: Number(loopback[2]), ...(Object.keys(origin).length === 0 ? {} : { origin }) };
}

/* Whether a rule takes a request for the root path of a hostname, matched the way `cloudflared` matches its ingress. */
function takesRoot(rule: Record<string, unknown>, hostname: string): boolean {
    const ruleHost = typeof rule.hostname === 'string' && rule.hostname !== '' ? rule.hostname : null;

    if (ruleHost !== null && ruleHost !== hostname && !(ruleHost.startsWith('*.') && hostname.endsWith(ruleHost.slice(1)))) {
        return false;
    }

    if (typeof rule.path !== 'string' || rule.path === '') {
        return true;
    }

    try {
        return new RegExp(rule.path).test('/');
    } catch {
        // Cloudflare would not have taken a path that is no regular expression, so it is no proof the rule takes nothing.
        return true;
    }
}

/*
 * What Cloudflare may serve for a hostname from this ingress, as `servedBy` reads it, or null when it serves nothing: the
 * first rule that takes its root path decides, and only a status answers without reaching an origin.
 */
export function servedFor(ingress: readonly Record<string, unknown>[], hostname: string): { port?: number; origin?: TunnelOrigin } | null {
    const first = ingress.find((rule) => takesRoot(rule, hostname));

    return first === undefined ? null : servedBy(first);
}

/* The catch-all every ingress ends in, which answers 404 for any other hostname. */
export const CATCH_ALL = { service: 'http_status:404' } as const;

/* A rule with neither hostname nor path matches everything, so it can only be the last one. */
export function isCatchAll(rule: Record<string, unknown>): boolean {
    return rule.hostname === undefined && rule.path === undefined;
}
