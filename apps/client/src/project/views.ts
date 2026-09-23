import i18next from 'i18next';
import {
    canShareView,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    sessionNodesOfView,
    type AgentKind,
    type ProjectView
} from '@ruimte/contracts';
import { askBeforeEndingAgents } from '@/agents/end-children';
import { deleteViewAction, focusNodeAction, focusViewAction, freeName } from '@/actions/client-actions';
import { offerDraft } from '@/chat/drafts';
import { GRID, toWorld, type Point } from '@/canvas/math';
import { basenameOf, storedPathOf } from '@/shell/panels/files-tree';
import { filesOfView, nodesOfView } from '@/project/view-deletion';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { viewIdsIn, type SplitDirection } from '@/shell/split';
import { NODE_SIZE, focusedCanvas, liveCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { currentEndpointId } from '@/state/keys';
import { useDocument, viewOfNode, type DocumentState } from '@/state/document';
import { useProject } from '@/state/project';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';

/* Puts a view on screen. A node that lives on another canvas is reached by switching there first. */
export const showView = (id: string): void => {
    focusViewAction(id);
};

/*
 * Opens a view the machine writes (a fork) once it is in the document, which may be before or after
 * the answer to the request that made it. The next `project.changed` is what carries it.
 */
export const showViewWhenItLands = (id: string): void => {
    if (useDocument.getState().views.some((view) => view.id === id)) {
        showView(id);
        return;
    }
    const off = useDocument.subscribe((state) => {
        if (state.views.some((view) => view.id === id)) {
            // Before the open, which is a change this listener would otherwise hear again.
            off();
            state.setActiveView(id);
        }
    });
};

/*
 * The view a split puts in the cell it makes. The first one that is not standing anywhere yet, from
 * the focused view down the list and around. A view lives in at most one cell, so with every view
 * already up there is nothing to put beside them and the split does not happen.
 */
export const freeViewFor = (state: Pick<DocumentState, 'views' | 'layout' | 'activeViewId'>): string | null => {
    const openable = state.views.filter(isOpenableView);
    const taken = new Set(state.layout === null ? [] : viewIdsIn(state.layout));
    const from = openable.findIndex((view) => view.id === state.activeViewId);
    for (let step = 1; step <= openable.length; step += 1) {
        const view = openable[(Math.max(from, 0) + step) % openable.length]!;
        if (!taken.has(view.id)) {
            return view.id;
        }
    }
    return null;
};

/* Splitting the focused cell, from a shortcut or from a menu. The grid decides, this picks the view. */
export const splitFocusedCell = (direction: SplitDirection): void => {
    const state = useDocument.getState();
    const viewId = freeViewFor(state);
    if (viewId !== null) {
        state.splitFocused(direction, viewId);
    }
};

export const revealNode = (nodeId: string): void => {
    const { views, activeViewId } = useDocument.getState();
    const view = viewOfNode(views, nodeId);
    if (view && view.id !== activeViewId) {
        showView(view.id);
    }
    const viewId = view?.id ?? activeViewId;
    if (viewId !== null) {
        focusNodeAction(viewId, nodeId);
    }
};

export const newSeparatorView = (): string | null => useDocument.getState().addSeparatorView();

/* A heading over the rows under it. It lands with a name it can be read by, and the sidebar puts the
   caret in it at once, since a heading is nothing but what it says. */
export const newSubheaderView = (): string | null => {
    const id = useDocument.getState().addSubheaderView(freeName(useDocument.getState().views, 'Section'));
    useUi.getState().setRenamingViewId(id);
    return id;
};

/*
 * Puts a mirror of a drawing or a diagram view on the canvas that was open last. The view itself
 * stays a view of its own. The node reads the same file and opens the view on a double-click.
 */
export const showOnCanvas = (viewId: string): string | null => {
    const document = useDocument.getState();
    const view = document.views.find((candidate) => candidate.id === viewId);
    const canvasViewId = document.lastCanvasViewId ?? document.views.find(isCanvasView)?.id ?? null;
    if (!view || !(isDrawingView(view) || isDiagramView(view)) || !canvasViewId) {
        return null;
    }
    showView(canvasViewId);
    const canvas = focusedCanvas().getState();
    const center = toWorld(canvas.camera, { x: canvas.viewport.w / 2, y: canvas.viewport.h / 2 });
    const id = canvas.addNode(view.kind, center, { title: view.name, viewId });
    if (id === null) {
        return null;
    }
    canvas.goToNode(id);
    return id;
};

/*
 * An empty diagram handed to an agent: the diagram goes on the canvas, a chat next to it with a line
 * from the diagram into it, and a first question in its prompt that the person finishes and sends.
 */
export const askAgentAboutDiagram = (viewId: string): string | null => {
    const view = useDocument.getState().views.find((candidate) => candidate.id === viewId);
    const mirror = showOnCanvas(viewId);
    if (!view || mirror === null) {
        return null;
    }
    const canvas = focusedCanvas().getState();
    const box = canvas.nodes[mirror]!;
    const at = { x: box.x - GRID * 4 - NODE_SIZE.chat.w / 2, y: box.y + box.h / 2 };
    const chat = canvas.addNode('chat', at);
    if (chat === null) {
        return null;
    }
    canvas.addEdge(mirror, chat);
    offerDraft(chat, i18next.t('project:diagram.draft', { name: view.name ?? viewId, viewId }));
    canvas.goToNode(chat);
    return chat;
};

/* The canvas a file lands on: the one on screen, else the one that was up last. */
const canvasForFile = (): string | null => {
    const { views, activeViewId, lastCanvasViewId } = useDocument.getState();
    const active = views.find((view) => view.id === activeViewId);
    if (active && isCanvasView(active)) {
        return active.id;
    }
    return lastCanvasViewId ?? views.find(isCanvasView)?.id ?? null;
};

/* The path a node or a view stores, from a path on the daemon's machine. */
const storedFilePath = (path: string): string => storedPathOf(useProject.getState().current?.folder ?? null, path);

/*
 * A file as a node on the canvas. The path may be absolute on the daemon's machine or already
 * stored the way a node holds one; both come out the same, since shortening a stored path is a
 * no-op. `at` says where the node's middle goes, in world units, which a drop knows and a menu does
 * not. Without one it lands in the middle of the view and the camera travels to it.
 */
export const showFileOnCanvas = (path: string, at?: Point): string | null => {
    const canvasViewId = canvasForFile();
    if (canvasViewId === null) {
        return null;
    }
    showView(canvasViewId);
    const canvas = focusedCanvas().getState();
    const point = at ?? toWorld(canvas.camera, { x: canvas.viewport.w / 2, y: canvas.viewport.h / 2 });
    const id = canvas.addNode('file', point, { title: basenameOf(path), path: storedFilePath(path) });
    if (id !== null && at === undefined) {
        canvas.goToNode(id);
    }
    return id;
};

/* A file as a view of its own, a column beside the canvas rather than a frame on it. */
export const newFileView = (path: string, opens = true): string | null => useDocument.getState().addFileView(basenameOf(path), storedFilePath(path), opens);

/*
 * Puts a view in the shared file, or takes it back out, and says what happened with a way back. No
 * dialog. Nothing reaches anyone until the person commits, so there is nothing here to confirm. The
 * line names the count, which is the one thing a person did not see coming; the titles ride along
 * with it, and a chat titles itself after its first prompt.
 */
export const setViewShared = (viewId: string, shared: boolean): void => {
    const document = useDocument.getState();
    const view = document.views.find((candidate) => candidate.id === viewId);
    if (!view || (shared && !canShareView(view))) {
        return;
    }
    document.setShared(viewId, shared);
    useToasts.getState().show({
        kind: 'success',
        title: i18next.t(shared ? 'shell:share.shared' : 'shell:share.private', { name: view.name }),
        action: { label: i18next.t('common:action.undo'), run: () => useDocument.getState().setShared(viewId, !shared) }
    });
};

/* What a session view hands the other kind of view: which CLI, which session, and where it works. */
export interface SessionHandoff {
    provider: AgentKind;
    resume: string;
    cwd?: string;
}

/*
 * The same CLI session in the other kind of view: a chat for what a terminal is running, a terminal
 * for the CLI's own screen of a chat. Nothing is copied and neither view moves; both read the one
 * session, and the daemon owns the resume. It lands right under the view it came from, the way a
 * fork does, since a list is where a person looks for what they just opened.
 */
export const openSessionInKind = (viewId: string, kind: 'chat' | 'terminal', handoff: SessionHandoff): string | null => {
    const { views, addStandaloneView } = useDocument.getState();
    const source = views.find((view) => view.id === viewId);
    const at = views.findIndex((view) => view.id === viewId);
    if (!source || at === -1) {
        return null;
    }
    const id = addStandaloneView({
        kind,
        name: source.name ?? i18next.t('project:view.fallbackName'),
        // A chat that goes on with a terminal's session is that CLI; another one cannot pick it up.
        node: kind === 'chat' ? { ...handoff, providerFixed: true } : handoff
    });
    useDocument.getState().moveView(id, at + 1);
    return id;
};

/* Copies a canvas, a drawing or a diagram view. What a drawing or a diagram holds is copied by the daemon, not here. */
export const duplicateViewOf = (id: string): string | null => {
    const source = useDocument.getState().views.find((view) => view.id === id);
    const copyId = useDocument.getState().duplicateView(id);
    if (copyId && source && isDrawingView(source)) {
        // Loaded here rather than at the top. This module is the actions, and importing the clients
        // would pull the transport into everything that only wants to know what a view holds.
        void import('@/project').then(({ drawingClient }) => drawingClient.copy(id, copyId));
    }
    if (copyId && source && isDiagramView(source)) {
        void import('@/project').then(({ diagramClient }) => diagramClient.copy(id, copyId));
    }
    return copyId;
};

/* The nth view, one-based, for Cmd+1 through Cmd+9. A divider is no place to go, so it is not counted. */
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
    const { views } = useDocument.getState();
    return views.flatMap<ProjectNodeRef>((view) => {
        if (isSessionView(view)) {
            return [{ id: view.id, kind: view.kind, title: view.name }];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        // Every view on screen has an editor of its own, and what it holds is newer than the copy here.
        const editor = liveCanvas(view.id);
        return editor === null ? view.nodes : editor.order.map((id) => editor.nodes[id]!);
    });
};

/* Whether anything in a view is still talking to the daemon, which is what a delete asks about. */
export const viewIsBusy = (view: ProjectView): boolean => {
    const endpointId = currentEndpointId();
    const sessions = useSessions.getState().byKey;
    const chats = useChats.getState().byKey;
    return nodesOfView(view).some((node) => {
        const status = nodeStatus(node, sessions, chats, endpointId);
        return status !== undefined && status !== 'idle';
    });
};

/* Which nodes can leave a canvas for a view of their own: the ones that are a session, not a frame. */
export const canOpenAsView = (kind: string): boolean => kind === 'chat' || kind === 'terminal' || kind === 'browser' || kind === 'device';

/*
 * A node becomes a view of its own, keeping its id and so its session. The lines drawn into it stay
 * behind, because an edge lives on a canvas, so a node that has any asks before it goes.
 */
export const askOpenAsView = (nodeId: string): void => {
    const view = viewOfNode(useDocument.getState().views, nodeId);
    const canvas = view === null ? null : liveCanvas(view.id);
    if (canvas !== null && canvas.edges.some((edge) => edge.from === nodeId || edge.to === nodeId)) {
        useUi.getState().setViewDialog({ kind: 'promote', nodeId });
        return;
    }
    useDocument.getState().openAsView(nodeId);
};

/* The other way. The view becomes a node again, on the canvas that was up last. */
export const putOnCanvas = (viewId: string): boolean => {
    const { views, lastCanvasViewId } = useDocument.getState();
    const target = views.find((view) => view.id === lastCanvasViewId && isCanvasView(view)) ?? views.find(isCanvasView);
    return target ? useDocument.getState().putOnCanvas(viewId, target.id) : false;
};

/*
 * Deleting takes a question when something in the view is still running, and a question of its own
 * when its chats and terminals opened agents that would end with it. A file it shows with unsaved
 * changes is saved first (`unsaved-close.ts`).
 */
export const askDeleteView = (id: string): void => {
    const view = useDocument.getState().views.find((each) => each.id === id);
    if (!view) {
        return;
    }
    // The exported copy, so a canvas on screen is counted with what its editor holds now.
    const exported =
        useDocument
            .getState()
            .exportViews()
            .find((each) => each.id === id) ?? view;
    const sessions = sessionNodesOfView(exported).map((node) => node.id);
    const endpointId = currentEndpointId();
    closeAfterSaving(endpointId, filesOfView(exported, useProject.getState().current?.folder ?? null), () => {
        void askBeforeEndingAgents(transportFor(endpointId), sessions, ('name' in view ? view.name : undefined) ?? i18next.t('project:view.fallbackName'), () =>
            deleteViewAsking(view)
        );
    });
};

const deleteViewAsking = (view: ProjectView): void => {
    const id = view.id;
    if (viewIsBusy(view)) {
        useUi.getState().setViewDialog({ kind: 'delete', viewId: id });
        return;
    }
    deleteViewAction(id);
};

/* What a view is called and what it wears, in the one dialog that holds both. */
export const askViewSettings = (id: string): void => useUi.getState().setViewDialog({ kind: 'settings', viewId: id });
