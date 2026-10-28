import { rendersAtZoom, type RenderDistance } from '@/canvas/render-distance';

/* How long the camera stays past the line before a page lets go of the screen, so a zoom that only passes it never flickers. */
export const FAR_AFTER_MS = 400;

export interface PageDistance {
    zoom: number;
    distance: RenderDistance;
    /* The node fills the canvas at actual size. */
    maximized: boolean;
    /* False for a browser that is a view of its own, which has no camera. */
    onCanvas: boolean;
    /* The node has the keyboard (`bodyFocusId`). */
    active: boolean;
    /* A pinch, a pan or a drag is under way. */
    gesturing: boolean;
    /* The page already went far, or is on its way there. */
    wasFar: boolean;
    /* Since when the camera has been past the line, or null while it is not. */
    belowSince: number | null;
    now: number;
}

/*
 * Whether a page on a canvas lets go of the screen and shows its plate. Only the distance is decided
 * here: whatever already hides a page (a hidden or folded node, a background tab, another node
 * maximized, the holes cut for nodes on top) goes first, and the caller asks this only of a page that
 * would otherwise be drawn.
 *
 * The active page stays live: someone typing in it who zooms out for a moment keeps what they were
 * filling in. Back on the line or closer, a page comes back at once; past it, it goes only once the
 * camera rested there for `FAR_AFTER_MS` with no gesture running.
 */
export function pageFar(page: PageDistance): boolean {
    if (!page.onCanvas || page.maximized || page.active || rendersAtZoom(page.distance, page.zoom)) {
        return false;
    }
    if (page.wasFar) {
        return true;
    }
    return !page.gesturing && page.belowSince !== null && page.now - page.belowSince >= FAR_AFTER_MS;
}

/* The moment the camera went past the line, kept while it stays there. */
export function belowSinceOf(previous: number | null, below: boolean, now: number): number | null {
    if (!below) {
        return null;
    }
    return previous ?? now;
}
