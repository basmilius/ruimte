import type { TunnelRow } from '@ruimte/contracts';

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(\\.${LABEL})+$`);

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
            `${raw.trim()} is no hostname Cloudflare takes; use lowercase letters, digits and hyphens, with a domain after the first label`
        );
    }

    return hostname;
}

/* The domain a person picked: a hostname of its own. */
export function normalizedDomain(raw: string): string {
    const domain = raw.trim().toLowerCase().replace(/\.$/, '');

    if (!HOSTNAME.test(domain) || domain.length > 253) {
        throw new TunnelConfigError('invalid-domain', `${raw.trim()} is no domain; use the domain that sits on your Cloudflare account, such as example.com`);
    }

    return domain;
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
    readonly tunnelId: string;
    /* The path `cloudflared tunnel create` named. Ruimte writes it into the config and never opens it. */
    readonly credentialsFile: string;
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

/* A JSON string is a YAML string, so a path with a space or a quote needs no escaping of its own. */
function scalar(value: string): string {
    return JSON.stringify(value);
}

/* The file `cloudflared` runs with: the tunnel, the path of its credentials, the rules and a closing 404 for every other hostname. */
export function configYaml(input: IngressInput): string {
    const lines = [`tunnel: ${scalar(input.tunnelId)}`, `credentials-file: ${scalar(input.credentialsFile)}`, 'ingress:'];

    for (const rule of ingressRules(input)) {
        lines.push(`  - hostname: ${scalar(rule.hostname)}`, `    service: ${scalar(rule.service)}`);
    }

    lines.push('  - service: http_status:404');

    return `${lines.join('\n')}\n`;
}
