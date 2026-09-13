import { useEffect } from 'react';
import { create } from 'zustand';
import type { DrawingElement } from '@ruimte/contracts';
import { liveDrawing, subscribeDrawings } from '@/state/drawing';
import { currentEndpointId, dropEndpoint, endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

export interface DrawingMirror {
    elements: DrawingElement[];
    /* The view this node points at is not a drawing of this project any more. */
    gone: boolean;
    loading: boolean;
}

interface MirrorState {
    /* Keyed with `endpointKey` over the view id: a drawing belongs to a project on one machine. */
    byKey: Record<string, DrawingMirror>;
}

/*
 * What a drawing node shows: the elements of a drawing view, read once and kept up to date by the
 * daemon's watcher and by the editor when that same drawing is open. A node is a mirror, never an
 * editor, so nothing here writes; two nodes and the view itself always show the same thing.
 */
export const useDrawingMirrors = create<MirrorState>(() => ({ byKey: {} }));

const EMPTY: DrawingMirror = { elements: [], gone: false, loading: false };

const put = (key: string, patch: Partial<DrawingMirror>): void =>
    useDrawingMirrors.setState((state) => ({
        byKey: { ...state.byKey, [key]: { ...EMPTY, ...state.byKey[key], ...patch } }
    }));

const watchers = new Map<string, number>();
/* The socket each machine's `drawing.changed` listener sits on; a socket that was replaced needs a new one. */
const wired = new Map<string, Transport>();
let wiredStores = false;

/*
 * The editors cover the drawings that are open here, which have to follow every stroke rather than
 * every save. Every cell is listened to rather than the one with the focus: a node mirrors a drawing
 * that may be standing in the cell beside it, and a stroke there counts the same.
 */
const wireStores = (): void => {
    if (wiredStores) {
        return;
    }
    wiredStores = true;
    subscribeDrawings((viewId, state, previous) => {
        const key = endpointKey(currentEndpointId(), viewId);
        if (state.elements !== previous.elements && watchers.has(key)) {
            put(key, { elements: state.elements, gone: false, loading: false });
        }
    });
    useProject.subscribe((state, previous) => {
        // Another project has other views; whatever was mirrored belongs to the one that left.
        if (state.current?.projectId !== previous.current?.projectId) {
            const endpointId = currentEndpointId();
            useDrawingMirrors.setState((mirrors) => ({ byKey: dropEndpoint(mirrors.byKey, endpointId) }));
        }
    });
};

/* One listener per machine, for the edits made outside this client and by other clients. */
const wireEndpoint = (endpointId: string): void => {
    const link = transportFor(endpointId);
    if (!link || wired.get(endpointId) === link) {
        return;
    }
    wired.set(endpointId, link);
    link.on('drawing.changed', ({ viewId, document }) => {
        const key = endpointKey(endpointId, viewId);
        if (watchers.has(key)) {
            put(key, { elements: document.elements, gone: false, loading: false });
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
    // A drawing already open in a cell is in that editor, with its unsaved strokes.
    const editor = liveDrawing(viewId);
    if (editor !== null) {
        put(key, { elements: editor.elements, gone: false, loading: false });
        return;
    }
    put(key, { loading: true });
    void link
        .request('drawing.open', { projectId, viewId })
        .then(({ document }) => put(key, { elements: document.elements, gone: false, loading: false }))
        .catch(() => put(key, { elements: [], gone: true, loading: false }));
};

/* What one node shows, kept while the node is on screen. Nothing is closed: the editor owns that. */
export const useDrawingMirror = (viewId: string | null): DrawingMirror | null => {
    const endpointId = useEndpointId();
    const key = viewId ? endpointKey(endpointId, viewId) : null;

    useEffect(() => {
        if (!viewId || !key) {
            return;
        }
        wireStores();
        wireEndpoint(endpointId);
        watchers.set(key, (watchers.get(key) ?? 0) + 1);
        if (!useDrawingMirrors.getState().byKey[key]) {
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

    return useDrawingMirrors((state) => (key ? (state.byKey[key] ?? null) : null));
};
