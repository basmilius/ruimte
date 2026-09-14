import { useEffect } from 'react';
import { create } from 'zustand';
import type { DiagramContent } from '@ruimte/contracts';
import { contentOf, liveDiagram, subscribeDiagrams } from '@/state/diagram';
import { currentEndpointId, dropEndpoint, endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

export interface DiagramMirror {
    /* Null until the file has been read once. */
    content: DiagramContent | null;
    /* The view this node points at is not a diagram of this project any more. */
    gone: boolean;
    loading: boolean;
}

interface MirrorState {
    /* Keyed with `endpointKey` over the view id: a diagram belongs to a project on one machine. */
    byKey: Record<string, DiagramMirror>;
}

/*
 * What a diagram node shows: the graph of a diagram view, read once and kept up to date by the
 * daemon's watcher and by the editor when that same diagram is open. The drawing mirror's twin: a
 * node is never an editor, so nothing here writes.
 */
export const useDiagramMirrors = create<MirrorState>(() => ({ byKey: {} }));

const EMPTY: DiagramMirror = { content: null, gone: false, loading: false };

const put = (key: string, patch: Partial<DiagramMirror>): void =>
    useDiagramMirrors.setState((state) => ({
        byKey: { ...state.byKey, [key]: { ...EMPTY, ...state.byKey[key], ...patch } }
    }));

const watchers = new Map<string, number>();
/* The socket each machine's `diagram.changed` listener sits on; a socket that was replaced needs a new one. */
const wired = new Map<string, Transport>();
let wiredStores = false;

/* Every cell is listened to: a node may mirror the diagram standing in the cell beside it. */
const wireStores = (): void => {
    if (wiredStores) {
        return;
    }
    wiredStores = true;
    subscribeDiagrams((viewId, state, previous) => {
        const key = endpointKey(currentEndpointId(), viewId);
        // An editor that is emptied on its way off screen is not the diagram becoming empty.
        if (state.content !== previous.content && state.viewId === viewId && watchers.has(key)) {
            put(key, { content: state.content, gone: false, loading: false });
        }
    });
    useProject.subscribe((state, previous) => {
        if (state.current?.projectId !== previous.current?.projectId) {
            const endpointId = currentEndpointId();
            useDiagramMirrors.setState((mirrors) => ({ byKey: dropEndpoint(mirrors.byKey, endpointId) }));
        }
    });
};

/* One listener per machine, for the writes of an agent, another client or an editor on disk. */
const wireEndpoint = (endpointId: string): void => {
    const link = transportFor(endpointId);
    if (!link || wired.get(endpointId) === link) {
        return;
    }
    wired.set(endpointId, link);
    link.on('diagram.changed', ({ viewId, document }) => {
        const key = endpointKey(endpointId, viewId);
        if (watchers.has(key)) {
            put(key, { content: contentOf(document), gone: false, loading: false });
        }
    });
};

const load = (endpointId: string, viewId: string): void => {
    const projectId = useProject.getState().current?.projectId;
    const link = transportFor(endpointId);
    if (!projectId || !link) {
        return;
    }
    const key = endpointKey(endpointId, viewId);
    // A diagram already open in a cell is in that editor, with a drag that is not saved yet.
    const editor = liveDiagram(viewId);
    if (editor !== null && editor.viewId === viewId) {
        put(key, { content: editor.content, gone: false, loading: false });
        return;
    }
    put(key, { loading: true });
    void link
        .request('diagram.open', { projectId, viewId })
        .then(({ document }) => put(key, { content: contentOf(document), gone: false, loading: false }))
        .catch(() => put(key, { content: null, gone: true, loading: false }));
};

/* What one node shows, kept while the node is on screen. Nothing is closed: the editor owns that. */
export const useDiagramMirror = (viewId: string | null): DiagramMirror | null => {
    const endpointId = useEndpointId();
    const key = viewId ? endpointKey(endpointId, viewId) : null;

    useEffect(() => {
        if (!viewId || !key) {
            return;
        }
        wireStores();
        wireEndpoint(endpointId);
        watchers.set(key, (watchers.get(key) ?? 0) + 1);
        if (!useDiagramMirrors.getState().byKey[key]) {
            load(endpointId, viewId);
        }
        return () => {
            const left = (watchers.get(key) ?? 1) - 1;
            if (left > 0) {
                watchers.set(key, left);
                return;
            }
            watchers.delete(key);
        };
    }, [endpointId, key, viewId]);

    return useDiagramMirrors((state) => (key ? (state.byKey[key] ?? null) : null));
};
