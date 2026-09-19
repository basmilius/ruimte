import type { DiagramContent } from '@ruimte/contracts';
import { createViewMirror } from '@/canvas/view-mirror';
import { contentOf, liveDiagram, subscribeDiagrams } from '@/state/diagram';

/* What a diagram node shows: the graph of a diagram view, and null until it has been read. */
export const useDiagramMirror = createViewMirror<DiagramContent>({
    subscribeSnapshots: (listener) =>
        subscribeDiagrams((viewId, state, previous) => {
            // An editor that is emptied on its way off screen is not the diagram becoming empty.
            if (state.content !== previous.content && state.viewId === viewId) {
                listener(viewId, state.content);
            }
        }),
    liveSnapshot: (viewId) => {
        const editor = liveDiagram(viewId);
        return editor !== null && editor.viewId === viewId ? editor.content : null;
    },
    open: (link, projectId, viewId) => link.request('diagram.open', { projectId, viewId }).then(({ document }) => contentOf(document)),
    onChanged: (link, listener) => link.on('diagram.changed', ({ viewId, document }) => listener(viewId, contentOf(document)))
});
