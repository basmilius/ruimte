import type { Viewport } from '@/canvas-model/camera-slice';
import { intersects, isMeasured, visibleRect, type Camera, type Rect } from '@/canvas-model/math';
import { useCanvasCamera, type CanvasNode, type CanvasState } from '@/state/canvas';
import { memoByIdentity } from '@/state/identity-memo';

/* Screen pixels around the viewport that still count as visible, so an edge does not flicker. */
export const VIEW_MARGIN = 96;

/* The nodes in sight, found once per camera: every node asks on every move of it and gets this one answer. */
export const visibleNodeIds = memoByIdentity((nodes: Record<string, CanvasNode>, camera: Camera, viewport: Viewport): ReadonlySet<string> => {
    const rect = visibleRect(camera, viewport, VIEW_MARGIN);
    return new Set(
        Object.values(nodes)
            .filter((node) => intersects(node, rect))
            .map((node) => node.id)
    );
});

/* Before a first measure every node counts as in sight; on a hidden canvas none does. */
export function nodeInViewport(s: Pick<CanvasState, 'nodes' | 'camera' | 'viewport' | 'viewportHidden'>, id: string): boolean {
    if (s.viewportHidden) {
        return false;
    }

    return !s.nodes[id] || s.viewport.w === 0 || visibleNodeIds(s.nodes, s.camera, s.viewport).has(id);
}

export function useNodeInViewport(id: string): boolean {
    return useCanvasCamera((s) => nodeInViewport(s, id));
}

/* Within a viewport past every edge, what a card beside a node needs to be drawn. */
export function nearViewport(s: Pick<CanvasState, 'camera' | 'viewport' | 'viewportHidden'>, rect: Rect): boolean {
    if (s.viewportHidden) {
        return false;
    }

    return !isMeasured(s.viewport) || intersects(rect, visibleRect(s.camera, s.viewport, Math.max(s.viewport.w, s.viewport.h)));
}
