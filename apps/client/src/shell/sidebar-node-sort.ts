import { labelCollator } from '@adecore/ui/format';
import type { SidebarNode } from './sidebar-rows';

/* How the sidebar lists the nodes under an open canvas. The canvas itself never changes with it. */
export const NODE_SORTS = ['canvas', 'name', 'kind', 'status'] as const;
export type NodeSort = (typeof NODE_SORTS)[number];

/* The order within one kind or one status. A canvas adds a node at its end, so its order is the age of the nodes. */
export const NODE_SORT_THENS = ['newest', 'oldest', 'name'] as const;
export type NodeSortThen = (typeof NODE_SORT_THENS)[number];

export function nodeSortFrom(value: unknown): NodeSort {
    return NODE_SORTS.find((sort) => sort === value) ?? 'canvas';
}

export function nodeSortThenFrom(value: unknown): NodeSortThen {
    return NODE_SORT_THENS.find((then) => then === value) ?? 'newest';
}

/* Whether a sort has groups to order within; by name or as on the canvas there is nothing left to choose. */
export function sortHasGroups(sort: NodeSort): boolean {
    return sort === 'kind' || sort === 'status';
}

/* Sessions first, then what a person opens beside them; an agent in a terminal is a session as much as a chat. */
function kindRank(node: SidebarNode): number {
    if (node.kind === 'chat' || (node.kind === 'terminal' && node.provider !== null)) {
        return 0;
    }
    switch (node.kind) {
        case 'terminal':
            return 1;
        case 'browser':
            return 2;
        case 'design':
            return 3;
        case 'device':
            return 4;
        default:
            return 5;
    }
}

/*
 * What is happening first: a node that waits on a person, one at work, a turn that ended unseen, one
 * that stopped or failed, and then the rest. Another project's rows cannot tell work apart, so their
 * running status counts as work.
 */
function statusRank(node: SidebarNode): number {
    if (node.status === 'needs-you') {
        return 0;
    }
    const working = node.work === undefined ? node.status === 'running' : node.work !== null;
    if (working) {
        return 1;
    }
    if (node.finished) {
        return 2;
    }
    return node.status === 'error' || node.status === 'exited' ? 3 : 4;
}

/* The nodes of one canvas in the order a person picked, each group in the order of `then`; ties keep the canvas order. */
export function sortNodes(nodes: readonly SidebarNode[], sort: NodeSort, then: NodeSortThen): readonly SidebarNode[] {
    if (sort === 'canvas' || nodes.length < 2) {
        return nodes;
    }
    const collator = labelCollator();
    const byName = (one: SidebarNode, other: SidebarNode) => collator.compare(one.title, other.title);
    const indexed = nodes.map((node, index) => ({ node, index }));
    const within = (one: (typeof indexed)[number], other: (typeof indexed)[number]): number => {
        if (then === 'name') {
            return byName(one.node, other.node) || one.index - other.index;
        }
        return then === 'newest' ? other.index - one.index : one.index - other.index;
    };
    const rank = sort === 'kind' ? kindRank : sort === 'status' ? statusRank : null;
    indexed.sort((one, other) => {
        if (rank === null) {
            return byName(one.node, other.node) || one.index - other.index;
        }
        return rank(one.node) - rank(other.node) || within(one, other);
    });
    return indexed.map(({ node }) => node);
}
