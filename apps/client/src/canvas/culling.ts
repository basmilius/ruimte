import { useEffect, useState } from 'react';
import { intersects, isMeasured, visibleRect } from '@/canvas-model/math';
import { rendersAtZoom } from '@/canvas-model/render-distance';
import { maximizedNodeOf, useCanvasCamera, type CanvasState } from '@/state/canvas';
import { useSettings } from '@/state/settings';

export { useNodeInViewport, VIEW_MARGIN, visibleNodeIds } from '@/state/node-in-view';

/* How long a node stays live after leaving the viewport; a pan across it never thrashes. */
const OFFSCREEN_GRACE_MS = 10_000;

/*
 * Whether the camera is close enough for the costly bodies (a file, a diagram, a device, a chat or a terminal) to draw live,
 * by the render distance this client chose. Below it a body shows its plate; chats and terminals
 * keep their active body and wait through the hold before hiding. A canvas full of files can keep
 * moving because those editors stop drawing; what costs nothing to draw ignores it. One boolean per canvas, so a node
 * renders when the camera crosses the line and not on every frame of a zoom. Attention keeps a line of
 * its own (`SEEN_ZOOM`), since this one is about what the machine can carry, not what a person can read.
 */
export function useRenderZoom(): boolean {
    const distance = useSettings((s) => s.canvasRenderDistance);
    return useCanvasCamera((s) => rendersAtZoom(distance, s.camera.zoom));
}

/* Holds a live surface across brief pans or zooms, so it does not repeatedly rebuild. */
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
