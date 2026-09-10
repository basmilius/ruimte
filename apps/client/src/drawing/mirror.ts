import { useEffect } from 'react';
import { create } from 'zustand';
import type { DrawingElement } from '@ruimte/contracts';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { transport } from '@/transport';

export interface DrawingMirror {
    elements: DrawingElement[];
    /* The view this node points at is not a drawing of this project any more. */
    gone: boolean;
    loading: boolean;
}

interface MirrorState {
    byViewId: Record<string, DrawingMirror>;
}

/*
 * What a drawing node shows: the elements of a drawing view, read once and kept up to date by the
 * daemon's watcher and by the editor when that same drawing is open. A node is a mirror, never an
 * editor, so nothing here writes; two nodes and the view itself always show the same thing.
 */
export const useDrawingMirrors = create<MirrorState>(() => ({ byViewId: {} }));

const EMPTY: DrawingMirror = { elements: [], gone: false, loading: false };

const put = (viewId: string, patch: Partial<DrawingMirror>): void =>
    useDrawingMirrors.setState((state) => ({
        byViewId: { ...state.byViewId, [viewId]: { ...EMPTY, ...state.byViewId[viewId], ...patch } }
    }));

const watchers = new Map<string, number>();
let wired = false;

/*
 * One listener for every mirror. The daemon's `drawing.changed` covers outside edits and other
 * clients; the editor store covers the drawing that is open here, which has to follow every stroke
 * rather than every save.
 */
const wire = (): void => {
    if (wired) {
        return;
    }
    wired = true;
    transport.on('drawing.changed', ({ viewId, document }) => {
        if (watchers.has(viewId)) {
            put(viewId, { elements: document.elements, gone: false, loading: false });
        }
    });
    useDrawing.subscribe((state, previous) => {
        if (state.viewId && state.elements !== previous.elements && watchers.has(state.viewId)) {
            put(state.viewId, { elements: state.elements, gone: false, loading: false });
        }
    });
    useProject.subscribe((state, previous) => {
        // Another project has other views; whatever was mirrored belongs to the one that left.
        if (state.current?.projectId !== previous.current?.projectId) {
            useDrawingMirrors.setState({ byViewId: {} });
        }
    });
};

const load = (viewId: string): void => {
    const projectId = useProject.getState().current?.projectId;
    if (!projectId) {
        return;
    }
    // The drawing that is open in the editor is already in the store, with its unsaved strokes.
    const editor = useDrawing.getState();
    if (editor.viewId === viewId) {
        put(viewId, { elements: editor.elements, gone: false, loading: false });
        return;
    }
    put(viewId, { loading: true });
    void transport
        .request('drawing.open', { projectId, viewId })
        .then(({ document }) => put(viewId, { elements: document.elements, gone: false, loading: false }))
        .catch(() => put(viewId, { elements: [], gone: true, loading: false }));
};

/* What one node shows, kept while the node is on screen. Nothing is closed: the editor owns that. */
export const useDrawingMirror = (viewId: string | null): DrawingMirror | null => {
    useEffect(() => {
        if (!viewId) {
            return;
        }
        wire();
        watchers.set(viewId, (watchers.get(viewId) ?? 0) + 1);
        if (!useDrawingMirrors.getState().byViewId[viewId]) {
            load(viewId);
        }
        return () => {
            const left = (watchers.get(viewId) ?? 1) - 1;
            if (left > 0) {
                watchers.set(viewId, left);
                return;
            }
            watchers.delete(viewId);
        };
    }, [viewId]);
    return useDrawingMirrors((state) => (viewId ? (state.byViewId[viewId] ?? null) : null));
};
