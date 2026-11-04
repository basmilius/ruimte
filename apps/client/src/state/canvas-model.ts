import type {
    AgentKind,
    AgentStatus,
    DeviceReference,
    NodeSide,
    ProjectEdge,
    ProjectCanvasLine,
    ProjectLayout,
    ProjectNode,
    ProjectText,
    RuntimeMode,
    ViewLocks
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { textRect } from '@/canvas/edge-lines';
import { lineBounds } from '@/canvas/line-geometry';
import type { Point, Rect } from '@/canvas/math';
import type { CanvasPatch } from '@/project/merge';
import type { CanvasState } from '@/state/canvas';

export type CanvasSet = StoreApi<CanvasState>['setState'];
export type CanvasGet = () => CanvasState;

/* A node as stored in the project file, plus a status for kinds without a daemon-side one (browser). */
export interface CanvasNode extends ProjectNode {
    status?: AgentStatus;
}

export interface AddNodeOptions {
    /* The daemon id of the machine the node runs on, when it is not the one the project lives on. */
    machine?: string;
    title?: string;
    /* Browsers only: the page it opens on, instead of the default address. */
    url?: string;
    browserOwner?: string;
    /* Devices only: the portable simulator identity this machine resolves locally. */
    device?: DeviceReference;
    cwd?: string;
    command?: string;
    resume?: string;
    provider?: AgentKind;
    /* The account of that CLI on this machine; absent is its default account. */
    account?: string;
    /* Chats only: the CLI came from a menu, so the composer offers no other one. */
    providerFixed?: boolean;
    // Terminal agents only: the permission mode the CLI starts in.
    runtimeMode?: RuntimeMode;
    // Drawings only: the drawing view this node mirrors.
    viewId?: string;
    // Files only: the file it reads, relative to the project folder or absolute outside it.
    path?: string;
    // Chats and terminals: the GitHub issue the agent was started on.
    issue?: ProjectNode['issue'];
    // Artifacts only: what of this machine's Output it shows.
    artifact?: ProjectNode['artifact'];
    // Routines only: the routine of the project it shows.
    routine?: string;
}

/* A label on the canvas. Style belongs to the whole element; the text itself holds no runs. */
export type TextElement = ProjectText;

/* A line as the project file holds it, extra fields and all, since a shape of its own here would drop
   whatever a newer Ruimte wrote on an edge the moment this store handed the canvas back. */
export type Edge = ProjectEdge;

/* The ports a new line is held to, as far as the drag that drew it named them. */
export type EdgeSides = Pick<Edge, 'fromSide' | 'toSide'>;

/* The same two ports the other way round, so the line back is held where the line out is drawn. */
export function mirroredSides(sides: EdgeSides | undefined): EdgeSides {
    return {
        ...(sides?.toSide === undefined ? {} : { fromSide: sides.toSide }),
        ...(sides?.fromSide === undefined ? {} : { toSide: sides.fromSide })
    };
}

/*
 * An edge being drawn: from a node or text to wherever the pointer is, in world units. Started from
 * a port it lives as long as the drag; started from a menu (`aiming`) it waits for a click on a target.
 */
export interface LinkDraft {
    from: string;
    to: Point;
    aiming?: boolean;
    /* The port the drag started on, which the line it becomes keeps. */
    fromSide?: NodeSide;
    /* What the line would land on if it were let go here, so that node can say so. */
    over?: string;
}

// The height of a node frame's header; a collapsed group is its header only.
export const GROUP_HEADER_PX = 39;
/* A collapsed node other than a group, on the grid: its header between the frame's borders, which takes the place of the header's own line. */
export const COLLAPSED_NODE_PX = GROUP_HEADER_PX + 1;

export type Locks = ViewLocks;

/* What undo and redo restore: the placement of everything, never the camera or the selection. */
export interface Snapshot {
    nodes: Record<string, CanvasNode>;
    order: string[];
    texts: Record<string, TextElement>;
    lines?: Record<string, ProjectCanvasLine>;
    edges: Edge[];
    layouts: ProjectLayout[];
}

export const HISTORY_LIMIT = 100;

export interface GapMove {
    snapshot: Snapshot;
    origins: Record<string, Point>;
    carried: Record<string, string>;
    parents: { id: string; members: string[] }[];
    fixed: string[];
}

export function center(rect: Rect): Point {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function contains(rect: Rect, point: Point): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/* What one group holds: its remembered members when collapsed, else whatever has its center inside the frame. */
export function membersOf(
    group: CanvasNode,
    nodes: Record<string, CanvasNode>,
    texts: Record<string, TextElement>,
    lines: Record<string, ProjectCanvasLine> = {}
): string[] {
    if (group.collapsed) {
        return group.memberIds ?? [];
    }
    const members: string[] = [];
    for (const node of Object.values(nodes)) {
        if (node.id !== group.id && contains(group, center(node))) {
            members.push(node.id);
        }
    }
    for (const text of Object.values(texts)) {
        if (contains(group, text)) {
            members.push(text.id);
        }
    }
    for (const line of Object.values(lines)) {
        if (contains(group, center(lineBounds(line)))) {
            members.push(line.id);
        }
    }
    return members;
}

/* A group carries what sits inside it, and a group inside it carries its own members in turn. */
export function carriedByGroups(
    nodes: Record<string, CanvasNode>,
    texts: Record<string, TextElement>,
    selection: string[],
    lines: Record<string, ProjectCanvasLine> = {}
): Set<string> {
    const carried = new Set<string>();
    const visit = (groupId: string): void => {
        const group = nodes[groupId];
        if (!group || group.kind !== 'group') {
            return;
        }
        for (const id of membersOf(group, nodes, texts, lines)) {
            if (selection.includes(id) || carried.has(id)) {
                continue;
            }
            carried.add(id);
            visit(id);
        }
    };
    for (const id of selection) {
        visit(id);
    }
    return carried;
}

/* The frame of a node, a text or a line on the canvas; none for an id that is none of those. */
export function boundsOfElement(
    id: string,
    nodes: Record<string, CanvasNode>,
    texts: Record<string, TextElement>,
    lines: Record<string, ProjectCanvasLine>
): Rect[] {
    if (nodes[id]) {
        return [nodes[id]];
    }
    if (texts[id]) {
        return [textRect(texts[id])];
    }
    return lines[id] ? [lineBounds(lines[id])] : [];
}

export function hiddenIn(nodes: Record<string, CanvasNode>): Set<string> {
    const hidden = new Set<string>();
    for (const node of Object.values(nodes)) {
        if (node.kind === 'group' && node.collapsed) {
            for (const id of node.memberIds ?? []) {
                hidden.add(id);
            }
        }
    }
    return hidden;
}

// Ids double as daemon session ids and end up in a shared file, so they must not repeat across machines.
export function nextId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function snapshotOf(s: Pick<CanvasState, 'nodes' | 'order' | 'texts' | 'edges' | 'layouts' | 'lines'>): Snapshot {
    return {
        nodes: s.nodes,
        order: s.order,
        texts: s.texts,
        lines: s.lines,
        edges: s.edges,
        layouts: s.layouts
    };
}

/*
 * Takes another writer's additions and deletions into one step of the history, so an undo neither
 * brings back what they deleted nor takes away what they added. The fields of what the step already
 * holds stay as they are: an undo still puts a person's own move back. `patch` names only what is new
 * to this editor, since a node that is merely changed there may be one the step is from before.
 */
export function patchSnapshot(snapshot: Snapshot, patch: CanvasPatch): Snapshot {
    const lines = { ...snapshot.lines };
    for (const id of patch.removed.lines ?? []) {
        delete lines[id];
    }
    for (const line of patch.lines ?? []) {
        lines[line.id] ??= line;
    }
    const nodes = { ...snapshot.nodes };
    for (const id of patch.removed.nodes) {
        delete nodes[id];
    }
    const texts = { ...snapshot.texts };
    for (const id of patch.removed.texts) {
        delete texts[id];
    }
    const order = snapshot.order.filter((id) => nodes[id] !== undefined);
    for (const node of patch.nodes) {
        if (nodes[node.id] === undefined) {
            nodes[node.id] = node;
            order.push(node.id);
        }
    }
    for (const text of patch.texts) {
        texts[text.id] ??= text;
    }
    const removedEdges = new Set(patch.removed.edges);
    const holds = (id: string): boolean => nodes[id] !== undefined || texts[id] !== undefined;
    const edges = snapshot.edges.filter((edge) => !removedEdges.has(edge.id));
    const present = new Set(edges.map((edge) => edge.id));
    edges.push(...patch.edges.filter((edge) => !present.has(edge.id)));
    return { ...snapshot, nodes, order, texts, lines, edges: edges.filter((edge) => holds(edge.from) && holds(edge.to)) };
}

/* Remembers the placement before a change; called by every action that changes it. */
export function remember(s: CanvasState): Pick<CanvasState, 'past' | 'future'> {
    return { past: [...s.past.slice(-(HISTORY_LIMIT - 1)), snapshotOf(s)], future: [] };
}

/* The maximized node, while it is still on the canvas and not folded away in a group. */
export function maximizedNodeOf(s: Pick<CanvasState, 'maximizedId' | 'nodes' | 'hidden'>): string | null {
    return s.maximizedId !== null && s.nodes[s.maximizedId] !== undefined && !s.hidden.has(s.maximizedId) ? s.maximizedId : null;
}

export function zoomNodeTargetOf(state: Pick<CanvasState, 'nodes' | 'hidden' | 'bodyFocusId' | 'selection'>): string | null {
    const id = state.bodyFocusId ?? (state.selection.length === 1 ? state.selection[0]! : null);
    return id !== null && state.nodes[id] !== undefined && !state.hidden.has(id) ? id : null;
}
