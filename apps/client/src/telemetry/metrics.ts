import type { RequestType } from '@ruimte/contracts';
import type { LinkMeter } from '@/transport/link-transport';
import type { SignalRoute } from '@/transport/transport';

/*
 * The fixed values of the page's metrics, which Observatory's Connections dashboard filters on. Every attribute is one
 * of these, with `other` where the set can grow, so a series never becomes one per machine, request or reason text.
 */

export type LinkPath = 'local' | 'lan' | 'direct' | 'turn';
export type LinkOutcome = 'ok' | 'failed';

/*
 * Why the transport opens a new link: the open one dropped, an attempt failed, the machine refused it at the protocol
 * check or did not answer it, its address would not resolve, or something asked for a new one (a switch of route).
 */
export const RECONNECT_REASONS = ['dropped', 'failed', 'refused', 'timeout', 'address', 'switch', 'other'] as const;
export type ReconnectReason = (typeof RECONNECT_REASONS)[number];

// The part of a request type before its dot. A test holds this against `REQUEST_SCHEMAS`, so a new area is a choice.
export const REQUEST_AREAS = [
    'accounts',
    'agent',
    'archive',
    'auth',
    'browser',
    'bytes',
    'chat',
    'computer',
    'database',
    'device',
    'diagram',
    'direct',
    'drawing',
    'endpoint',
    'fs',
    'git',
    'language',
    'launch',
    'launches',
    'nanogpt',
    'ondevice',
    'peer',
    'plan',
    'presence',
    'processes',
    'project',
    'provenance',
    'provider',
    'push',
    'remote',
    'secret',
    'server',
    'session',
    'skills',
    'snooze',
    'task',
    'ui',
    'usage',
    'voice'
] as const;
export type RequestArea = (typeof REQUEST_AREAS)[number] | 'other';

const AREAS: ReadonlySet<string> = new Set(REQUEST_AREAS);

export function requestAreaOf(type: string): RequestArea {
    const area = type.split('.', 1)[0] ?? '';
    return AREAS.has(area) ? (area as RequestArea) : 'other';
}

/*
 * The path of a link as it opened, or tried to: this machine's own socket, the local network or the broker for a
 * direct channel, and `turn` once a direct channel runs through a relay.
 */
export function linkPathOf(link: { socket: boolean; relayed: boolean; signaled: SignalRoute | null }): LinkPath {
    if (link.socket) {
        return 'local';
    }
    if (link.relayed) {
        return 'turn';
    }
    return link.signaled === 'lan' ? 'lan' : 'direct';
}

/* The page's metrics, each with exactly the attributes the dashboard draws a line for; none has another. */
export type PageMetric =
    | { kind: 'distribution'; name: 'link.connect'; value: number; attributes: { path: LinkPath; outcome: LinkOutcome } }
    | { kind: 'count'; name: 'link.reconnect'; attributes: { reason: ReconnectReason } }
    | { kind: 'distribution'; name: 'request.duration'; value: number; attributes: { area: RequestArea } }
    | { kind: 'distribution'; name: 'workspace.load'; value: number; attributes: Record<string, never> };

/* A link transport's measurements as metrics; `socket` says whether this transport's links are this machine's own socket. */
export function linkMetrics(record: (metric: PageMetric) => void, socket: () => boolean): LinkMeter {
    return {
        connected: (link, outcome, ms) =>
            record({
                kind: 'distribution',
                name: 'link.connect',
                value: Math.max(0, ms),
                attributes: { path: linkPathOf({ ...link, socket: socket() }), outcome }
            }),
        reconnecting: (reason) => record({ kind: 'count', name: 'link.reconnect', attributes: { reason } }),
        answered: (type: RequestType, ms) =>
            record({ kind: 'distribution', name: 'request.duration', value: Math.max(0, ms), attributes: { area: requestAreaOf(type) } })
    };
}

export function workspaceLoadMetric(ms: number): PageMetric {
    return { kind: 'distribution', name: 'workspace.load', value: Math.max(0, ms), attributes: {} };
}
