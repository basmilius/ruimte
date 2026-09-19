import type { DrawingElement } from '@ruimte/contracts';
import { createViewMirror } from '@/canvas/view-mirror';
import { liveDrawing, subscribeDrawings } from '@/state/drawing';

/* What a drawing node shows: the elements of a drawing view, and null until they have been read. */
export const useDrawingMirror = createViewMirror<DrawingElement[]>({
    subscribeSnapshots: (listener) =>
        subscribeDrawings((viewId, state, previous) => {
            // An editor that is emptied on its way off screen is not the drawing becoming empty.
            if (state.elements !== previous.elements && state.viewId === viewId) {
                listener(viewId, state.elements);
            }
        }),
    liveSnapshot: (viewId) => {
        const editor = liveDrawing(viewId);
        return editor !== null && editor.viewId === viewId ? editor.elements : null;
    },
    open: (link, projectId, viewId) => link.request('drawing.open', { projectId, viewId }).then(({ document }) => document.elements),
    onChanged: (link, listener) => link.on('drawing.changed', ({ viewId, document }) => listener(viewId, document.elements))
});
