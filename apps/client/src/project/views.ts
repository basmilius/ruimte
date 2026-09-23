import i18next from 'i18next';
import { isCanvasView, isOpenableView, isSessionView, sessionNodesOfView, type AgentKind, type ProjectView } from '@ruimte/contracts';
import { askBeforeEndingAgents } from '@/agents/end-children';
import {
    createNodeAction,
    createViewAction,
    deleteViewAction,
    focusNodeAction,
    focusViewAction,
    linkNodesAction,
    moveViewAction,
    promoteNodeAction,
    shareViewAction,
    showViewOnCanvasAction
} from '@/actions/client-actions';
import { offerDraft } from '@/chat/drafts';
import { GRID, type Point } from '@/canvas/math';
import { filesOfView } from '@/project/view-deletion';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { NODE_SIZE, focusedCanvas, liveCanvas } from '@/state/canvas';
import { currentEndpointId } from '@/state/keys';
import { useDocument, viewOfNode } from '@/state/document';
import { useProject } from '@/state/project';
import type { StatusOf } from '@/state/sessions';
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

/* A heading over the rows under it. It lands with a name it can be read by, and the sidebar puts the
   caret in it at once, since a heading is nothing but what it says. */
export const newSubheaderView = async (): Promise<void> => {
    const id = await createViewAction('subheader');
    if (id !== null) {
        useUi.getState().setRenamingViewId(id);
    }
};

/*
 * An empty diagram handed to an agent: the diagram goes on the canvas, a chat next to it with a line
 * from the diagram into it, and a first question in its prompt that the person finishes and sends.
 */
export const askAgentAboutDiagram = async (viewId: string): Promise<string | null> => {
    const view = useDocument.getState().views.find((candidate) => candidate.id === viewId);
    const mirror = await showViewOnCanvasAction(viewId);
    if (!view || mirror === null) {
        return null;
    }
    const { viewId: canvasViewId, nodes } = focusedCanvas().getState();
    const box = nodes[mirror];
    if (canvasViewId === null || !box) {
        return null;
    }
    const at = { x: box.x - GRID * 4 - NODE_SIZE.chat.w / 2, y: box.y + box.h / 2 };
    const chat = await createNodeAction('chat', { viewId: canvasViewId, at });
    if (chat === null) {
        return null;
    }
    await linkNodesAction(canvasViewId, mirror, chat);
    offerDraft(chat, i18next.t('project:diagram.draft', { name: view.name ?? viewId, viewId }));
    focusNodeAction(canvasViewId, chat);
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

/*
 * A file as a node on the canvas. The path may be absolute on the daemon's machine or already
 * stored the way a node holds one; both come out the same, since shortening a stored path is a
 * no-op. `at` says where the node's middle goes, in world units, which a drop knows and a menu does
 * not. Without one it lands near the middle of the view and the camera travels to it.
 */
export const showFileOnCanvas = async (path: string, at?: Point): Promise<string | null> => {
    const canvasViewId = canvasForFile();
    if (canvasViewId === null) {
        return null;
    }
    showView(canvasViewId);
    const id = await createNodeAction('file', { path, ...(at === undefined ? {} : { at }) });
    if (id !== null && at === undefined) {
        focusNodeAction(canvasViewId, id);
    }
    return id;
};

/* Files as views of their own, in the list in the order given, the first right under `after` (null for the top). */
export const newFileViewsAfter = async (paths: readonly string[], after: string | null): Promise<void> => {
    let previous = after;
    for (const path of paths) {
        const id = await createViewAction('file', { path });
        if (id === null) {
            continue;
        }
        await moveViewAction(id, previous);
        previous = id;
    }
};

/*
 * Puts a view in the shared file, or takes it back out, and says what happened with a way back. No
 * dialog. Nothing reaches anyone until the person commits, so there is nothing here to confirm. The
 * line names the count, which is the one thing a person did not see coming; the titles ride along
 * with it, and a chat titles itself after its first prompt.
 */
export const setViewShared = async (viewId: string, shared: boolean): Promise<void> => {
    const done = await shareViewAction(viewId, shared);
    if (done === null) {
        return;
    }
    useToasts.getState().show({
        kind: 'success',
        title: i18next.t(shared ? 'shell:share.shared' : 'shell:share.private', { name: done.view }),
        action: { label: i18next.t('common:action.undo'), run: done.undo }
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
export const openSessionInKind = async (viewId: string, kind: 'chat' | 'terminal', handoff: SessionHandoff): Promise<string | null> => {
    const source = useDocument.getState().views.find((view) => view.id === viewId);
    if (!source) {
        return null;
    }
    // A chat that goes on with a terminal's session is fixed to that CLI, which the action gives every agent chat.
    const id = await createViewAction(kind, { name: source.name ?? i18next.t('project:view.fallbackName'), ...handoff });
    if (id !== null) {
        await moveViewAction(id, viewId);
    }
    return id;
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
    promoteNodeAction(nodeId);
};

/*
 * Deleting asks only when the chats and terminals of the view opened agents that would end with it;
 * anything else goes at once, with a toast to take it back. A file it shows with unsaved changes is
 * saved first (`unsaved-close.ts`).
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
            deleteViewAction(id)
        );
    });
};

/* What a view is called and what it wears, in the one dialog that holds both. */
export const askViewSettings = (id: string): void => useUi.getState().setViewDialog({ kind: 'settings', viewId: id });
