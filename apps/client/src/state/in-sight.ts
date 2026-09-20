import { isCanvasView, isSessionView } from '@ruimte/contracts';
import { READABLE_ZOOM } from '@/canvas/culling';
import { intersects, isMeasured, visibleRect, type Camera, type Rect } from '@/canvas/math';
import { viewIdsIn } from '@/shell/split';
import { liveCanvas, type CanvasState } from '@/state/canvas';
import { useDocument } from '@/state/document';

/*
 * What a person has in front of them, as one answer the marks, the counters and the notifications
 * all read. Kept apart from `state/attention.ts` so anything that announces something can ask about
 * the node it is about without importing the watcher that announces it.
 */

/* One canvas as a question about sight: where the camera is and what stands in front of it. */
export interface CanvasSight {
    camera: Camera;
    viewport: { w: number; h: number };
    nodes: readonly (Rect & { id: string })[];
    /* Node ids inside a collapsed group. They are in the project and on nobody's screen. */
    hidden?: ReadonlySet<string>;
}

/*
 * The uncollapsed nodes inside the exact viewport, never the renderer's wider culling area. `readable`
 * also asks that the camera be close enough to read them, which is what "a person saw this" means and
 * so what attention counts. An agent asking what is on the canvas passes it false on purpose: it reads
 * the node's own title and content rather than the pixels, so a zoomed-out canvas is not blind to it.
 */
export const visibleNodes = (canvas: CanvasSight, { readable }: { readable: boolean }): string[] => {
    if (!isMeasured(canvas.viewport) || (readable && canvas.camera.zoom < READABLE_ZOOM)) {
        return [];
    }
    const rect = visibleRect(canvas.camera, canvas.viewport);
    return canvas.nodes.filter((node) => canvas.hidden?.has(node.id) !== true && intersects(node, rect)).map((node) => node.id);
};

export const readableNodes = (canvas: CanvasSight): string[] => visibleNodes(canvas, { readable: true });

/* An open canvas as the question about sight: a store keys its nodes, a sight lists them in order. */
export const sightOf = (canvas: CanvasState): CanvasSight => ({
    camera: canvas.camera,
    viewport: canvas.viewport,
    nodes: canvas.order.map((id) => canvas.nodes[id]!),
    hidden: canvas.hidden
});

/* What the window has in front of a person: nothing at all while another window has the focus. */
export const seenNodes = (windowFocused: boolean, perView: readonly (readonly string[])[]): Set<string> => new Set(windowFocused ? perView.flat() : []);

/* True while this window has the keyboard. A window behind another one is not being looked at. */
const windowFocused = (): boolean => typeof document !== 'undefined' && document.hasFocus();

// All grid cells are visible; standalone sessions need no camera test, while canvases use `readableNodes`.
export const nodesInSight = (): string[][] => {
    const { views, layout } = useDocument.getState();
    const onScreen = new Set(layout === null ? [] : viewIdsIn(layout));
    return views.flatMap((view) => {
        if (!onScreen.has(view.id)) {
            return [];
        }
        if (isSessionView(view)) {
            return [[view.id]];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        const canvas = liveCanvas(view.id);
        if (canvas === null) {
            return [];
        }
        return [readableNodes(sightOf(canvas))];
    });
};

/*
 * The nodes a person is looking at right now. Empty while the window is behind another one, so a
 * node that was on screen when the window went away counts as unseen from that moment.
 */
export const seenNodeIds = (): Set<string> => seenNodes(windowFocused(), nodesInSight());
