import { isMeasured } from '@/canvas/math';
import type { NodeKind } from '@/state/canvas';

/* The nodes an empty canvas draws as ghosts: outlines of what is not there yet. */
export type GhostKind = Extract<NodeKind, 'chat' | 'terminal' | 'browser' | 'note'>;

export interface GhostFrame {
    x: number;
    y: number;
    w: number;
    h: number;
}

/* The group of ghosts, in canvas units on the 8px grid. */
export const GHOST_AREA = { w: 792, h: 312 };

export const GHOST_FRAMES: Record<GhostKind, GhostFrame> = {
    chat: { x: 0, y: 0, w: 432, h: 312 },
    terminal: { x: 456, y: 0, w: 336, h: 144 },
    browser: { x: 456, y: 168, w: 156, h: 144 },
    note: { x: 636, y: 168, w: 156, h: 144 }
};

/* How long the other ghosts take to fade once a node lands, and how long the node takes to grow out of its ghost. */
export const GHOST_FADE_MS = 220;
export const LANDING_MS = 360;
export const LANDING_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/* The screen pixels the hint and the dock keep free around the group. */
const ROOM = { x: 48, y: 200 };

/* A small cell shows the group smaller, the way zoom-to-fit would, and never scrolls it. */
export function ghostScale(viewport: { w: number; h: number }): number {
    if (!isMeasured(viewport)) {
        return 1;
    }

    return Math.max(0, Math.min(1, (viewport.w - ROOM.x) / GHOST_AREA.w, (viewport.h - ROOM.y) / GHOST_AREA.h));
}

export function isGhostKind(kind: string): kind is GhostKind {
    return Object.hasOwn(GHOST_FRAMES, kind);
}
