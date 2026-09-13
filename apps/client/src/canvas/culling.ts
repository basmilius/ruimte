import { useEffect, useState } from 'react';
import { intersects, visibleRect } from '@/canvas/math';
import { useCanvas } from '@/state/canvas';

/* Screen pixels around the viewport that still count as visible, so an edge does not flicker. */
export const VIEW_MARGIN = 96;
/* How long a node stays live after leaving the viewport; a pan across it never thrashes. */
const OFFSCREEN_GRACE_MS = 10_000;

export const useNodeInViewport = (id: string): boolean =>
    useCanvas((s) => {
        const node = s.nodes[id];
        if (!node || s.viewport.w === 0) {
            return true;
        }
        return intersects(node, visibleRect(s.camera, s.viewport, VIEW_MARGIN));
    });

/*
 * Under this a node is a few dozen pixels tall, a shape on the canvas rather than something anyone
 * is reading. What costs nothing to draw ignores it; a body that costs a read and a syntax
 * highlighter shows its plate instead, which is what keeps a canvas full of files moving.
 */
export const READABLE_ZOOM = 0.4;

export const useReadableZoom = (): boolean => useCanvas((s) => s.camera.zoom >= READABLE_ZOOM);

/* True while visible and for a grace period after; the caller unmounts the live view when it turns false. */
export const useHeldWhileVisible = (visible: boolean): boolean => {
    const [held, setHeld] = useState(true);
    // Re-arming the hold is derived while rendering: an effect would cost an extra render each time.
    if (visible && !held) {
        setHeld(true);
    }
    useEffect(() => {
        if (visible) {
            return;
        }
        const timer = window.setTimeout(() => setHeld(false), OFFSCREEN_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [visible]);
    return visible || held;
};
