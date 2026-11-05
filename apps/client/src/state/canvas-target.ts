import { isCanvasView, type ProjectCanvasView } from '@ruimte/contracts';
import { focusedViewId, shownViewIdsIn } from '@/layout/split';
import type { DocumentState } from '@/state/document';

/*
 * The canvas a view goes onto when nobody names one. A canvas standing in view wins over one that is
 * off screen: the one in the focused cell, else the one up last, else the first in reading order.
 * With none on screen it is the one up last, else the first there is.
 */
export function canvasInReach(state: Pick<DocumentState, 'views' | 'layout' | 'lastCanvasViewId'>): ProjectCanvasView | null {
    const canvases = state.views.filter(isCanvasView);
    const byId = (id: string | null): ProjectCanvasView | undefined => canvases.find((canvas) => canvas.id === id);
    if (state.layout !== null) {
        const focused = byId(focusedViewId(state.layout));
        if (focused) {
            return focused;
        }
        const onScreen = shownViewIdsIn(state.layout).flatMap((id) => byId(id) ?? []);
        const shown = onScreen.find((canvas) => canvas.id === state.lastCanvasViewId) ?? onScreen[0];
        if (shown) {
            return shown;
        }
    }
    return byId(state.lastCanvasViewId) ?? canvases[0] ?? null;
}
