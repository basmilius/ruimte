import type { AgentKind, AgentStatus, NodeKind, ProjectIconChoice, ProjectViewKind } from '@ruimte/contracts';
import type { SidebarScope } from '@/state/settings';

export interface SidebarNode {
    id: string;
    title: string;
    kind: NodeKind;
    /* The CLI behind a chat or an agent terminal, whose mark the row wears instead of the kind's. */
    provider: AgentKind | null;
    status: AgentStatus | null;
    /* A chat with something typed and never sent. */
    draft: boolean;
}

export interface SidebarView {
    id: string;
    /* Empty for a separator, which is a bare line with nothing on it. */
    name: string;
    kind: ProjectViewKind;
    /* What a person picked for it, which outranks the mark of its kind. */
    icon: ProjectIconChoice | null;
    /* The CLI a chat or terminal view runs, the way a node carries one. */
    provider: AgentKind | null;
    /* A file view's file, whose own name gives the row its icon. Null for every other kind. */
    path: string | null;
    /* What sits on the canvas. A view that is not a canvas lists nothing: it is one node itself. */
    nodes: SidebarNode[];
    /* The node a standalone view is, so its row carries the status and the draft dot of that node. */
    self: SidebarNode | null;
}

export interface SidebarViewRow {
    type: 'view';
    rowId: string;
    /* The workspace the view lives in, so a click acts on that project and not on the focused one. */
    workspaceId: string;
    view: SidebarView;
    /* Where the view sits in the project's list, which is what a drop between two rows writes back. */
    index: number;
    active: boolean;
    expandable: boolean;
    expanded: boolean;
    /* The heaviest status of the nodes it holds, so a folded canvas still says something is up. */
    status: AgentStatus | null;
    /* A standalone chat with an unsent prompt; a canvas keeps that dot on the node's own row. */
    draft: boolean;
    count: number;
}

export interface SidebarNodeRow {
    type: 'node';
    rowId: string;
    workspaceId: string;
    node: SidebarNode;
    viewId: string;
    /* Where the node lives, named only on a row that stands outside its own view. */
    viewName: string | null;
    /* Which project it is in, named only where the list holds more than one of them. */
    projectName: string | null;
}

export type SidebarRow = SidebarViewRow | SidebarNodeRow;

export interface SidebarSection {
    /* Unique across the list: the views of two workspaces are two sections. */
    id: string;
    kind: 'needs-you' | 'views';
    /* Null where the list needs no heading: with one project on screen, its views are the only list there is. */
    label: string | null;
    /* Whose views these are; null for the waiting list, which spans every project in scope. */
    workspaceId: string | null;
    rows: SidebarRow[];
    /* How many views the list holds, which is the gap a drop under the last row lands in. */
    viewCount: number;
}

/* One open project as the sidebar reads it. */
export interface SidebarWorkspace {
    id: string;
    /* What the project is called, which is the heading over its views in window scope. */
    name: string;
    /* In project order, which is the order of the file, so every machine reads the same list. */
    views: SidebarView[];
    activeViewId: string | null;
    /* The workspace the keyboard and the menus mean; in project scope it is the only one listed. */
    focused: boolean;
}

export interface SidebarInput {
    workspaces: SidebarWorkspace[];
    scope: SidebarScope;
    expandedIds: ReadonlySet<string>;
}

/* Groups, notes and drawings are frames, paper and files; the list is about what runs. */
export const isSessionKind = (kind: NodeKind): boolean => kind === 'terminal' || kind === 'chat' || kind === 'browser';

const WEIGHT: Record<AgentStatus, number> = { 'needs-you': 3, error: 2, exited: 2, running: 1, idle: 0 };

export const heaviestStatus = (nodes: readonly SidebarNode[]): AgentStatus | null =>
    nodes.reduce<AgentStatus | null>((heaviest, node) => {
        if (!node.status) {
            return heaviest;
        }
        return heaviest === null || WEIGHT[node.status] > WEIGHT[heaviest] ? node.status : heaviest;
    }, null);

/* Which projects the list is about. Project scope is the workspace you are working in, and before
   one has the focus it is the first there is, which is the only one until panes exist. */
const inScope = (workspaces: readonly SidebarWorkspace[], scope: SidebarScope): SidebarWorkspace[] => {
    if (scope === 'window') {
        return [...workspaces];
    }
    const focused = workspaces.find((workspace) => workspace.focused) ?? workspaces[0];
    return focused ? [focused] : [];
};

/*
 * The sidebar as one list of rows: what waits for you across the projects in scope first, then the
 * views of each in the order its file names them, with the nodes of an open canvas under it. The
 * status grouping of the old flat list is gone: the order is the project's, the dock keeps the
 * counters.
 */
export const buildSidebar = ({ workspaces, scope, expandedIds }: SidebarInput): SidebarSection[] => {
    const listed = inScope(workspaces, scope);
    const sections: SidebarSection[] = [];
    const waiting: SidebarRow[] = [];
    for (const workspace of listed) {
        for (const view of workspace.views) {
            for (const node of [...view.nodes, ...(view.self ? [view.self] : [])]) {
                if (node.status === 'needs-you') {
                    waiting.push({
                        type: 'node',
                        rowId: `needs:${workspace.id}:${node.id}`,
                        workspaceId: workspace.id,
                        node,
                        viewId: view.id,
                        viewName: view.name,
                        projectName: listed.length > 1 ? workspace.name : null
                    });
                }
            }
        }
    }
    if (waiting.length > 0) {
        sections.push({ id: 'needs-you', kind: 'needs-you', label: 'Needs you', workspaceId: null, rows: waiting, viewCount: 0 });
    }

    for (const workspace of listed) {
        const rows: SidebarRow[] = [];
        for (const [index, view] of workspace.views.entries()) {
            const expandable = view.kind === 'canvas' && view.nodes.length > 0;
            const expanded = expandable && expandedIds.has(view.id);
            rows.push({
                type: 'view',
                rowId: `view:${workspace.id}:${view.id}`,
                workspaceId: workspace.id,
                view,
                index,
                active: view.id === workspace.activeViewId,
                expandable,
                expanded,
                status: view.self ? view.self.status : heaviestStatus(view.nodes),
                draft: view.self?.draft ?? false,
                count: view.nodes.length
            });
            if (!expanded) {
                continue;
            }
            for (const node of view.nodes) {
                rows.push({
                    type: 'node',
                    rowId: `node:${workspace.id}:${view.id}:${node.id}`,
                    workspaceId: workspace.id,
                    node,
                    viewId: view.id,
                    viewName: null,
                    projectName: null
                });
            }
        }
        sections.push({
            id: `views:${workspace.id}`,
            kind: 'views',
            label: scope === 'window' ? workspace.name : null,
            workspaceId: workspace.id,
            rows,
            viewCount: workspace.views.length
        });
    }
    return sections;
};

/* The ids in the order the eye reads them, which is the order Up and Down have to walk. */
export const rowOrder = (sections: readonly SidebarSection[]): string[] => sections.flatMap((section) => section.rows.map((row) => row.rowId));

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
