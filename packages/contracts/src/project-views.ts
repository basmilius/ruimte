import type { z } from 'zod';
import { nodeSizeOf, type NodeSizes } from './node-defaults.ts';
import {
    isCanvasView,
    isDesignView,
    isDiagramView,
    isDividerView,
    isDrawingView,
    isSessionView,
    isUnknownView,
    type NodeTitleSource,
    ProjectArtifactViewSchema,
    ProjectBrowserViewSchema,
    ProjectCanvasViewSchema,
    ProjectChatViewSchema,
    type ProjectCanvasView,
    ProjectDeviceViewSchema,
    ProjectDiagramViewSchema,
    ProjectDrawingViewSchema,
    type ProjectIconChoice,
    type ProjectNode,
    ProjectNodeSchema,
    ProjectTerminalViewSchema,
    type ProjectView,
    viewChats
} from './project.ts';

/*
 * Shared view-list rules used by the client and canvas verbs. Viewport state stays client-side;
 * these functions preserve project-wide ids and edges.
 */

/* The keys of a stored entry that its schema has no field for: what a newer Ruimte added and this one carries along. */
function extraFieldsOf(entry: object, schema: z.ZodObject): Record<string, unknown> {
    return Object.fromEntries(Object.entries(entry).filter(([key]) => !(key in schema.shape)));
}

export function emptyCanvasView(id: string, name: string): ProjectCanvasView {
    return {
        kind: 'canvas',
        id,
        name,
        nodes: [],
        texts: [],
        edges: [],
        layouts: []
    };
}

/* Every id the project uses, view and node alike: together they are the keys of one session map. */
export function idsInViews(views: readonly ProjectView[]): Set<string> {
    const ids = new Set<string>();
    for (const view of views) {
        ids.add(view.id);
        for (const chat of viewChats(view)) {
            ids.add(chat.id);
        }
        if (isCanvasView(view)) {
            for (const item of [...view.nodes, ...view.texts, ...view.edges]) {
                ids.add(item.id);
            }
        }
    }
    return ids;
}

function viewIndexOf(views: readonly ProjectView[], id: string): number {
    return views.findIndex((view) => view.id === id);
}

/*
 * The list with one view added, under `afterId` or at the end. The id has to be free: a repeat
 * would make two things answer to one session id, which is what `duplicateIdIn` refuses at parse.
 */
export function withView(views: readonly ProjectView[], view: ProjectView, afterId?: string): ProjectView[] {
    const at = afterId === undefined ? -1 : viewIndexOf(views, afterId);
    if (at === -1) {
        return [...views, view];
    }
    return [...views.slice(0, at + 1), view, ...views.slice(at + 1)];
}

/*
 * A renamed view, or null when the name and its source are already what is asked for: a page that
 * reopens on its own name claims no edit, and neither side should write a rev for it. A divider
 * carries a bare label and no `titleSource`, since nothing it hosts could rename it.
 */
export function withRenamedView(views: readonly ProjectView[], id: string, name: string, source: NodeTitleSource | null = 'user'): ProjectView[] | null {
    const current = views.find((view) => view.id === id);
    // A view of an unknown kind is written back as it was read, so a new name would never reach the file.
    if (!current || isUnknownView(current) || (current.name === name && (isDividerView(current) || (current.titleSource ?? null) === source))) {
        return null;
    }
    return views.map((view) => {
        if (view.id !== id) {
            return view;
        }
        return isDividerView(view) || isUnknownView(view) ? { ...view, name } : { ...view, name, titleSource: source ?? undefined };
    });
}

/* A mark a person or an agent picked over the one the view's kind gives it; null hands it back. */
export function withViewIcon(views: readonly ProjectView[], id: string, icon: ProjectIconChoice | null): ProjectView[] | null {
    const current = views.find((view) => view.id === id);
    // A divider marks the list rather than standing in it, so there is nothing to override.
    if (!current || isDividerView(current) || isUnknownView(current) || ((current.icon ?? null) === null && icon === null)) {
        return null;
    }
    return views.map((view) => (view.id === id ? { ...view, icon: icon ?? undefined } : view));
}

/* Another place in the sidebar. `toIndex` is the place in the list the view ends up at. */
export function withMovedView(views: readonly ProjectView[], id: string, toIndex: number): ProjectView[] | null {
    const at = viewIndexOf(views, id);
    if (at === -1 || toIndex === at) {
        return null;
    }
    const rest = views.filter((view) => view.id !== id);
    rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, views[at]!);
    return rest;
}

/*
 * A copy goes right under its source. Every id inside is renamed so no node resumes the original's
 * session; a drawing or diagram's content is a file the daemon copies.
 */
export function withDuplicatedView(views: readonly ProjectView[], id: string, nextId: (prefix: string) => string): { views: ProjectView[]; id: string } | null {
    const source = views.find((view) => view.id === id);
    if (!source || (!isCanvasView(source) && !isDrawingView(source) && !isDiagramView(source))) {
        return null;
    }
    const copy: ProjectView = isCanvasView(source)
        ? copyOfCanvas(source, `${source.name} copy`, nextId)
        : {
              ...extraFieldsOf(source, source.kind === 'drawing' ? ProjectDrawingViewSchema : ProjectDiagramViewSchema),
              kind: source.kind,
              id: nextId('view'),
              name: `${source.name} copy`
          };
    return { views: withView(views, copy, id), id: copy.id };
}

function copyOfCanvas(view: ProjectCanvasView, name: string, nextId: (prefix: string) => string): ProjectCanvasView {
    const renamed = new Map<string, string>();
    for (const node of view.nodes) {
        renamed.set(node.id, nextId(node.kind));
    }
    for (const text of view.texts) {
        renamed.set(text.id, nextId('text'));
    }
    const idOf = (id: string): string => renamed.get(id) ?? id;
    const remap = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(record).map(([id, value]) => [idOf(id), value]));
    return {
        ...extraFieldsOf(view, ProjectCanvasViewSchema),
        kind: 'canvas',
        id: nextId('view'),
        name,
        nodes: view.nodes.map((node) => ({ ...node, id: idOf(node.id), resume: undefined, memberIds: node.memberIds?.map(idOf) })),
        texts: view.texts.map((text) => ({ ...text, id: idOf(text.id) })),
        edges: view.edges.map((edge) => ({ ...edge, id: nextId('edge'), from: idOf(edge.from), to: idOf(edge.to) })),
        layouts: view.layouts.map((layout) => ({ ...layout, nodes: remap(layout.nodes), texts: remap(layout.texts) })),
        ...(view.lines ? { lines: view.lines.map((line) => ({ ...line, id: nextId('line') })) } : {})
    };
}

/* Null for an id the project does not have. */
export function withoutView(views: readonly ProjectView[], id: string): { views: ProjectView[]; removed: ProjectView } | null {
    const removed = views.find((view) => view.id === id);
    if (!removed) {
        return null;
    }
    return { views: views.filter((view) => view.id !== id), removed };
}

/*
 * Keeps the node's id and so its session. Only a chat, terminal, browser, device or artifact can stand
 * on its own; its lines stay behind, since an edge lives on the canvas it was drawn on.
 */
export function withNodeAsView(views: readonly ProjectView[], nodeId: string): { views: ProjectView[]; view: ProjectView } | null {
    const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
    if (!source || !isCanvasView(source)) {
        return null;
    }
    const node = source.nodes.find((candidate) => candidate.id === nodeId)!;
    if (node.kind !== 'chat' && node.kind !== 'terminal' && node.kind !== 'browser' && node.kind !== 'device' && node.kind !== 'artifact') {
        return null;
    }
    const extras = extraFieldsOf(node, ProjectNodeSchema);
    let view: ProjectView;
    if (node.kind === 'artifact') {
        view = { kind: 'artifact', id: node.id, name: node.title, node: { ...extras, ...(node.artifact ? { artifact: node.artifact } : {}) } };
    } else if (node.kind === 'browser') {
        view = {
            ...extras,
            kind: 'browser',
            id: node.id,
            name: node.title,
            url: node.url ?? '',
            ...(node.browserOwner ? { browserOwner: node.browserOwner } : {})
        };
    } else if (node.kind === 'device') {
        if (!node.device) {
            return null;
        }
        view = { ...extras, kind: 'device', id: node.id, name: node.title, device: node.device };
    } else {
        view = {
            kind: node.kind,
            id: node.id,
            name: node.title,
            node: {
                ...extras,
                cwd: node.cwd,
                command: node.command,
                resume: node.resume,
                provider: node.provider,
                account: node.account,
                providerFixed: node.providerFixed,
                runtimeMode: node.runtimeMode,
                accent: node.accent,
                issue: node.issue
            }
        };
    }
    const stripped = withoutNode(source, nodeId);
    return {
        views: withView(
            views.map((candidate) => (candidate.id === source.id ? stripped : candidate)),
            view,
            source.id
        ),
        view
    };
}

const VIEW_SCHEMAS_OF_SESSIONS = {
    chat: ProjectChatViewSchema,
    terminal: ProjectTerminalViewSchema,
    browser: ProjectBrowserViewSchema,
    device: ProjectDeviceViewSchema,
    artifact: ProjectArtifactViewSchema
} as const;

/*
 * The way back: a view of its own becomes a node on a canvas again, under the same id. `at` is
 * where the node's top left corner goes, which only the side with a viewport can work out; `sizes`
 * are the machine's own sizes for a kind.
 */
export function withViewAsNode(
    views: readonly ProjectView[],
    viewId: string,
    canvasViewId: string,
    at: { x: number; y: number },
    sizes?: NodeSizes
): { views: ProjectView[]; node: ProjectNode } | null {
    const source = views.find((view) => view.id === viewId);
    const target = views.find((view) => view.id === canvasViewId);
    // A drawing is a file, not a session, so it is mirrored onto a canvas instead of moved there. A design is a view only: no node shows its folder.
    if (!source || !(isSessionView(source) || source.kind === 'artifact') || source.kind === 'design' || !target || !isCanvasView(target)) {
        return null;
    }
    const own =
        source.kind === 'browser'
            ? { url: source.url, ...(source.browserOwner ? { browserOwner: source.browserOwner } : {}) }
            : source.kind === 'device'
              ? { device: source.device }
              : source.node;
    // The identity and frame come last: a stored `node` is loose and must not decide them.
    const node: ProjectNode = {
        ...extraFieldsOf(source, VIEW_SCHEMAS_OF_SESSIONS[source.kind]),
        ...own,
        id: source.id,
        kind: source.kind,
        title: source.name,
        ...at,
        ...nodeSizeOf(sizes, source.kind)
    };
    const next = views
        .filter((view) => view.id !== viewId)
        .map((view) => (view.id === canvasViewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, node] } : view));
    return { views: next, node };
}

/* A node moved to another canvas, its id and its session intact, its lines left where they were. */
export function withNodeOnView(
    views: readonly ProjectView[],
    nodeId: string,
    canvasViewId: string,
    at?: { x: number; y: number }
): { views: ProjectView[]; node: ProjectNode } | null {
    const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
    const target = views.find((view) => view.id === canvasViewId);
    if (!source || !isCanvasView(source) || !target || !isCanvasView(target) || source.id === canvasViewId) {
        return null;
    }
    const node = { ...source.nodes.find((candidate) => candidate.id === nodeId)!, ...(at ?? {}) };
    const next = views.map((view) => {
        if (view.id === source.id && isCanvasView(view)) {
            return withoutNode(view, nodeId);
        }
        return view.id === canvasViewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, node] } : view;
    });
    return { views: next, node };
}

/* A canvas without one node and without the lines that ran to it: an edge lives on one canvas. */
function withoutNode(view: ProjectCanvasView, nodeId: string): ProjectCanvasView {
    return {
        ...view,
        nodes: view.nodes.filter((candidate) => candidate.id !== nodeId),
        edges: view.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
    };
}

/* A node with a session behind it on the machine the project was opened on. */
export interface ViewSessionNode {
    id: string;
    kind: 'terminal' | 'chat';
}

function isSessionKind(kind: string): kind is ViewSessionNode['kind'] {
    return kind === 'terminal' || kind === 'chat';
}

// What keeps running on the machine for a view: a shell or a CLI. A browser page lives in a client, so it is none.
export function sessionNodesOfView(view: ProjectView): ViewSessionNode[] {
    if (isDesignView(view)) {
        return viewChats(view).map((chat) => ({ id: chat.id, kind: 'chat' }));
    }
    if (isSessionView(view)) {
        return isSessionKind(view.kind) ? [{ id: view.id, kind: view.kind }] : [];
    }
    if (!isCanvasView(view)) {
        return [];
    }
    return view.nodes.flatMap<ViewSessionNode>((node) => (isSessionKind(node.kind) ? [{ id: node.id, kind: node.kind }] : []));
}
