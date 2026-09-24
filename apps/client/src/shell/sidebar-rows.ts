import i18next from 'i18next';
import type { SidebarTarget } from './sidebar-target';
import type { ProjectSummary } from '@ruimte/contracts';
import type { AgentKind, AgentStatus, CanvasNodeKind, NodeTitleSource, ProjectIconChoice, ProjectViewKind, Task } from '@ruimte/contracts';

export interface SidebarNode {
    id: string;
    title: string;
    titleSource?: NodeTitleSource;
    kind: CanvasNodeKind;
    /* The CLI behind a chat or an agent terminal, whose mark the row wears instead of the kind's. */
    provider: AgentKind | null;
    status: AgentStatus | null;
    /* A chat with something typed and never sent. */
    draft: boolean;
    /* The machine warns about the processes of this node. */
    alert?: boolean;
    /* Its turn ended while nobody was looking, and nobody has looked since. */
    finished?: boolean;
    /* The task another agent opened it with. */
    task?: Task | null;
    /* When a person's snooze runs out, while it holds: the node waits outside "Needs you" until then. */
    snoozedUntil?: number | null;
}

export interface SidebarView {
    id: string;
    /* Empty for a separator, which is a bare line with nothing on it; a subheader is its text alone. */
    name: string;
    titleSource?: NodeTitleSource;
    kind: ProjectViewKind;
    /* What a person picked for it, which outranks the mark of its kind. */
    icon: ProjectIconChoice | null;
    /* The CLI a chat or terminal view runs, the way a node carries one. */
    provider: AgentKind | null;
    /* A file view's file, whose own name gives the row its icon. Null for every other kind. */
    path: string | null;
    /* Whether this view lives in the shared file, which is the one a team commits. */
    shared: boolean;
    /* What sits on the canvas. A view that is not a canvas lists nothing: it is one node itself. */
    nodes: SidebarNode[];
    /* The node a standalone view is, so its row carries the status and the draft dot of that node. */
    self: SidebarNode | null;
}

export interface SidebarViewRow {
    target?: SidebarTarget;
    type: 'view';
    rowId: string;
    view: SidebarView;
    /* Where the view sits in the project's list, which is what a drop between two rows writes back. */
    index: number;
    active: boolean;
    /* Standing in a cell beside the focused one. Not active, but not closed either, and a row that
       said nothing would read as closed the moment you put a view next to the one you were on. */
    beside: boolean;
    expandable: boolean;
    expanded: boolean;
    /* The heaviest status of the nodes it holds, so a folded canvas still says something is up. */
    status: AgentStatus | null;
    /* A standalone chat with an unsent prompt; a canvas keeps that dot on the node's own row. */
    draft: boolean;
    /* A heading stands right under this row. Only ever true on a separator, which then gives up the
       room under its line: a rule that closes a group and the heading that opens the next are one
       thing, and the space between them should say so. */
    headingBelow: boolean;
}

export interface SidebarNodeRow {
    target?: SidebarTarget;
    location?: string;
    type: 'node';
    rowId: string;
    node: SidebarNode;
    viewId: string;
    /* Where the node lives, named only on a row that stands outside its own view. */
    viewName: string | null;
}

export type SidebarRow = SidebarViewRow | SidebarNodeRow;

export interface SidebarSection {
    group?: SidebarGroup;
    id: string;
    kind: 'needs-you' | 'views';
    /* Null for the list of views, which is the only list of its kind and needs no heading. */
    label: string | null;
    rows: SidebarRow[];
    /* How many views the list holds, which is the gap a drop under the last row lands in. */
    viewCount: number;
}

/* The open project as the sidebar reads it. */
export interface SidebarProject {
    /* In project order, which is the order of the file, so every machine reads the same list. */
    views: SidebarView[];
    activeViewId: string | null;
    /* Every view the grid has on screen, the active one among them. */
    openViewIds: readonly string[];
}

export interface SidebarInput {
    project: SidebarProject;
    expandedIds: ReadonlySet<string>;
}

/* Groups, notes and drawings are frames, paper and files; the list is about what runs. */
export const isSessionKind = (kind: CanvasNodeKind): boolean => kind === 'terminal' || kind === 'chat' || kind === 'browser' || kind === 'device';

const WEIGHT: Record<AgentStatus, number> = { 'needs-you': 3, error: 2, exited: 2, running: 1, idle: 0 };

export const heaviestStatus = (nodes: readonly SidebarNode[]): AgentStatus | null =>
    nodes.reduce<AgentStatus | null>((heaviest, node) => {
        if (!node.status) {
            return heaviest;
        }
        return heaviest === null || WEIGHT[node.status] > WEIGHT[heaviest] ? node.status : heaviest;
    }, null);

/* Whether a node belongs in "Needs you": waiting, and not put aside for now. */
export const waitsOnYou = (node: SidebarNode): boolean => node.status === 'needs-you' && !node.snoozedUntil;

/*
 * The sidebar as one list of rows: what waits for you first, then the views in the order the
 * project file names them, with the nodes of an open canvas under it. The
 * status grouping of the old flat list is gone: the order is the project's, the dock keeps the
 * counters.
 */
export const buildSidebar = ({ project, expandedIds }: SidebarInput): SidebarSection[] => {
    const sections: SidebarSection[] = [];
    const waiting: SidebarRow[] = [];
    for (const view of project.views) {
        for (const node of [...view.nodes, ...(view.self ? [view.self] : [])]) {
            if (waitsOnYou(node)) {
                waiting.push({ type: 'node', rowId: `needs:${node.id}`, node, viewId: view.id, viewName: view.name });
            }
        }
    }
    if (waiting.length > 0) {
        sections.push({ id: 'needs-you', kind: 'needs-you', label: i18next.t('shell:sidebar.needsYou'), rows: waiting, viewCount: 0 });
    }

    const rows: SidebarRow[] = [];
    for (const [index, view] of project.views.entries()) {
        const expandable = view.kind === 'canvas' && view.nodes.length > 0;
        const expanded = expandable && expandedIds.has(view.id);
        rows.push({
            type: 'view',
            rowId: `view:${view.id}`,
            view,
            index,
            active: view.id === project.activeViewId,
            beside: view.id !== project.activeViewId && project.openViewIds.includes(view.id),
            expandable,
            expanded,
            status: view.self ? view.self.status : heaviestStatus(view.nodes),
            draft: view.self?.draft ?? false,
            headingBelow: view.kind === 'separator' && project.views[index + 1]?.kind === 'subheader'
        });
        if (!expanded) {
            continue;
        }
        for (const node of view.nodes) {
            rows.push({ type: 'node', rowId: `node:${view.id}:${node.id}`, node, viewId: view.id, viewName: null });
        }
    }
    sections.push({ id: 'views', kind: 'views', label: null, rows, viewCount: project.views.length });
    return sections;
};

/* The ids in the order the eye reads them, which is the order Up and Down have to walk. */
export const rowOrder = (sections: readonly SidebarSection[]): string[] =>
    sections.flatMap((section) => [...(section.group ? [`project:${section.id}`] : []), ...section.rows.map((row) => row.rowId)]);

/* The row an arrow key lands on. Without a row to move from, Down starts at the top and Up at the
   bottom; at either end it stays put, so a held key never wraps around behind your back. */
export const rowAfterArrow = (order: string[], current: string | null, delta: -1 | 1): string | null => {
    if (order.length === 0) {
        return null;
    }
    const at = current === null ? -1 : order.indexOf(current);
    if (at === -1) {
        return delta === 1 ? order[0]! : order[order.length - 1]!;
    }
    return order[Math.min(order.length - 1, Math.max(0, at + delta))] ?? null;
};

export interface SidebarGroup {
    key: string;
    endpointId: string;
    summary: ProjectSummary;
    machineLabel: string;
    project: SidebarProject;
    active: boolean;
    collapsed: boolean;
    expandedIds: ReadonlySet<string>;
    state: 'ready' | 'loading' | 'offline' | 'error' | 'unsupported';
}

export const buildCombinedSidebar = (groups: readonly SidebarGroup[]): SidebarSection[] => {
    const waiting: SidebarRow[] = [];
    const sections: SidebarSection[] = [];
    for (const group of groups) {
        const own = buildSidebar({ project: group.project, expandedIds: group.expandedIds });
        const qualify = (row: SidebarRow): SidebarRow => ({
            ...row,
            rowId: `${group.key}:${row.rowId}`,
            target: {
                endpointId: group.endpointId,
                projectId: group.summary.projectId,
                viewId: row.type === 'view' ? row.view.id : row.viewId,
                ...(row.type === 'node' ? { nodeId: row.node.id } : {})
            },
            ...(row.type === 'node' && row.viewName !== null ? { location: `${group.summary.name} · ${row.viewName} · ${group.machineLabel}` } : {})
        });
        if (group.state === 'ready') {
            const seen = new Set<string>();
            for (const row of own.find((section) => section.kind === 'needs-you')?.rows ?? []) {
                if (row.type !== 'node' || seen.has(row.node.id)) continue;
                seen.add(row.node.id);
                waiting.push(qualify(row));
            }
        }
        const views = own.find((section) => section.kind === 'views')!;
        sections.push({ ...views, id: group.key, group, rows: group.collapsed ? [] : views.rows.map(qualify) });
    }
    return [
        ...(waiting.length ? [{ id: 'needs-you', kind: 'needs-you' as const, label: i18next.t('shell:sidebar.needsYou'), rows: waiting, viewCount: 0 }] : []),
        ...sections
    ];
};
