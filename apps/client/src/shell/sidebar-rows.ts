import i18next from 'i18next';
import type { SidebarTarget } from './sidebar-target';
import type { AgentWork } from '@/state/agent-work';
import type { AgentKind, AgentStatus, CanvasNodeKind, NodeTitleSource, ProjectIconChoice, ProjectSummary, ProjectViewKind, Task } from '@ruimte/contracts';

export interface SidebarNode {
    id: string;
    title: string;
    titleSource?: NodeTitleSource;
    kind: CanvasNodeKind;
    /* The CLI behind a chat or an agent terminal, whose mark the row wears instead of the kind's. */
    provider: AgentKind | null;
    status: AgentStatus | null;
    /* What its agent works on, which `running` alone does not say of a terminal. Unknown for another project's rows. */
    work?: AgentWork | null;
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
    /* The flag this person put on it, as a node accent name. */
    flag?: string;
    /* What sits on the canvas. A view that is not a canvas lists nothing: it is one node itself. */
    nodes: SidebarNode[];
    /* The node a standalone view is, so its row carries the status and the draft dot of that node. */
    self: SidebarNode | null;
    /* A chat nobody wrote in yet, which has no row until its first message, even while it is on screen. */
    hidden?: boolean;
}

export interface SidebarViewRow {
    target?: SidebarTarget;
    type: 'view';
    rowId: string;
    view: SidebarView;
    /* Where the view sits in the project's list, which is what a drop between two rows writes back. */
    index: number;
    active: boolean;
    /* Standing in a cell beside the focused one: not active, but not closed either. */
    beside: boolean;
    expandable: boolean;
    expanded: boolean;
    /* The heaviest status of the nodes it holds, so a folded canvas still says something is up. */
    status: AgentStatus | null;
    /* A standalone chat with an unsent prompt; a canvas keeps that dot on the node's own row. */
    draft: boolean;
    /* A separator with a heading right under it, which gives up the room under its line. */
    headingBelow: boolean;
}

export interface SidebarNodeRow {
    target?: SidebarTarget;
    type: 'node';
    rowId: string;
    node: SidebarNode;
    viewId: string;
    /* Where the node lives, named only on a row that stands outside its own view. */
    viewName: string | null;
}

export type SidebarRow = SidebarViewRow | SidebarNodeRow;

/* One project's share of "Needs you", under a heading with its name. */
export interface SidebarWaitingGroup {
    key: string;
    /* Null while the project on screen is the only one waiting. */
    label: string | null;
    rows: SidebarRow[];
}

export interface SidebarSection {
    group?: SidebarGroup;
    id: string;
    kind: 'needs-you' | 'views';
    /* Null for the list of views, which is the only list of its kind and needs no heading. */
    label: string | null;
    rows: SidebarRow[];
    /* How "Needs you" splits its rows over projects, in the order they are drawn. Absent on the list of views. */
    waiting?: SidebarWaitingGroup[];
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
export function isSessionKind(kind: CanvasNodeKind): boolean {
    return kind === 'terminal' || kind === 'chat' || kind === 'browser' || kind === 'device';
}

const WEIGHT: Record<AgentStatus, number> = { 'needs-you': 3, error: 2, exited: 2, running: 1, idle: 0 };

export function heaviestStatus(nodes: readonly SidebarNode[]): AgentStatus | null {
    return nodes.reduce<AgentStatus | null>((heaviest, node) => {
        if (!node.status) {
            return heaviest;
        }
        return heaviest === null || WEIGHT[node.status] > WEIGHT[heaviest] ? node.status : heaviest;
    }, null);
}

/* A turn speaks for a folded canvas before sub-agents that go on alone. */
export function heaviestWork(nodes: readonly SidebarNode[]): AgentWork | null {
    if (nodes.some((node) => node.work === 'turn')) {
        return 'turn';
    }
    return nodes.some((node) => node.work === 'delegating') ? 'delegating' : null;
}

/* Whether a node belongs in "Needs you": waiting, and not put aside for now. */
export function waitsOnYou(node: SidebarNode): boolean {
    return node.status === 'needs-you' && !node.snoozedUntil;
}

/* What waits for you first, then the views in project order, with the nodes of an open canvas under it. */
export function buildSidebar({ project, expandedIds }: SidebarInput): SidebarSection[] {
    const sections: SidebarSection[] = [];
    const waiting: SidebarRow[] = [];
    for (const view of project.views.filter((candidate) => !candidate.hidden)) {
        for (const node of [...view.nodes, ...(view.self ? [view.self] : [])]) {
            if (waitsOnYou(node)) {
                waiting.push({ type: 'node', rowId: `needs:${node.id}`, node, viewId: view.id, viewName: view.name });
            }
        }
    }
    if (waiting.length > 0) {
        sections.push(needsYou([{ key: 'current', label: null, rows: waiting }]));
    }

    const rows: SidebarRow[] = [];
    for (const [index, view] of project.views.entries()) {
        // Skipped rather than left out of the list, so every other row keeps its index in the file.
        if (view.hidden) {
            continue;
        }
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
}

/* The gap a dragged row would land in: above the row whose top half the pointer is in, and under the
   last one the end of the list. A row's index counts the views the list hides, so the end is too. */
export function gapIndex(rows: readonly { index: number; middle: number }[], y: number, viewCount: number): number {
    return rows.find((row) => y < row.middle)?.index ?? viewCount;
}

/* The ids in the order the eye reads them, which is the order Up and Down have to walk. */
export function rowOrder(sections: readonly SidebarSection[]): string[] {
    return sections.flatMap((section) => [...(section.group ? [`project:${section.id}`] : []), ...section.rows.map((row) => row.rowId)]);
}

/* The row an arrow key lands on. Without a row to move from, Down starts at the top and Up at the
   bottom; at either end it stays put, so a held key never wraps around behind your back. */
export function rowAfterArrow(order: string[], current: string | null, delta: -1 | 1): string | null {
    if (order.length === 0) {
        return null;
    }
    const at = current === null ? -1 : order.indexOf(current);
    if (at === -1) {
        return delta === 1 ? order[0]! : order[order.length - 1]!;
    }
    return order[Math.min(order.length - 1, Math.max(0, at + delta))] ?? null;
}

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

function needsYou(waiting: SidebarWaitingGroup[]): SidebarSection {
    return {
        id: 'needs-you',
        kind: 'needs-you',
        label: i18next.t('shell:sidebar.needsYou'),
        rows: waiting.flatMap((group) => group.rows),
        waiting,
        viewCount: 0
    };
}

/* A row of another project's list, keyed apart from the same ids on another machine and pointing at where it lives. */
function qualify(group: SidebarGroup, row: SidebarRow): SidebarRow {
    return {
        ...row,
        rowId: `${group.key}:${row.rowId}`,
        target: {
            endpointId: group.endpointId,
            projectId: group.summary.projectId,
            viewId: row.type === 'view' ? row.view.id : row.viewId,
            ...(row.type === 'node' ? { nodeId: row.node.id } : {})
        }
    };
}

function waitingIn(group: SidebarGroup): SidebarRow[] {
    const own = buildSidebar({ project: group.project, expandedIds: new Set() });
    const seen = new Set<string>();
    const rows: SidebarRow[] = [];
    for (const row of own.find((section) => section.kind === 'needs-you')?.rows ?? []) {
        if (row.type !== 'node' || seen.has(row.node.id)) {
            continue;
        }
        seen.add(row.node.id);
        rows.push(qualify(group, row));
    }
    return rows;
}

/*
 * "Needs you" over every project, one heading per project: the one on screen first, the others in
 * the sidebar's order. A project the machine could not read right now says nothing, since its
 * statuses are from before.
 */
export function needsYouSection(groups: readonly SidebarGroup[], onScreen?: readonly SidebarRow[]): SidebarSection | null {
    const waiting: (SidebarWaitingGroup & { group: SidebarGroup })[] = [];
    for (const group of [...groups.filter((group) => group.active), ...groups.filter((group) => !group.active)]) {
        if (group.state !== 'ready') {
            continue;
        }
        const rows = group.active && onScreen ? [...onScreen] : waitingIn(group);
        if (rows.length > 0) {
            waiting.push({ key: group.key, label: group.summary.name, rows, group });
        }
    }
    if (waiting.length === 0) {
        return null;
    }
    const machines = new Set(waiting.map(({ group }) => group.endpointId)).size;
    const alone = waiting.length === 1 && waiting[0]!.group.active;
    return needsYou(
        waiting.map(({ key, label, rows, group }) => ({
            key,
            label: alone ? null : machines > 1 ? `${label} · ${group.machineLabel}` : label,
            rows
        }))
    );
}

export function buildCombinedSidebar(groups: readonly SidebarGroup[]): SidebarSection[] {
    const sections: SidebarSection[] = [];
    for (const group of groups) {
        const views = buildSidebar({ project: group.project, expandedIds: group.expandedIds }).find((section) => section.kind === 'views')!;
        sections.push({ ...views, id: group.key, group, rows: group.collapsed ? [] : views.rows.map((row) => qualify(group, row)) });
    }
    const waiting = needsYouSection(groups);
    return waiting ? [waiting, ...sections] : sections;
}

/* The list of the project on screen, with "Needs you" drawn from every open project. The project on
   screen keeps its own rows, read live and revealed in place; until it is among the groups, the
   block keeps to what this window knows itself. */
export function buildSidebarEverywhere(input: SidebarInput, groups: readonly SidebarGroup[]): SidebarSection[] {
    const own = buildSidebar(input);
    if (!groups.some((group) => group.active)) {
        return own;
    }
    const views = own.filter((section) => section.kind !== 'needs-you');
    const waiting = needsYouSection(groups, own.find((section) => section.kind === 'needs-you')?.rows ?? []);
    return waiting ? [waiting, ...views] : views;
}
