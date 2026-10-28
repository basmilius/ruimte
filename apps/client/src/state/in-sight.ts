import { isCanvasView, isDesignView, isSessionView, type ProjectNode, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { READABLE_ZOOM } from '@/canvas/culling';
import { activeDesignChat, placeOfView, shownChatOfNode, useDesignChat } from '@/design/design-chat';
import { intersects, isMeasured, visibleRect, type Camera, type Rect } from '@/canvas/math';
import { shownViewIdsIn } from '@/shell/split';
import { liveCanvas, maximizedNodeOf, type CanvasNode, type CanvasState } from '@/state/canvas';
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
    /* The node maximized over the canvas at actual size, which covers everything else on it. */
    maximized?: string | null;
}

/*
 * The uncollapsed nodes inside the exact viewport, never the renderer's wider culling area. `readable`
 * also asks that the camera be close enough to read them, which is what "a person saw this" means and
 * so what attention counts. An agent asking what is on the canvas passes it false on purpose: it reads
 * the node's own title and content rather than the pixels, so a zoomed-out canvas is not blind to it.
 */
export function visibleNodes(canvas: CanvasSight, { readable }: { readable: boolean }): string[] {
    if (!isMeasured(canvas.viewport)) {
        return [];
    }
    if (canvas.maximized) {
        return [canvas.maximized];
    }
    if (readable && canvas.camera.zoom < READABLE_ZOOM) {
        return [];
    }
    const rect = visibleRect(canvas.camera, canvas.viewport);
    return canvas.nodes.filter((node) => canvas.hidden?.has(node.id) !== true && intersects(node, rect)).map((node) => node.id);
}

export function readableNodes(canvas: CanvasSight): string[] {
    return visibleNodes(canvas, { readable: true });
}

/* An open canvas as the question about sight: a store keys its nodes, a sight lists them in order. */
export function sightOf(canvas: CanvasState): CanvasSight & { nodes: readonly CanvasNode[] } {
    return {
        camera: canvas.camera,
        viewport: canvas.viewport,
        nodes: canvas.order.map((id) => canvas.nodes[id]!),
        hidden: canvas.hidden,
        maximized: maximizedNodeOf(canvas)
    };
}

/* What the window has in front of a person: nothing at all while another window has the focus. */
export function seenNodes(windowFocused: boolean, perView: readonly (readonly string[])[]): Set<string> {
    return new Set(windowFocused ? perView.flat() : []);
}

/* True while this window has the keyboard. A window behind another one is not being looked at. */
function windowFocused(): boolean {
    return typeof document !== 'undefined' && document.hasFocus();
}

/* One canvas as a question about sight, with what a node needs to say which chat it shows. */
export interface NodeSightCanvas extends CanvasSight {
    nodes: readonly (Rect & { id: string; kind: string; chats?: ProjectNode['chats'] })[];
}

/* What `nodesInSightOf` reads of a workspace, handed in so a test builds one without a store. */
export interface NodeSightWorkspace {
    views: readonly ProjectView[];
    layout: SplitLayout | null;
    canvasOf(viewId: string): NodeSightCanvas | null;
}

/*
 * All grid cells are visible; standalone sessions need no camera test, while canvases use `readableNodes`.
 * A design is in sight as the chat it shows, so a later chat is seen while it is in front and its
 * siblings behind the picker are not.
 */
export function nodesInSightOf(workspace: NodeSightWorkspace): string[][] {
    const onScreen = new Set(workspace.layout === null ? [] : shownViewIdsIn(workspace.layout));
    return workspace.views.flatMap((view) => {
        if (!onScreen.has(view.id)) {
            return [];
        }
        if (isDesignView(view)) {
            return [[activeDesignChat(placeOfView(view), useDesignChat.getState().picked)]];
        }
        if (isSessionView(view)) {
            return [[view.id]];
        }
        const canvas = isCanvasView(view) ? workspace.canvasOf(view.id) : null;
        if (canvas === null) {
            return [];
        }
        const nodes = new Map(canvas.nodes.map((node) => [node.id, node]));
        return [readableNodes(canvas).map((id) => shownChatOfNode(nodes.get(id) ?? { id, kind: 'unknown' }) ?? id)];
    });
}

export function nodesInSight(): string[][] {
    const { views, layout } = useDocument.getState();
    return nodesInSightOf({
        views,
        layout,
        canvasOf: (viewId) => {
            const canvas = liveCanvas(viewId);
            return canvas === null ? null : sightOf(canvas);
        }
    });
}

/*
 * The nodes a person is looking at right now. Empty while the window is behind another one, so a
 * node that was on screen when the window went away counts as unseen from that moment.
 */
export function seenNodeIds(): Set<string> {
    return seenNodes(windowFocused(), nodesInSight());
}
