import { useEffect, useMemo } from 'react';
import {
    isCanvasView,
    isSessionView,
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
import { canvasOfNode, DEFAULT_TITLES, useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { providersOf } from '@/state/providers';

/*
 * What a body needs to run, wherever it is drawn. A node on a canvas and a view of its own are the
 * same thing under one id: the frame reads this and so does the view host, and neither body has to
 * know which of the two it is inside. Only what a body actually uses is here.
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
    device?: DeviceReference;
    /* False when this is a view of its own: no frame around it, no canvas under it. */
    onCanvas: boolean;
}

const hostOfNode = (node: ProjectNode): NodeHost => ({
    id: node.id,
    kind: node.kind,
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
    device: node.device,
    onCanvas: true
});

const hostOfView = (view: ProjectView): NodeHost | null => {
    if (!isSessionView(view)) {
        return null;
    }
    if (view.kind === 'browser') {
        return { id: view.id, kind: 'browser', title: view.name, titleSource: view.titleSource, url: view.url, onCanvas: false };
    }
    if (view.kind === 'device') {
        return { id: view.id, kind: 'device', title: view.name, titleSource: view.titleSource, device: view.device, onCanvas: false };
    }
    return { id: view.id, kind: view.kind, title: view.name, titleSource: view.titleSource, ...view.node, onCanvas: false };
};

export const readNodeHost = (id: string): NodeHost | null => {
    const node = canvasOfNode(id)?.getState().nodes[id];
    if (node) {
        return hostOfNode(node);
    }
    const view = useDocument.getState().views.find((each) => each.id === id);
    return view ? hostOfView(view) : null;
};

export const useNodeHost = (id: string): NodeHost | null => {
    const node = useCanvas((s) => s.nodes[id]);
    const view = useDocument((s) => s.views.find((each) => each.id === id) ?? null);
    return useMemo(() => (node ? hostOfNode(node) : view ? hostOfView(view) : null), [node, view]);
};

/* The title of a node is the name of its view when it has no frame to carry one. */
export const renameHost = (id: string, title: string, source: NodeTitleSource | null = 'user'): void => {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        canvas.getState().renameNode(id, title, source);
        return;
    }
    useDocument.getState().renameView(id, title, source);
};

/*
 * Names the node after what its CLI called the session, following that name while nobody renames it.
 * The same suggestion arriving again finds the title it already set and writes nothing.
 */
export const useSuggestedTitle = (id: string, suggestion: string | undefined): void => {
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
};

export const updateHost = (id: string, patch: Partial<Pick<NodeHost, 'url' | 'cwd' | 'command' | 'resume' | 'provider'>>): void => {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        canvas.getState().updateNode(id, patch);
        return;
    }
    useDocument.getState().updateStandalone(id, patch);
};

/* The name a node carries before anything names it: the CLI's own name for an agent, the name of
   its kind for anything else. */
export const automaticTitleOf = (host: NodeHost): string => {
    const provider = host.provider ? providersOf(currentEndpointId()).providers.find((each) => each.kind === host.provider) : undefined;
    // A newer Ruimte's node has no name of its kind here, so it keeps the one it came with.
    return provider?.name ?? (host.kind === 'unknown' ? host.title : DEFAULT_TITLES[host.kind]);
};

/*
 * Clearing a title takes the name away instead of keeping the old one: the node falls back to what
 * its kind starts with and nothing has named it again, so its own source takes over once more, which
 * is the page's title for a browser and the next prompt for a chat.
 */
export const resetTitle = (id: string, viewId?: string): void => {
    const host = readNodeHost(id);
    if (host) {
        renameHost(id, automaticTitleOf(host), null);
        return;
    }
    // A node on a canvas in no cell lives only in its stored view, which the sidebar still lists.
    const view = viewId === undefined ? undefined : useDocument.getState().views.find((each) => each.id === viewId);
    const stored = view && isCanvasView(view) ? view.nodes.find((node) => node.id === id) : undefined;
    if (view && stored) {
        useDocument.getState().renameNodeOnView(view.id, id, automaticTitleOf(hostOfNode(stored)), null);
    }
};

/* Closing a body: the node leaves its canvas, or the view leaves the project. */
export const closeHost = (id: string): void => {
    const canvas = canvasOfNode(id);
    if (canvas !== null) {
        deleteNodesAction(canvas, [id]);
        return;
    }
    deleteViewAction(id);
};
