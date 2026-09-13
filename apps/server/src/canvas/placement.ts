export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

// The room between a node and the one placed next to it; a multiple of the client's 8 px grid.
export const PLACEMENT_GAP = 40;

const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w + PLACEMENT_GAP && b.x < a.x + a.w + PLACEMENT_GAP && a.y < b.y + b.h + PLACEMENT_GAP && b.y < a.y + a.h + PLACEMENT_GAP;

/* Right of the anchor, top edges level, whatever is there already: the caller named the anchor. */
export const placeBeside = (anchor: Rect, size: { w: number; h: number }): Rect => ({
    x: Math.round(anchor.x + anchor.w + PLACEMENT_GAP),
    y: Math.round(anchor.y),
    ...size
});

/*
 * Where a node lands without an anchor that was asked for. Next to the caller it walks right past
 * whatever is in the way, so an agent that adds three nodes gets a row beside itself; without a
 * caller on the canvas it goes right of everything, which cannot overlap anything.
 */
export const placeFree = (existing: readonly Rect[], size: { w: number; h: number }, caller: Rect | null): Rect => {
    if (caller) {
        const spot = { ...placeBeside(caller, size) };
        for (;;) {
            const blocking = existing.filter((rect) => overlaps(spot, rect));
            if (blocking.length === 0) {
                return spot;
            }
            spot.x = Math.round(Math.max(...blocking.map((rect) => rect.x + rect.w)) + PLACEMENT_GAP);
        }
    }
    if (existing.length === 0) {
        return { x: 0, y: 0, ...size };
    }
    return {
        x: Math.round(Math.max(...existing.map((rect) => rect.x + rect.w)) + PLACEMENT_GAP),
        y: Math.round(Math.min(...existing.map((rect) => rect.y))),
        ...size
    };
};
