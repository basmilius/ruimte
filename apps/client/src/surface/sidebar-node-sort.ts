import { labelCollator } from '@adecore/ui/format';
import type { NodeSort, NodeSortThen } from '@/canvas-model/node-sort';
import { isSessionKind, type SessionKind, type SidebarNode } from './sidebar-rows';

/* Sessions first, then what a person opens beside them; an agent in a terminal is a session as much as a chat. */
const KIND_RANK: Record<SessionKind, number> = { chat: 0, terminal: 1, browser: 2, design: 3, device: 4 };
const SESSION_KIND_COUNT = Object.keys(KIND_RANK).length;

function kindRank(node: SidebarNode): number {
    if (node.kind === 'terminal' && node.provider !== null) {
        return KIND_RANK.chat;
    }

    return isSessionKind(node.kind) ? KIND_RANK[node.kind] : SESSION_KIND_COUNT;
}

/*
 * What asks for a person first, in the weight a folded canvas gives it (`heaviestStatus`): a node that
 * waits on you, one that stopped or failed, one at work, a turn that ended unseen, and then the rest.
 * A snoozed wait counts as the rest until it runs out, as it does under Needs you. Another project's
 * rows cannot tell work apart, so their running status counts as work.
 */
function statusRank(node: SidebarNode): number {
    if (node.status === 'needs-you') {
        return node.snoozedUntil ? 4 : 0;
    }

    if (node.status === 'error' || node.status === 'exited') {
        return 1;
    }

    const working = node.work === undefined ? node.status === 'running' : node.work !== null;

    if (working) {
        return 2;
    }

    return node.finished ? 3 : 4;
}

type Compare = (one: SidebarNode, other: SidebarNode) => number;

/* A node the machine keeps no activity for counts as the oldest. */
function byRecent(one: SidebarNode, other: SidebarNode): number {
    return (other.activity ?? -1) - (one.activity ?? -1);
}

function comparatorOf(sort: Exclude<NodeSort, 'canvas'>, then: NodeSortThen): Compare {
    const collator = labelCollator();

    const byName: Compare = (one, other) => collator.compare(one.title, other.title);

    if (sort === 'name') {
        return byName;
    }

    if (sort === 'recent') {
        return byRecent;
    }

    const rank = sort === 'kind' ? kindRank : statusRank;
    const within: Compare = then === 'name' ? byName : then === 'recent' ? byRecent : (one, other) => byRecent(other, one);

    return (one, other) => rank(one) - rank(other) || within(one, other);
}

/*
 * The nodes of one canvas in the order a person picked; ties keep the canvas order. Without a sort the
 * list is the canvas's own array, so nothing downstream sees a change. With `held`, the positions the
 * rows had when the pointer came in, nothing moves under the pointer and a node added since goes last.
 */
export function sortNodes(nodes: readonly SidebarNode[], sort: NodeSort, then: NodeSortThen, held?: ReadonlyMap<string, number>): readonly SidebarNode[] {
    if (sort === 'canvas' || nodes.length < 2) {
        return nodes;
    }

    const compare: Compare = held ? (one, other) => (held.get(one.id) ?? Infinity) - (held.get(other.id) ?? Infinity) : comparatorOf(sort, then);

    return nodes
        .map((node, index) => ({ node, index }))
        .sort((one, other) => compare(one.node, other.node) || one.index - other.index)
        .map(({ node }) => node);
}
