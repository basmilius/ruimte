import { NODE_SIZE } from './node-defaults.ts';
import {
    MAIN_VIEW_ID,
    MAIN_VIEW_NAME,
    isCanvasView,
    isDrawingView,
    isOpenableView,
    isSeparatorView,
    isSessionView,
    type NodeTitleSource,
    type ProjectCanvasView,
    type ProjectIconChoice,
    type ProjectNode,
    type ProjectView
} from './project.ts';

/*
 * What a person does to the list of views, as functions over the list itself. A person does it from
 * the sidebar and an agent does it with `ruimte-context view`, so the rules are here rather than in
 * either half: a view id is unique across the project, a separator is a line and never opens, an
 * edge that would point outside its own canvas falls away, and a project always has a view to open.
 *
 * What is not here is what only one side knows: the camera, the focus, the split layout and the
 * editors that hold a canvas on screen. Those stay in the client, which is the only side with a
 * viewport to measure them against.
 */

export const emptyCanvasView = (id: string, name: string): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name,
    nodes: [],
    texts: [],
    edges: [],
    layouts: []
});

/* Every id the project uses, view and node alike: together they are the keys of one session map. */
export const idsInViews = (views: readonly ProjectView[]): Set<string> => {
    const ids = new Set<string>();
    for (const view of views) {
        ids.add(view.id);
        if (isCanvasView(view)) {
            for (const item of [...view.nodes, ...view.texts, ...view.edges]) {
                ids.add(item.id);
            }
        }
    }
    return ids;
};

export const viewIndexOf = (views: readonly ProjectView[], id: string): number => views.findIndex((view) => view.id === id);

/*
 * The list with one view added, under `afterId` or at the end. The id has to be free: a repeat
 * would make two things answer to one session id, which is what `duplicateIdIn` refuses at parse.
 */
export const withView = (views: readonly ProjectView[], view: ProjectView, afterId?: string): ProjectView[] => {
    const at = afterId === undefined ? -1 : viewIndexOf(views, afterId);
    if (at === -1) {
        return [...views, view];
    }
    return [...views.slice(0, at + 1), view, ...views.slice(at + 1)];
};

/*
 * A renamed view, or null when the name and its source are already what is asked for: a page that
 * reopens on its own name claims no edit, and neither side should write a rev for it. A separator
 * carries a bare label and no `titleSource`, since nothing it hosts could rename it.
 */
export const withRenamedView = (views: readonly ProjectView[], id: string, name: string, source: NodeTitleSource | null = 'user'): ProjectView[] | null => {
    const current = views.find((view) => view.id === id);
    if (!current || (current.name === name && (isSeparatorView(current) || (current.titleSource ?? null) === source))) {
        return null;
    }
    return views.map((view) => {
        if (view.id !== id) {
            return view;
        }
        return isSeparatorView(view) ? { ...view, name } : { ...view, name, titleSource: source ?? undefined };
    });
};

/* A mark a person or an agent picked over the one the view's kind gives it; null hands it back. */
export const withViewIcon = (views: readonly ProjectView[], id: string, icon: ProjectIconChoice | null): ProjectView[] | null => {
    const current = views.find((view) => view.id === id);
    // A separator is a line with no room for a mark, so there is nothing to override.
    if (!current || isSeparatorView(current) || ((current.icon ?? null) === null && icon === null)) {
        return null;
    }
    return views.map((view) => (view.id === id ? { ...view, icon: icon ?? undefined } : view));
};

/* Another place in the sidebar. `toIndex` is the place in the list the view ends up at. */
export const withMovedView = (views: readonly ProjectView[], id: string, toIndex: number): ProjectView[] | null => {
    const at = viewIndexOf(views, id);
    if (at === -1 || toIndex === at) {
        return null;
    }
    const rest = views.filter((view) => view.id !== id);
    rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, views[at]!);
    return rest;
};

/*
 * A copy of a canvas or a drawing, right under the one it came from. A copy is new nodes with new
 * sessions, so every id inside it is renamed and no node resumes what the original was attached to;
 * a drawing holds nothing here, since its elements live in a file the daemon copies.
 */
export const withDuplicatedView = (
    views: readonly ProjectView[],
    id: string,
    nextId: (prefix: string) => string
): { views: ProjectView[]; id: string } | null => {
    const source = views.find((view) => view.id === id);
    if (!source || (!isCanvasView(source) && !isDrawingView(source))) {
        return null;
    }
    const copy: ProjectView = isCanvasView(source)
        ? copyOfCanvas(source, `${source.name} copy`, nextId)
        : { kind: 'drawing', id: nextId('view'), name: `${source.name} copy` };
    return { views: withView(views, copy, id), id: copy.id };
};

const copyOfCanvas = (view: ProjectCanvasView, name: string, nextId: (prefix: string) => string): ProjectCanvasView => {
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
        kind: 'canvas',
        id: nextId('view'),
        name,
        nodes: view.nodes.map((node) => ({ ...node, id: idOf(node.id), resume: undefined, memberIds: node.memberIds?.map(idOf) })),
        texts: view.texts.map((text) => ({ ...text, id: idOf(text.id) })),
        edges: view.edges.map((edge) => ({ ...edge, id: nextId('edge'), from: idOf(edge.from), to: idOf(edge.to) })),
        layouts: view.layouts.map((layout) => ({ ...layout, nodes: remap(layout.nodes), texts: remap(layout.texts) }))
    };
};

/*
 * The list without one view, and the view that left. A project always has a view to open, so taking
 * the last one leaves an empty canvas behind: separators alone are a list of lines with nowhere to
 * go. Null for an id the project does not have.
 */
export const withoutView = (views: readonly ProjectView[], id: string): { views: ProjectView[]; removed: ProjectView } | null => {
    const removed = views.find((view) => view.id === id);
    if (!removed) {
        return null;
    }
    const rest = views.filter((view) => view.id !== id);
    return { views: rest.some(isOpenableView) ? rest : [...rest, emptyCanvasView(MAIN_VIEW_ID, MAIN_VIEW_NAME)], removed };
};

/*
 * A node lifted off its canvas into a view of its own, keeping its id and so its session. Only a
 * chat, a terminal or a browser can stand on its own; the lines the node was part of stay behind,
 * because an edge lives on the canvas it was drawn on and the node is leaving that canvas.
 */
export const withNodeAsView = (views: readonly ProjectView[], nodeId: string): { views: ProjectView[]; view: ProjectView } | null => {
    const source = views.find((view) => isCanvasView(view) && view.nodes.some((node) => node.id === nodeId));
    if (!source || !isCanvasView(source)) {
        return null;
    }
    const node = source.nodes.find((candidate) => candidate.id === nodeId)!;
    if (node.kind !== 'chat' && node.kind !== 'terminal' && node.kind !== 'browser') {
        return null;
    }
    const view: ProjectView =
        node.kind === 'browser'
            ? { kind: 'browser', id: node.id, name: node.title, url: node.url ?? '' }
            : {
                  kind: node.kind,
                  id: node.id,
                  name: node.title,
                  node: {
                      cwd: node.cwd,
                      command: node.command,
                      resume: node.resume,
                      provider: node.provider,
                      providerFixed: node.providerFixed,
                      runtimeMode: node.runtimeMode,
                      accent: node.accent
                  }
              };
    const stripped = withoutNode(source, nodeId);
    return {
        views: withView(
            views.map((candidate) => (candidate.id === source.id ? stripped : candidate)),
            view,
            source.id
        ),
        view
    };
};

/*
 * The way back: a view of its own becomes a node on a canvas again, under the same id. `at` is
 * where the node's top left corner goes, which only the side with a viewport can work out.
 */
export const withViewAsNode = (
    views: readonly ProjectView[],
    viewId: string,
    canvasViewId: string,
    at: { x: number; y: number }
): { views: ProjectView[]; node: ProjectNode } | null => {
    const source = views.find((view) => view.id === viewId);
    const target = views.find((view) => view.id === canvasViewId);
    // A drawing is a file, not a session, so it is mirrored onto a canvas instead of moved there.
    if (!source || !isSessionView(source) || !target || !isCanvasView(target)) {
        return null;
    }
    const node: ProjectNode = {
        id: source.id,
        kind: source.kind,
        title: source.name,
        ...at,
        ...NODE_SIZE[source.kind],
        ...(source.kind === 'browser' ? { url: source.url } : source.node)
    };
    const next = views
        .filter((view) => view.id !== viewId)
        .map((view) => (view.id === canvasViewId && isCanvasView(view) ? { ...view, nodes: [...view.nodes, node] } : view));
    return { views: next, node };
};

/* A node moved to another canvas, its id and its session intact, its lines left where they were. */
export const withNodeOnView = (
    views: readonly ProjectView[],
    nodeId: string,
    canvasViewId: string,
    at?: { x: number; y: number }
): { views: ProjectView[]; node: ProjectNode } | null => {
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
};

/* A canvas without one node and without the lines that ran to it: an edge lives on one canvas. */
const withoutNode = (view: ProjectCanvasView, nodeId: string): ProjectCanvasView => ({
    ...view,
    nodes: view.nodes.filter((candidate) => candidate.id !== nodeId),
    edges: view.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
});

/* A node with a session behind it on the machine the project was opened on. */
export interface ViewSessionNode {
    id: string;
    kind: 'terminal' | 'chat';
}

const isSessionKind = (kind: string): kind is ViewSessionNode['kind'] => kind === 'terminal' || kind === 'chat';

/*
 * What keeps running on the machine for one view: a shell for a terminal, a CLI for a chat. A
 * browser is a page inside a client and a group, note, drawing or file is drawing and nothing else,
 * so neither is a session anybody has to end or be warned about. A canvas holds the nodes on it; a
 * chat or terminal that is a view of its own is the one node it is.
 */
export const sessionNodesOfView = (view: ProjectView): ViewSessionNode[] => {
    if (isSessionView(view)) {
        return isSessionKind(view.kind) ? [{ id: view.id, kind: view.kind }] : [];
    }
    if (!isCanvasView(view)) {
        return [];
    }
    return view.nodes.flatMap<ViewSessionNode>((node) => (isSessionKind(node.kind) ? [{ id: node.id, kind: node.kind }] : []));
};
