import { isCanvasView, isDrawingView, isOpenableView, isSessionView, MAIN_VIEW_NAME, type NodeKind, type ProjectView } from '@ruimte/contracts';
import { toWorld } from '@/canvas/math';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument, viewOfNode } from '@/state/document';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { useUi } from '@/state/ui';

/*
 * Puts a view on screen. A node that lives on another canvas is reached by switching there first.
 * Every route to a view runs through here, which is why closing an app-level page happens here too:
 * `setActiveView` returns early on the view that is already active, so the close has to come first.
 */
export const showView = (id: string): void => {
    useUi.getState().setPage(null);
    useDocument.getState().setActiveView(id);
};

export const revealNode = (nodeId: string): void => {
    const { views, activeViewId } = useDocument.getState();
    const view = viewOfNode(views, nodeId);
    if (view && view.id !== activeViewId) {
        showView(view.id);
    }
    useCanvas.getState().goToNode(nodeId);
};

/* "Canvas", then "Canvas 2": a new view is named after what it is until someone renames it. */
const freeName = (views: readonly ProjectView[], base: string): string => {
    const taken = new Set(views.flatMap((view) => (view.name === undefined ? [] : [view.name])));
    if (!taken.has(base)) {
        return base;
    }
    let counter = 2;
    while (taken.has(`${base} ${counter}`)) {
        counter += 1;
    }
    return `${base} ${counter}`;
};

export const newCanvasView = (): string => useDocument.getState().addCanvasView(freeName(useDocument.getState().views, MAIN_VIEW_NAME));

/* A shell of its own, with no agent in it: the plain Terminal beside the agent submenus. */
export const newTerminalView = (): string =>
    useDocument.getState().addStandaloneView({ kind: 'terminal', name: freeName(useDocument.getState().views, 'Terminal'), node: {} });

export const newSeparatorView = (): string => useDocument.getState().addSeparatorView();

export const newDrawingView = (): string => useDocument.getState().addDrawingView(freeName(useDocument.getState().views, 'Drawing'));

/*
 * Puts a mirror of a drawing view on the canvas that was open last. The drawing itself stays a view
 * of its own: the node reads the same file and opens the view on a double-click.
 */
export const showOnCanvas = (viewId: string): string | null => {
    const document = useDocument.getState();
    const view = document.views.find((candidate) => candidate.id === viewId);
    const canvasViewId = document.lastCanvasViewId ?? document.views.find(isCanvasView)?.id ?? null;
    if (!view || !isDrawingView(view) || !canvasViewId) {
        return null;
    }
    showView(canvasViewId);
    const canvas = useCanvas.getState();
    const center = toWorld(canvas.camera, { x: canvas.viewport.w / 2, y: canvas.viewport.h / 2 });
    const id = canvas.addNode('drawing', center, { title: view.name, viewId });
    canvas.goToNode(id);
    return id;
};

/* Copies a canvas or a drawing view. A drawing's elements are copied by the daemon, not here. */
export const duplicateViewOf = (id: string): string | null => {
    const source = useDocument.getState().views.find((view) => view.id === id);
    const copyId = useDocument.getState().duplicateView(id);
    if (copyId && source && isDrawingView(source)) {
        // Loaded here rather than at the top: this module is the actions, and importing the clients
        // would pull the transport into everything that only wants to know what a view holds.
        void import('@/project').then(({ drawingClient }) => drawingClient.copy(id, copyId));
    }
    return copyId;
};

/* The nth view, one-based, for Cmd+1 through Cmd+9. Separators are lines, so they are not counted. */
export const viewAtIndex = (index: number): ProjectView | undefined => useDocument.getState().views.filter(isOpenableView)[index - 1];

export const stepView = (delta: -1 | 1): void => {
    const views = useDocument.getState().views.filter(isOpenableView);
    const { activeViewId } = useDocument.getState();
    const at = views.findIndex((view) => view.id === activeViewId);
    if (at === -1 || views.length < 2) {
        return;
    }
    showView(views[(at + delta + views.length) % views.length]!.id);
};

/* What a view holds, in the words the status needs. The canvas store owns the view that is on screen. */
export const nodesOfView = (view: ProjectView): StatusOf[] => {
    if (isSessionView(view)) {
        // A standalone view is one node without a canvas, under its own id.
        return [{ id: view.id, kind: view.kind }];
    }
    if (!isCanvasView(view)) {
        return [];
    }
    if (view.id === useDocument.getState().activeViewId) {
        const canvas = useCanvas.getState();
        return canvas.order.map((id) => canvas.nodes[id]!);
    }
    return view.nodes;
};

/* A node as the whole project sees it: enough to have a status and a name, never a place. */
export interface ProjectNodeRef extends StatusOf {
    title: string;
}

/*
 * Every node the project holds, over every view, a standalone view counting as the one node it is.
 * Whatever looks at the whole project (the dock's counters, the notifications, the session
 * lifecycle) reads this rather than the canvas on screen.
 */
export const projectNodes = (): ProjectNodeRef[] => {
    const canvas = useCanvas.getState();
    const { views } = useDocument.getState();
    return views.flatMap<ProjectNodeRef>((view) => {
        if (isSessionView(view)) {
            return [{ id: view.id, kind: view.kind, title: view.name }];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return view.id === canvas.viewId ? canvas.order.map((id) => canvas.nodes[id]!) : view.nodes;
    });
};

/* Whether anything in a view is still talking to the daemon, which is what a delete asks about. */
export const viewIsBusy = (view: ProjectView): boolean => {
    const sessions = useSessions.getState().byNodeId;
    const chats = useChats.getState().byNodeId;
    return nodesOfView(view).some((node) => {
        const status = nodeStatus(node, sessions, chats);
        return status !== undefined && status !== 'idle';
    });
};

/* Which nodes can leave a canvas for a view of their own: the ones that are a session, not a frame. */
export const canOpenAsView = (kind: NodeKind): boolean => kind === 'chat' || kind === 'terminal' || kind === 'browser';

/*
 * A node becomes a view of its own, keeping its id and so its session. The lines drawn into it stay
 * behind, because an edge lives on a canvas, so a node that has any asks before it goes.
 */
export const askOpenAsView = (nodeId: string): void => {
    const canvas = useCanvas.getState();
    if (canvas.edges.some((edge) => edge.from === nodeId || edge.to === nodeId)) {
        useUi.getState().setViewDialog({ kind: 'promote', nodeId });
        return;
    }
    useDocument.getState().openAsView(nodeId);
};

/* The other way: the view becomes a node again, on the canvas that was up last. */
export const putOnCanvas = (viewId: string): boolean => {
    const { views, lastCanvasViewId } = useDocument.getState();
    const target = views.find((view) => view.id === lastCanvasViewId && isCanvasView(view)) ?? views.find(isCanvasView);
    return target ? useDocument.getState().putOnCanvas(viewId, target.id) : false;
};

/* Deleting takes a question only when something in the view is still running, like a node does. */
export const askDeleteView = (id: string): void => {
    const view = useDocument.getState().views.find((each) => each.id === id);
    if (!view) {
        return;
    }
    if (viewIsBusy(view)) {
        useUi.getState().setViewDialog({ kind: 'delete', viewId: id });
        return;
    }
    useDocument.getState().deleteView(id);
};

export const askRenameView = (id: string): void => useUi.getState().setViewDialog({ kind: 'rename', viewId: id });

export const askViewIcon = (id: string): void => useUi.getState().setViewDialog({ kind: 'icon', viewId: id });
