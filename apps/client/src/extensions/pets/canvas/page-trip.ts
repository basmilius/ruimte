import { isChatNode } from '@ruimte/contracts';
import { lineMeaning } from '@/canvas/edge-look';
import type { EdgeLine } from '@/canvas/edge-lines';
import type { CanvasNode } from '@/state/canvas';

/* How long a page goes without an ask before the pet walks home. */
export const TRIP_QUIET_MS = 5_000;

/* How long a pet stays on a page before it moves on, so an agent switching between two pages does not send it running back and forth. */
export const TRIP_MIN_STAY_MS = 4_000;

/* Where a pet is: on a page an agent works in, since a moment; `null` is on its own node. */
export interface PageVisit {
    pageId: string;
    since: number;
}

function readsLines(node: CanvasNode | undefined): boolean {
    return node !== undefined && (isChatNode(node) || node.kind === 'terminal');
}

/*
 * The places an agent's pet may walk to: a page or a device at the other end of a target line from the
 * agent's node, the line the canvas draws with its point at the node being worked on. Only lines whose
 * ends both show, so the pet never walks into a collapsed group.
 */
export function tripPagesOf(agentId: string, lines: readonly EdgeLine[], nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>): string[] {
    const reads = (id: string): boolean => readsLines(nodes[id]);
    const driven = (id: string): boolean => nodes[id]?.kind === 'browser' || nodes[id]?.kind === 'device';
    const pages: string[] = [];

    for (const line of lines) {
        const { from, to } = line.edge;
        const page = from === agentId ? to : to === agentId ? from : null;

        if (page === null || !driven(page) || hidden.has(page) || hidden.has(agentId)) {
            continue;
        }

        if (lineMeaning(line, reads, driven).role === 'target' && !pages.includes(page)) {
            pages.push(page);
        }
    }

    return pages;
}

/*
 * Where a pet goes next, from when each of its pages was last asked something. It sets off at the first
 * ask, stays while the asks come, and walks home after a quiet spell. It moves on to another page or home
 * only once it stayed a while. A pet that waits on you is always home, where the question is answered.
 */
export function nextVisit(current: PageVisit | null, asks: ReadonlyMap<string, number>, now: number, waiting: boolean): PageVisit | null {
    if (waiting) {
        return null;
    }

    let latest: string | null = null;
    let latestAt = -Infinity;

    for (const [pageId, at] of asks) {
        if (now - at < TRIP_QUIET_MS && at > latestAt) {
            latest = pageId;
            latestAt = at;
        }
    }

    if (current === null) {
        return latest === null ? null : { pageId: latest, since: now };
    }

    if (now - current.since < TRIP_MIN_STAY_MS || latest === current.pageId) {
        return current;
    }

    return latest === null ? null : { pageId: latest, since: now };
}
