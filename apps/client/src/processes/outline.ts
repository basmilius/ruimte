import type { ProcessGroup, ProjectSidebarView, ProjectSummary } from '@ruimte/contracts';
import { diskOf, groupTitle } from './format';

export interface Totals {
    /* Percent of one core, as the groups count it. */
    cpu: number | null;
    memory: number | null;
    /* Read and written together, bytes per second. */
    disk: number | null;
}

export interface OutlineNode {
    kind: 'node';
    /* The node's id, or the group's for a group no listed node stands for. */
    id: string;
    title: string;
    /* What the row wears at its left edge: the sidebar's node, or the group's kind for a group without one. */
    glyph: { node: NonNullable<ProjectSidebarView['self']> } | { group: ProcessGroup['kind'] };
    groups: ProcessGroup[];
    totals: Totals;
}

export interface OutlineView {
    kind: 'view';
    id: string;
    view: ProjectSidebarView;
    nodes: OutlineNode[];
    totals: Totals;
}

export interface OutlineProject {
    /* The project's id, or null for Ruimte itself: the app, the daemon and what no project places. */
    projectId: string | null;
    summary: ProjectSummary | null;
    items: (OutlineView | OutlineNode)[];
    totals: Totals;
}

export interface OutlineSource {
    summary: ProjectSummary;
    /* In sidebar order; null while the machine has not said what the project holds. */
    views: readonly ProjectSidebarView[] | null;
}

function add(before: number | null, value: number | null): number | null {
    return value === null ? before : (before ?? 0) + value;
}

export function totalsOf(rows: readonly { cpu: number | null; memory: number | null; diskRead: number | null; diskWrite: number | null }[]): Totals {
    return rows.reduce<Totals>((sum, row) => ({ cpu: add(sum.cpu, row.cpu), memory: add(sum.memory, row.memory), disk: add(sum.disk, diskOf(row)) }), {
        cpu: null,
        memory: null,
        disk: null
    });
}

function sumOf(items: readonly { totals: Totals }[]): Totals {
    return items.reduce<Totals>(
        (sum, item) => ({ cpu: add(sum.cpu, item.totals.cpu), memory: add(sum.memory, item.totals.memory), disk: add(sum.disk, item.totals.disk) }),
        { cpu: null, memory: null, disk: null }
    );
}

/*
 * The panel's list: the projects in the order given, each with its views and nodes in sidebar order,
 * then Ruimte itself. Only what has processes is listed. A group no listed node stands for, such as a
 * launch or a chat nobody wrote in yet, follows its project's views; one no project places joins Ruimte.
 */
export function processOutline(groups: readonly ProcessGroup[], sources: readonly OutlineSource[], titles: ReadonlyMap<string, string>): OutlineProject[] {
    const byNode = new Map<string, ProcessGroup[]>();
    const placed = new Set<string>();

    for (const group of groups) {
        if (group.nodeId !== null && (group.kind === 'terminal' || group.kind === 'chat') && group.label === undefined) {
            byNode.set(group.nodeId, [...(byNode.get(group.nodeId) ?? []), group]);
        }
    }

    const loose = (group: ProcessGroup): OutlineNode => {
        const { title } = groupTitle(group, titles);
        return { kind: 'node', id: group.id, title, glyph: { group: group.kind }, groups: [group], totals: totalsOf([group]) };
    };

    const nodeOf = (node: NonNullable<ProjectSidebarView['self']>): OutlineNode | null => {
        const own = [node.id, ...(node.chats ?? [])].flatMap((id) => byNode.get(id) ?? []);

        if (own.length === 0) {
            return null;
        }

        for (const group of own) {
            placed.add(group.id);
        }

        return {
            kind: 'node',
            id: node.id,
            title: titles.get(node.id) ?? node.title,
            glyph: { node },
            groups: own,
            totals: totalsOf(own)
        };
    };

    const projects: OutlineProject[] = [];

    for (const { summary, views } of sources) {
        const items: (OutlineView | OutlineNode)[] = [];

        // Sidebar rows, which list a canvas's nodes already, so they are no document view to read through `nodesOfView`.
        for (const row of views ?? []) {
            if (row.self !== null) {
                const node = nodeOf(row.self);

                if (node !== null) {
                    items.push(node);
                }

                continue;
            }

            const nodes = row.nodes.flatMap((entry) => nodeOf(entry) ?? []);

            if (nodes.length > 0) {
                items.push({ kind: 'view', id: row.id, view: row, nodes, totals: sumOf(nodes) });
            }
        }

        for (const group of groups) {
            if (!placed.has(group.id) && group.projectId === summary.projectId && group.kind !== 'app' && group.kind !== 'daemon') {
                placed.add(group.id);
                items.push(loose(group));
            }
        }

        if (items.length > 0) {
            projects.push({ projectId: summary.projectId, summary, items, totals: sumOf(items) });
        }
    }

    const rank = (group: ProcessGroup): number => (group.kind === 'app' ? 0 : group.kind === 'daemon' ? 1 : 2);
    const own = groups
        .filter((group) => !placed.has(group.id) && group.kind !== 'other')
        .sort((a, b) => rank(a) - rank(b))
        .map(loose);

    if (own.length > 0) {
        projects.push({ projectId: null, summary: null, items: own, totals: sumOf(own) });
    }

    return projects;
}
