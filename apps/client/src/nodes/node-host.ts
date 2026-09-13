import { useMemo } from 'react';
import { isSessionView, type AgentKind, type NodeKind, type NodeTitleSource, type ProjectView, type RuntimeMode } from '@ruimte/contracts';
import { canvasOfNode, DEFAULT_TITLES, useCanvas, type CanvasNode } from '@/state/canvas';
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
    kind: NodeKind;
    title: string;
    /* Who named it. A page only renames what nobody has named. */
    titleSource?: NodeTitleSource;
    cwd?: string;
    command?: string;
    resume?: string;
    provider?: AgentKind;
    providerFixed?: boolean;
    runtimeMode?: RuntimeMode;
    url?: string;
    /* False when this is a view of its own: no frame around it, no canvas under it. */
    onCanvas: boolean;
}

const hostOfNode = (node: CanvasNode): NodeHost => ({
    id: node.id,
    kind: node.kind,
    title: node.title,
    titleSource: node.titleSource,
    cwd: node.cwd,
    command: node.command,
    resume: node.resume,
    provider: node.provider,
    providerFixed: node.providerFixed,
    runtimeMode: node.runtimeMode,
    url: node.url,
    onCanvas: true
});

const hostOfView = (view: ProjectView): NodeHost | null => {
    if (!isSessionView(view)) {
        return null;
    }
    if (view.kind === 'browser') {
        return { id: view.id, kind: 'browser', title: view.name, titleSource: view.titleSource, url: view.url, onCanvas: false };
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
    return provider?.name ?? DEFAULT_TITLES[host.kind];
};

/*
 * Clearing a title takes the name away instead of keeping the old one: the node falls back to what
 * its kind starts with and nothing has named it again, so its own source takes over once more, which
 * is the page's title for a browser and the next prompt for a chat.
 */
export const resetTitle = (id: string): void => {
    const host = readNodeHost(id);
    if (!host) {
        return;
    }
    renameHost(id, automaticTitleOf(host), null);
};

/* Closing a body: the node leaves its canvas, or the view leaves the project. */
export const closeHost = (id: string): void => {
    const canvas = canvasOfNode(id)?.getState();
    if (canvas !== undefined) {
        canvas.select([id]);
        canvas.deleteSelected();
        return;
    }
    useDocument.getState().deleteView(id);
};
