import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isGhostKind, LANDING_EASING, LANDING_MS } from '@/canvas/empty-canvas';
import { useCanvasStore } from '@/state/canvas';

/*
 * The first node on a canvas grows out of its ghost, which the empty canvas keeps drawn while the
 * others fade. Its frame is animated in canvas units rather than scaled, so its content reflows.
 */
function landFromGhost(frame: HTMLElement, kind: string): void {
    const ghost = isGhostKind(kind) ? frame.closest('[data-canvas-surface]')?.querySelector(`[data-ghost="${kind}"]`) : null;

    if (!ghost || typeof frame.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    const from = ghost.getBoundingClientRect();
    const to = frame.getBoundingClientRect();

    // A frame the layout has not measured yet has nothing to grow from.
    if (to.width === 0 || frame.offsetWidth === 0) {
        return;
    }

    const zoom = to.width / frame.offsetWidth;
    const start = {
        left: `${frame.offsetLeft + (from.left - to.left) / zoom}px`,
        top: `${frame.offsetTop + (from.top - to.top) / zoom}px`,
        width: `${from.width / zoom}px`,
        height: `${from.height / zoom}px`
    };
    const end = { left: `${frame.offsetLeft}px`, top: `${frame.offsetTop}px`, width: `${frame.offsetWidth}px`, height: `${frame.offsetHeight}px` };

    frame.animate([start, end], { duration: LANDING_MS, easing: LANDING_EASING });
}

/* The ref of a node's frame, which grows out of its ghost when the node is the first on its canvas. */
export function useGhostLanding(): RefObject<HTMLDivElement | null> {
    const canvasStore = useCanvasStore();
    const frame = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const { order, nodes } = canvasStore.getState();
        const only = order.length === 1 ? nodes[order[0]!] : undefined;

        if (frame.current !== null && only !== undefined) {
            landFromGhost(frame.current, only.kind);
        }
    }, [canvasStore]);

    return frame;
}
