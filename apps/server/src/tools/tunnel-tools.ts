import { ToolRefusal } from '@adecore/agents/context';
import { TUNNEL_PROPOSAL_ACTIONS, TUNNEL_PROPOSAL_LIMITS, type TunnelOrigin, type TunnelRow, type TunnelState } from '@ruimte/contracts';
import { z } from 'zod';
import { TunnelConfigError } from '../tunnels/tunnel-config.ts';
import type { TunnelChange, TunnelProposalAsk } from '../tunnels/tunnel-proposals.ts';
import type { StoredRow } from '../tunnels/tunnel-store.ts';
import { ANSWER_WAKES_NOTE, field, orNote, type TunnelAgentHost } from './host.ts';
import { defineTool, type ToolCall } from './tool.ts';

function tunnelsOf(call: ToolCall): TunnelAgentHost {
    const tunnels = call.host.tunnels;

    if (tunnels === undefined) {
        throw new ToolRefusal('unsupported', 'This host has no tunnels');
    }

    return tunnels;
}

/* What a person reads on the row: the hostname serves, it is off, or why it is not reachable. */
function observedOf(row: TunnelRow, state: TunnelState): string {
    if (row.reason !== undefined) {
        return `not-reachable\t${field(row.reason)}`;
    }

    if (!row.enabled) {
        return 'off';
    }

    return state.stage === 'running' ? 'serving' : `not-reachable\t${field(state.message ?? `the tunnel is ${state.stage}`)}`;
}

function rowLine(row: TunnelRow, state: TunnelState): string {
    const target =
        row.kind === 'mcp' ? ['-', '-', '-'] : [String(row.port ?? '-'), row.origin?.https === true ? 'https' : 'http', field(row.origin?.hostHeader ?? '-')];

    return ['hostname', row.hostname, row.kind, ...target, row.enabled ? 'on' : 'off', observedOf(row, state)].join('\t');
}

function proposalLines(tunnels: TunnelAgentHost, chatId: string): string[] {
    const { standing, settled } = tunnels.of(chatId);

    return [
        ...standing.map((proposal) => `proposal\t${proposal.proposalId}\t${proposal.action}\t${proposal.hostname}\t${proposal.stale ? 'stale' : 'waiting'}`),
        ...settled.map((outcome) => `proposal\t${outcome.proposalId}\t${outcome.action}\t${outcome.hostname}\t${outcome.outcome}`)
    ];
}

/* Read freely: the hostnames Ruimte manages on this machine's tunnel and what Cloudflare does with them, never the token. */
const tunnelList = defineTool('browser', {
    name: 'tunnel_list',
    description: "Lists the public hostnames of this machine's tunnel, its domains and your suggestions.",
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const tunnels = tunnelsOf(call);
        const state = await tunnels.state();

        return [
            state.tunnel === null ? `tunnel\tnone\t${state.stage}` : `tunnel\t${field(state.tunnel.name)}\t${state.stage}`,
            ...(state.tunnel === null ? ['note\tA person sets up a tunnel under Tunnels in Settings first'] : []),
            ...state.zones.map((zone) => `zone\t${zone.name}`),
            ...orNote(
                state.rows.map((row) => rowLine(row, state)),
                'Ruimte has no hostname on this tunnel'
            ),
            ...proposalLines(tunnels, call.caller)
        ];
    }
});

function rowNamed(tunnels: TunnelAgentHost, state: TunnelState, hostname: string): { shown: TunnelRow; meant: StoredRow } {
    const shown = state.rows.find((row) => row.hostname === hostname);
    const meant = tunnels.rowsAsMeant().find((row) => row.id === shown?.id);

    if (shown !== undefined && meant !== undefined) {
        return { shown, meant };
    }

    // A hostname a person or another tool put on the tunnel is theirs, as Settings keeps it read-only.
    if (state.tunnel?.others.some((rule) => rule.hostname === hostname) === true) {
        throw new ToolRefusal('not-ruimte', `${hostname} is on this tunnel, but Ruimte does not manage it`);
    }

    throw new ToolRefusal(
        'unknown-hostname',
        `${hostname} is not a hostname of Ruimte on this tunnel`,
        state.rows.map((row) => `hostname\t${row.hostname}`)
    );
}

interface Target {
    port?: number;
    protocol?: 'http' | 'https';
    host_header?: string;
}

/* The origin a dev row gets: what it had, with the protocol and host header the agent named in place of its own. */
function originAfter(before: TunnelOrigin | undefined, target: Target): TunnelOrigin | undefined {
    const next: TunnelOrigin = { ...before };

    if (target.protocol === 'http') {
        delete next.https;
        delete next.noTlsVerify;
        delete next.serverName;
    } else if (target.protocol === 'https') {
        next.https = true;
    }

    if (target.host_header === '') {
        delete next.hostHeader;
    } else if (target.host_header !== undefined) {
        next.hostHeader = target.host_header;
    }

    return Object.keys(next).length === 0 ? undefined : next;
}

function sameOrigin(left: TunnelOrigin | undefined, right: TunnelOrigin | undefined): boolean {
    const plain = (origin: TunnelOrigin | undefined) =>
        JSON.stringify([origin?.https === true, origin?.hostHeader ?? null, origin?.noTlsVerify === true, origin?.serverName ?? null]);

    return plain(left) === plain(right);
}

function addAsk(tunnels: TunnelAgentHost, state: TunnelState, hostname: string, target: Target): Omit<TunnelProposalAsk, 'chatId' | 'reason'> {
    if (target.port === undefined) {
        throw new ToolRefusal('bad-arguments', 'add needs port, the port of the dev server');
    }

    const zone = tunnels.zoneOf(hostname);

    if (zone === null) {
        throw new ToolRefusal(
            'unknown-zone',
            `${hostname} is in none of the domains this tunnel can use`,
            state.zones.map((entry) => `zone\t${entry.name}`)
        );
    }

    const origin = originAfter(undefined, target);
    const input = { kind: 'dev' as const, zone: zone.id, label: hostname, port: target.port, ...(origin === undefined ? {} : { origin }) };

    return { change: { action: 'add', input }, kind: 'dev', hostname, port: target.port, ...(origin === undefined ? {} : { origin }) };
}

function rowAsk(
    action: Exclude<TunnelChange['action'], 'add'>,
    row: TunnelRow,
    meant: StoredRow,
    target: Target
): Omit<TunnelProposalAsk, 'chatId' | 'reason'> {
    const words = { kind: row.kind, hostname: row.hostname };
    const retargets = target.port !== undefined || target.protocol !== undefined || target.host_header !== undefined;
    const on = meant.enabled && meant.leaving !== true;

    if (action !== 'edit' && retargets) {
        throw new ToolRefusal('bad-arguments', `${action} takes no port, protocol or host_header; edit changes those`);
    }

    if (action === 'remove') {
        // Settings leaves the MCP's hostname to the person, and an agent never decides whether the MCP is reachable at all.
        if (row.kind === 'mcp') {
            throw new ToolRefusal('mcp-row', "An agent does not remove the MCP's hostname; a person does under Tunnels in Settings");
        }

        return { change: { action, rowId: row.id }, ...words, port: meant.port, ...(meant.origin === undefined ? {} : { origin: meant.origin }) };
    }

    if (action === 'on' || action === 'off') {
        if (on === (action === 'on')) {
            throw new ToolRefusal('unchanged', `${row.hostname} is ${action} already`);
        }

        return {
            change: { action, rowId: row.id, change: { enabled: action === 'on' } },
            ...words,
            port: meant.port,
            ...(meant.origin === undefined ? {} : { origin: meant.origin })
        };
    }

    if (row.kind === 'mcp') {
        throw new ToolRefusal('mcp-fixed', 'The MCP always points at Ruimte itself');
    }

    if (!retargets) {
        throw new ToolRefusal('bad-arguments', 'edit needs port, protocol or host_header');
    }

    const port = target.port ?? meant.port;
    const origin = originAfter(meant.origin, target);

    if (port === meant.port && sameOrigin(origin, meant.origin)) {
        throw new ToolRefusal('unchanged', `${row.hostname} points there already`);
    }

    return {
        change: { action, rowId: row.id, change: { ...(port === null ? {} : { port }), origin: origin ?? {} } },
        ...words,
        port,
        ...(origin === undefined ? {} : { origin })
    };
}

/*
 * Only a card: nothing reaches Cloudflare until a person confirms it in the chat, and the confirm is the change the
 * person makes under Tunnels in Settings. The call does not wait: the person's answer wakes the chat, and tunnel_list
 * or the next suggestion for the hostname says what became of a card nobody answered.
 */
const tunnelPropose = defineTool('browser', {
    name: 'tunnel_propose',
    description: 'Suggests a change to a tunnel hostname in a card; nothing changes until the person confirms, and their answer wakes you.',
    audience: 'chat',
    input: z.object({
        action: z.enum(TUNNEL_PROPOSAL_ACTIONS, { error: `action takes ${TUNNEL_PROPOSAL_ACTIONS.join(', ')}` }),
        hostname: z
            .string({ error: 'tunnel_propose needs hostname, such as app.example.com' })
            .trim()
            .toLowerCase()
            .min(1, 'tunnel_propose needs hostname, such as app.example.com')
            .max(253, 'hostname is at most 253 characters'),
        port: z
            .number({ error: 'port needs a port number' })
            .int('port is a whole number')
            .min(1, 'port is 1 to 65535')
            .max(65535, 'port is 1 to 65535')
            .optional()
            .describe('The dev server port, for add and edit'),
        protocol: z.enum(['http', 'https'], { error: 'protocol takes http or https' }).optional(),
        host_header: z.string().trim().max(259, 'host_header is at most 259 characters').optional().describe('Empty clears it'),
        reason: z.string().trim().max(TUNNEL_PROPOSAL_LIMITS.reason, `reason is at most ${TUNNEL_PROPOSAL_LIMITS.reason} characters`).optional()
    }),
    async run(input, call) {
        const tunnels = tunnelsOf(call);
        const state = await tunnels.state();
        const hostname = input.hostname.replace(/\.$/, '');
        const target: Target = {
            ...(input.port === undefined ? {} : { port: input.port }),
            ...(input.protocol === undefined ? {} : { protocol: input.protocol }),
            ...(input.host_header === undefined ? {} : { host_header: input.host_header })
        };
        let ask: Omit<TunnelProposalAsk, 'chatId' | 'reason'>;

        if (input.action === 'add') {
            ask = addAsk(tunnels, state, hostname, target);
        } else {
            const { shown, meant } = rowNamed(tunnels, state, hostname);

            ask = rowAsk(input.action, shown, meant, target);
        }

        try {
            const answer = tunnels.propose({ ...ask, chatId: call.caller, ...(input.reason ? { reason: input.reason } : {}) });

            return [`proposal\t${answer.proposalId}\t${answer.outcome}`, ...(answer.outcome === 'waiting' ? [ANSWER_WAKES_NOTE] : [])];
        } catch (e) {
            if (e instanceof TunnelConfigError) {
                throw new ToolRefusal(e.code, e.message);
            }

            throw e;
        }
    }
});

export const tunnelTools = [tunnelList, tunnelPropose];
