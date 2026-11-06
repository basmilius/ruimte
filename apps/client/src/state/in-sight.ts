import { isCanvasView, isChatHostView, isDesignView, isSessionView, type ProjectNode, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { intersects, isMeasured, visibleRect, type Camera, type Rect } from '@/canvas-model/math';
import { shownViewIdsIn } from '@/layout/split';
import { liveCanvas, maximizedNodeOf, type CanvasNode, type CanvasState } from '@/state/canvas';
import { activeDesignChat, placeOfView, shownChatOfNode, useDesignChat } from '@/state/design-chat';
import { useDocument } from '@/state/document';

/*
 * What a person has in front of them, as one answer the marks, the counters and the notifications
 * all read. Kept apart from `state/attention.ts` so anything that announces something can ask about
 * the node it is about without importing the watcher that announces it.
 */

/*
 * Under this a node is a few dozen pixels tall, a shape on the canvas rather than something anyone is
 * reading, so it does not count as seen. Fixed on purpose: the render distance a person sets is about
 * what their machine can draw and moves only further out than this (`canvas/render-distance.ts`), so
 * a node that counts as seen is always drawn live, and a faster machine never marks more as read.
 */
export const SEEN_ZOOM = 0.4;

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
    if (readable && canvas.camera.zoom < SEEN_ZOOM) {
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
export interface SightCanvas extends CanvasSight {
    nodes: readonly (Rect & { id: string; kind: string; chats?: ProjectNode['chats'] })[];
}

/* What the questions about sight read of a workspace, handed in so a test builds one without a store. */
export interface SightWorkspace {
    views: readonly ProjectView[];
    layout: SplitLayout | null;
    canvasOf(viewId: string): SightCanvas | null;
}

/* A view on screen as the questions about sight see it. */
type SightedView = { kind: 'design'; chat: string } | { kind: 'session'; view: ProjectView } | { kind: 'canvas'; canvas: SightCanvas };

/*
 * The one walk over what is on screen, which the marks, the notifications and the plan panel all read.
 * All grid cells are visible. A design is in sight as the chat it shows, so a later chat is seen while it
 * is in front and its siblings behind the picker are not.
 */
function sightedViews(workspace: SightWorkspace): SightedView[] {
    const onScreen = new Set(workspace.layout === null ? [] : shownViewIdsIn(workspace.layout));
    return workspace.views.flatMap((view): SightedView[] => {
        if (!onScreen.has(view.id)) {
            return [];
        }
        if (isDesignView(view)) {
            return [{ kind: 'design', chat: activeDesignChat(placeOfView(view), useDesignChat.getState().picked) }];
        }
        if (isSessionView(view)) {
            return [{ kind: 'session', view }];
        }
        const canvas = isCanvasView(view) ? workspace.canvasOf(view.id) : null;
        return canvas === null ? [] : [{ kind: 'canvas', canvas }];
    });
}

/* Standalone sessions need no camera test, while canvases use `readableNodes`. */
export function nodesInSightOf(workspace: SightWorkspace): string[][] {
    return sightedViews(workspace).map((sighted) => {
        if (sighted.kind === 'design') {
            return [sighted.chat];
        }
        if (sighted.kind === 'session') {
            return [sighted.view.id];
        }
        const nodes = new Map(sighted.canvas.nodes.map((node) => [node.id, node]));
        return readableNodes(sighted.canvas).map((id) => shownChatOfNode(nodes.get(id) ?? { id, kind: 'unknown' }) ?? id);
    });
}

/*
 * The chats on screen for the plan panel, which ignores zoom and window focus. It also uses the pre-panel
 * viewport so opening the panel cannot push its own chat out of sight and immediately close it.
 */
export function chatsInSight(workspace: SightWorkspace, { planWidth }: { planWidth: number }): Set<string> {
    const chats = new Set<string>();
    for (const sighted of sightedViews(workspace)) {
        if (sighted.kind === 'design') {
            chats.add(sighted.chat);
            continue;
        }
        if (sighted.kind === 'session') {
            if (isChatHostView(sighted.view)) {
                chats.add(sighted.view.id);
            }
            continue;
        }
        const { canvas } = sighted;
        if (!isMeasured(canvas.viewport)) {
            continue;
        }
        const rect = visibleRect(canvas.camera, { w: canvas.viewport.w + planWidth, h: canvas.viewport.h });
        for (const node of canvas.nodes) {
            const inFront = canvas.maximized ? node.id === canvas.maximized : canvas.hidden?.has(node.id) !== true && intersects(node, rect);
            const shown = inFront ? shownChatOfNode(node) : null;
            if (shown !== null) {
                chats.add(shown);
            }
        }
    }
    return chats;
}

/* The open project, as the questions about sight read it. */
export function liveSight(): SightWorkspace {
    const { views, layout } = useDocument.getState();
    return {
        views,
        layout,
        canvasOf: (viewId) => {
            const canvas = liveCanvas(viewId);
            return canvas === null ? null : sightOf(canvas);
        }
    };
}

export function nodesInSight(): string[][] {
    return nodesInSightOf(liveSight());
}

/*
 * The nodes a person is looking at right now. Empty while the window is behind another one, so a
 * node that was on screen when the window went away counts as unseen from that moment.
 */
export function seenNodeIds(): Set<string> {
    return seenNodes(windowFocused(), nodesInSight());
}
