/* How the sidebar lists the nodes under an open canvas. The canvas itself never changes with it. */
export const NODE_SORTS = ['canvas', 'recent', 'name', 'kind', 'status'] as const;
export type NodeSort = (typeof NODE_SORTS)[number];

/* The order within one kind or one status. */
export const NODE_SORT_THENS = ['recent', 'least-recent', 'name'] as const;
export type NodeSortThen = (typeof NODE_SORT_THENS)[number];

export function nodeSortFrom(value: unknown): NodeSort {
    return NODE_SORTS.find((sort) => sort === value) ?? 'canvas';
}

export function nodeSortThenFrom(value: unknown): NodeSortThen {
    return NODE_SORT_THENS.find((then) => then === value) ?? 'recent';
}

/* Whether a sort has groups to order within; the others leave nothing to choose. */
export function sortHasGroups(sort: NodeSort): boolean {
    return sort === 'kind' || sort === 'status';
}
