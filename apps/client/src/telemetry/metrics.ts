import type { SignalRoute } from '@/transport-api/transport';

/* How long links take to open or fail, why a new one opens, and how long a request waits for its answer: for the page's metrics. */
export interface LinkMeter {
    /* From the start of an attempt until the protocol check passed, or until the attempt failed. */
    connected(link: { relayed: boolean; signaled: SignalRoute | null }, outcome: LinkOutcome, ms: number): void;
    reconnecting(reason: ReconnectReason): void;
    /* A request the link answered, measured only where its wait is the link's (`measuredRequest`), over the link it went. */
    answered(link: { relayed: boolean; signaled: SignalRoute | null }, ms: number): void;
}

/*
 * The fixed values of the page's metrics, which Observatory's Connections dashboard filters on. Every attribute is one
 * of these, with `other` where the set can grow, so a series never becomes one per machine, request or reason text.
 */

type LinkPath = 'local' | 'lan' | 'direct' | 'turn';
type LinkOutcome = 'ok' | 'failed';

/*
 * Why the transport opens a new link: the open one dropped, an attempt failed, the machine refused it at the protocol
 * check or did not answer it, its address would not resolve, or something asked for a new one (a switch of route).
 */
const RECONNECT_REASONS = ['dropped', 'failed', 'refused', 'timeout', 'address', 'switch', 'other'] as const;
export type ReconnectReason = (typeof RECONNECT_REASONS)[number];

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
    | { kind: 'distribution'; name: 'request.duration'; value: number; attributes: { path: LinkPath } }
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
        // The daemon measures the handling per area itself; what only a client sees is the round trip over its link.
        answered: (link, ms) =>
            record({ kind: 'distribution', name: 'request.duration', value: Math.max(0, ms), attributes: { path: linkPathOf({ ...link, socket: socket() }) } })
    };
}

export function workspaceLoadMetric(ms: number): PageMetric {
    return { kind: 'distribution', name: 'workspace.load', value: Math.max(0, ms), attributes: {} };
}
