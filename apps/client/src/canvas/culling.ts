import { useEffect, useState } from 'react';
import type { Viewport } from '@/canvas/camera-slice';
import { intersects, isMeasured, visibleRect, type Camera } from '@/canvas/math';
import { maximizedNodeOf, useCanvas, type CanvasNode, type CanvasState } from '@/state/canvas';
import { memoByIdentity } from '@/state/identity-memo';
import { useSettings } from '@/state/settings';
import { rendersAtZoom } from '@/canvas/render-distance';

/* Screen pixels around the viewport that still count as visible, so an edge does not flicker. */
export const VIEW_MARGIN = 96;
/* How long a node stays live after leaving the viewport; a pan across it never thrashes. */
const OFFSCREEN_GRACE_MS = 10_000;

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
    return useCanvas((s) => !s.nodes[id] || s.viewport.w === 0 || visibleNodeIds(s.nodes, s.camera, s.viewport).has(id));
}

/*
 * Whether the camera is close enough for the costly bodies (a file, a diagram, a device) to draw live,
 * by the render distance this client chose. Below it such a body shows its plate, which is what keeps a
 * canvas full of files moving; what costs nothing to draw ignores it. One boolean per canvas, so a node
 * renders when the camera crosses the line and not on every frame of a zoom. Attention keeps a line of
 * its own (`SEEN_ZOOM`), since this one is about what the machine can carry, not what a person can read.
 */
export function useRenderZoom(): boolean {
    const distance = useSettings((s) => s.canvasRenderDistance);
    return useCanvas((s) => rendersAtZoom(distance, s.camera.zoom));
}

/* True while visible and for a grace period after; the caller unmounts the live view when it turns false. */
export function useHeldWhileVisible(visible: boolean): boolean {
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
}

/* Kinds whose frame holds nothing that lives without it: a file's editor already lets go of its document off screen, and an artifact or a routine is read again from the machine. */
const DRAWN_WHEN_NEAR: ReadonlySet<string> = new Set(['note', 'file', 'artifact', 'routine']);

/*
 * The nodes left out of the page for now: a note or a file further than a viewport past every edge,
 * which a pan never shows before it is drawn again. A node anyone acts on stays, and so does every
 * live kind, whose session, screen or page would go with it. As one string, so the canvas renders
 * when the set changes and not on every frame of the camera.
 */
export function farNodeKey(s: CanvasState): string {
    if (!isMeasured(s.viewport) || maximizedNodeOf(s) !== null) {
        return '';
    }
    const near = visibleRect(s.camera, s.viewport, Math.max(s.viewport.w, s.viewport.h));
    const far: string[] = [];
    for (const node of Object.values(s.nodes)) {
        if (DRAWN_WHEN_NEAR.has(node.kind) && !intersects(node, near) && !actedOn(s, node.id)) {
            far.push(node.id);
        }
    }
    return far.join('\n');
}

function actedOn(s: CanvasState, id: string): boolean {
    return (
        s.selection.includes(id) || s.bodyFocusId === id || s.resizing === id || s.navigationId === id || s.linkDraft?.from === id || s.linkDraft?.over === id
    );
}
