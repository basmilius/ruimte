import type { TunnelRow } from '@ruimte/contracts';

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(\\.${LABEL})+$`);
const MACHINE_NAME_MAX = 40;

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

/* The name of this machine's tunnel in the Cloudflare dashboard. */
export function tunnelNameOf(machine: string): string {
    const slug = machine
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MACHINE_NAME_MAX)
        .replace(/-+$/g, '');

    return `ruimte-${slug === '' ? 'machine' : slug}`;
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

export interface IngressInput {
    readonly rows: readonly TunnelRow[];
    /* Where the external listener is; the MCP row has no ingress without one. */
    readonly listenerPort: number | null;
    readonly denied: readonly number[];
}

export interface IngressRule {
    readonly hostname: string;
    readonly service: string;
}

/* The rules of the rows that are on: a dev row points at its one literal loopback port, the MCP row at the external listener. */
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

        const reason = row.port === null ? 'A dev server needs a port' : deniedPortReason(row.port, denied);

        if (reason !== null) {
            throw new TunnelConfigError('port-denied', reason);
        }

        rules.push({ hostname: row.hostname, service: `http://127.0.0.1:${row.port}` });
    }

    return rules;
}

/* The catch-all every ingress ends in, which answers 404 for any other hostname. */
export const CATCH_ALL = { service: 'http_status:404' } as const;

/* A rule with neither hostname nor path matches everything, so it can only be the last one. */
export function isCatchAll(rule: Record<string, unknown>): boolean {
    return rule.hostname === undefined && rule.path === undefined;
}
