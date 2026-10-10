import { isCanvasView } from '@ruimte/contracts';
import { cellElement } from '@/shell/cell-rects';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, useDocument } from '@/state/document';

/* A surface that can be searched: the element it draws in, and what opens its bar. */
export interface FindHost {
    element: HTMLElement;
    /* `replace` asks for the bar with its replace row, which a surface that cannot replace draws without. */
    open(options?: FindOpenOptions): void;
}

export interface FindOpenOptions {
    replace?: boolean;
}

const hosts = new Set<FindHost>();

export function registerFindHost(host: FindHost): () => void {
    hosts.add(host);
    return () => {
        hosts.delete(host);
    };
}

// Drawn at all: a renderer that keeps a hidden preview mounted beside its source has two hosts in one surface.
function shown(host: FindHost): boolean {
    return host.element.isConnected && host.element.getClientRects().length > 0;
}

/* The deepest shown host that passes `test`, since one surface may hold another. */
function deepestHost(test: (host: FindHost) => boolean): FindHost | null {
    let found: FindHost | null = null;
    for (const host of hosts) {
        if (test(host) && shown(host) && (found === null || found.element.contains(host.element))) {
            found = host;
        }
    }
    return found;
}

function hostWithin(scope: Element): FindHost | null {
    return deepestHost((host) => scope.contains(host.element));
}

function hostAround(element: Element): FindHost | null {
    return deepestHost((host) => host.element.contains(element));
}

/*
 * The surface with the focus. The keyboard's own element says it first; a thread or a document takes
 * no focus of its own, so after that it is the node whose body has the keyboard on a canvas, and the
 * one surface of any other cell.
 */
export function focusedFindHost(): FindHost | null {
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
        const around = hostAround(active);
        if (around !== null) {
            return around;
        }
    }
    const state = useDocument.getState();
    const cell = state.activeViewId === null ? null : cellElement(state.activeViewId);
    if (cell === null) {
        return null;
    }
    const view = activeViewOf(state);
    if (view === null || !isCanvasView(view)) {
        return hostWithin(cell);
    }
    const nodeId = focusedCanvas().getState().bodyFocusId;
    const node = nodeId === null ? null : cell.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    return node === null ? null : hostWithin(node);
}

/* False when nothing with the focus can be searched, so the key goes on to whatever else wants it. */
export function openFocusedFind(options?: FindOpenOptions): boolean {
    const host = focusedFindHost();
    host?.open(options);
    return host !== null;
}
