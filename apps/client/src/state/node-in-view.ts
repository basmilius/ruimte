import type { Viewport } from '@/canvas-model/camera-slice';
import { intersects, visibleRect, type Camera } from '@/canvas-model/math';
import { useCanvasCamera, type CanvasNode } from '@/state/canvas';
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

export function useNodeInViewport(id: string): boolean {
    return useCanvasCamera((s) => !s.nodes[id] || s.viewport.w === 0 || visibleNodeIds(s.nodes, s.camera, s.viewport).has(id));
}
