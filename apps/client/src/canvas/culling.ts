import { useEffect, useState } from 'react';
import { intersects } from '@/canvas/math';
import { useCanvas } from '@/state/canvas';

/* Screen pixels around the viewport that still count as visible, so an edge does not flicker. */
const VIEW_MARGIN = 96;
/* How long a node stays live after leaving the viewport; a pan across it never thrashes. */
const OFFSCREEN_GRACE_MS = 10_000;

export const useNodeInViewport = (id: string): boolean =>
    useCanvas((s) => {
        const node = s.nodes[id];
        if (!node || s.viewport.w === 0) {
            return true;
        }
        const margin = VIEW_MARGIN / s.camera.zoom;
        const view = {
            x: -s.camera.x / s.camera.zoom - margin,
            y: -s.camera.y / s.camera.zoom - margin,
            w: s.viewport.w / s.camera.zoom + margin * 2,
            h: s.viewport.h / s.camera.zoom + margin * 2
        };
        return intersects(node, view);
    });

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
