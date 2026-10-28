import { useEffect } from 'react';
import {
    chatHostOf,
    designNodeChats,
    isSessionView,
    mapDesignChats,
    sessionKindOfView,
    type AgentKind,
    type CanvasNodeKind,
    type DeviceReference,
    type NodeTitleSource,
    type ProjectNode,
    type ProjectView,
    type RuntimeMode
} from '@ruimte/contracts';
import { deleteNodesAction, deleteViewAction } from '@/actions/client-actions';
import { suggestedTitleFor } from '@/chat/title';
import { nodesOfView, useViewNodes } from '@/project/view-nodes';
import { canvasOfNode, DEFAULT_TITLES, useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { providersOf } from '@adecore/agents-react/state';

/*
 * What a body needs to run, wherever it is drawn. A node on a canvas and a view of its own are the
 * same thing under one id, so neither body has to know which of the two it is inside.
 */
export interface NodeHost {
    id: string;
    kind: CanvasNodeKind;
    title: string;
    /* Who named it. A page only renames what nobody has named. */
    titleSource?: NodeTitleSource;
    cwd?: string;
    command?: string;
    resume?: string;
    provider?: AgentKind;
    /* The account of that CLI on this machine; absent is its default account. */
    account?: string;
    providerFixed?: boolean;
    runtimeMode?: RuntimeMode;
    url?: string;
    browserOwner?: string;
    device?: DeviceReference;
    /* False when this is a view of its own: no frame around it, no canvas under it. */
    onCanvas: boolean;
}

function hostOfNode(node: ProjectNode): NodeHost {
    return {
        id: node.id,
        // A design node runs the chat under its own id like any chat node.
        kind: node.kind === 'design' ? 'chat' : node.kind,
        title: node.title,
        titleSource: node.titleSource,
        cwd: node.cwd,
        command: node.command,
        resume: node.resume,
        provider: node.provider,
        account: node.account,
        providerFixed: node.providerFixed,
        runtimeMode: node.runtimeMode,
        url: node.url,
        browserOwner: node.browserOwner,
        device: node.device,
        onCanvas: true
    };
}

function hostOfView(view: ProjectView): NodeHost | null {
    if (!isSessionView(view)) {
        return null;
    }
    if (view.kind === 'browser') {
        return {
            id: view.id,
            kind: 'browser',
            title: view.name,
            titleSource: view.titleSource,
            url: view.url,
            browserOwner: view.browserOwner,
            onCanvas: false
        };
    }
    if (view.kind === 'device') {
        return { id: view.id, kind: 'device', title: view.name, titleSource: view.titleSource, device: view.device, onCanvas: false };
    }
    return { id: view.id, kind: sessionKindOfView(view), title: view.name, titleSource: view.titleSource, ...view.node, onCanvas: false };
}

/* A view of its own by its id, or a later chat of a design by its id. */
function hostOfViewId(views: readonly ProjectView[], id: string): NodeHost | null {
    const view = views.find((each) => each.id === id);
    if (view) {
        return hostOfView(view);
    }
    const host = chatHostOf(views, id);
    return host === null ? null : { id, kind: 'chat', title: host.chat.name, ...host.chat.node, onCanvas: false };
}

/* A later chat of a design node: no node of its own, but its node's canvas and frame. */
function hostOfDesignChat(owner: ProjectNode, id: string): NodeHost | null {
    const chat = designNodeChats(owner).find((candidate) => candidate.id === id);
    return chat === undefined ? null : { id, kind: 'chat', title: chat.name, ...chat.node, onCanvas: true };
}

function ownsChat(node: ProjectNode, id: string): boolean {
    return designNodeChats(node).some((chat) => chat.id === id);
}

export function readNodeHost(id: string): NodeHost | null {
    const node = canvasOfNode(id)?.getState().nodes[id];
    if (node) {
        return hostOfNode(node);
    }
    const views = useDocument.getState().views;
    const owner = views.flatMap((view) => nodesOfView(view)).find((candidate) => ownsChat(candidate, id));
    return owner === undefined ? hostOfViewId(views, id) : hostOfDesignChat(owner, id);
}

/* Whether a view stands for this id: itself, or a design view holding it as a later chat. Reads the raw list, since every change of the document asks again. */
function viewHolds(view: ProjectView, id: string): boolean {
    return view.id === id || (view.kind === 'design' && (view.chats ?? []).some((chat) => chat.id === id));
}

export function useNodeHost(id: string): NodeHost | null {
    const node = useCanvas((s) => s.nodes[id]);
    // The design node on this canvas a later chat belongs to; the node itself is a stable object of the store.
    const localOwner = useCanvas((s) => (s.nodes[id] ? undefined : Object.values(s.nodes).find((candidate) => ownsChat(candidate, id))));
    // A body drawn outside its design's canvas (a chat opened from the sidebar, a panel) finds the node on any canvas.
    const owner = useViewNodes((views, nodesOf) =>
        node !== undefined || localOwner !== undefined ? localOwner : views.flatMap(nodesOf).find((candidate) => ownsChat(candidate, id))
    );
    // Only the view this id stands for, so a change elsewhere in the document draws nothing again.
    const view = useDocument((s) => (node !== undefined || owner !== undefined ? undefined : s.views.find((candidate) => viewHolds(candidate, id))));
    if (node) {
        return hostOfNode(node);
    }
    if (owner !== undefined) {
        return hostOfDesignChat(owner, id);
    }

    return view === undefined ? null : hostOfViewId([view], id);
}

/* The title of a node is the name of its view when it has no frame to carry one. */
export function renameHost(id: string, title: string, source: NodeTitleSource | null = 'user'): void {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        canvas.getState().renameNode(id, title, source);
        return;
    }
    useDocument.getState().renameView(id, title, source);
}

/*
 * Names the node after what its CLI called the session, following that name while nobody renames it.
 * The same suggestion arriving again finds the title it already set and writes nothing.
 */
export function useSuggestedTitle(id: string, suggestion: string | undefined): void {
    const host = useNodeHost(id);
    const title = host?.title;
    const source = host?.titleSource;
    useEffect(() => {
        if (title === undefined) {
            return;
        }
        const next = suggestedTitleFor({ title, titleSource: source }, suggestion);
        if (next !== null) {
            renameHost(id, next, 'auto');
        }
    }, [id, title, source, suggestion]);
}

export function updateHost(id: string, patch: Partial<Pick<NodeHost, 'url' | 'cwd' | 'command' | 'resume' | 'provider'>>): void {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        canvas.getState().updateNode(id, patch);
        return;
    }
    // A later chat of a design node keeps what it carries in its node's list of chats.
    const owner = useDocument
        .getState()
        .views.flatMap((view) => nodesOfView(view))
        .find((candidate) => ownsChat(candidate, id));
    const ownerCanvas = owner === undefined ? null : canvasOfNode(owner.id);
    if (owner !== undefined && ownerCanvas !== null) {
        const { url: _url, ...chatPatch } = patch;
        ownerCanvas.getState().updateNode(owner.id, {
            chats: mapDesignChats(owner.chats ?? [], (chat) => (chat.id === id ? { ...chat, node: { ...chat.node, ...chatPatch } } : chat))
        });
        return;
    }
    useDocument.getState().updateStandalone(id, patch);
}

/* The name a node carries before anything names it: the CLI's own name for an agent, the name of
   its kind for anything else. */
function automaticTitleOf(host: NodeHost): string {
    const provider = host.provider ? providersOf(currentEndpointId()).providers.find((each) => each.kind === host.provider) : undefined;
    // A newer Ruimte's node has no name of its kind here, so it keeps the one it came with.
    return provider?.name ?? (host.kind === 'unknown' ? host.title : DEFAULT_TITLES[host.kind]);
}

/*
 * Clearing a title hands the node back to its kind's name with no source, so its own source names it
 * again: the page's title for a browser, the next prompt for a chat.
 */
export function resetTitle(id: string, viewId?: string): void {
    // A design runs its chat under its own id, and a prompt to that chat must not name the design after itself.
    const design =
        canvasOfNode(id)?.getState().nodes[id]?.kind === 'design' || useDocument.getState().views.some((each) => each.id === id && each.kind === 'design');
    if (design) {
        renameHost(id, DEFAULT_TITLES.design, 'user');
        return;
    }
    const host = readNodeHost(id);
    if (host) {
        renameHost(id, automaticTitleOf(host), null);
        return;
    }
    // A node on a canvas in no cell lives only in its stored view, which the sidebar still lists.
    const view = viewId === undefined ? undefined : useDocument.getState().views.find((each) => each.id === viewId);
    const stored = view ? nodesOfView(view).find((node) => node.id === id) : undefined;
    if (view && stored) {
        if (stored.kind === 'design') {
            useDocument.getState().renameNodeOnView(view.id, id, DEFAULT_TITLES.design, 'user');
            return;
        }
        useDocument.getState().renameNodeOnView(view.id, id, automaticTitleOf(hostOfNode(stored)), null);
    }
}

/* Closing a body: the node leaves its canvas, or the view leaves the project. */
export function closeHost(id: string): void {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        deleteNodesAction(canvas, [id]);
        return;
    }
    deleteViewAction(id);
}
