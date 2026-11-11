/*
 * How what is drawn over a canvas finds what is around it: the dock, which it may stand on, and what it
 * walks around, such as the minimap.
 */
export const OVERLAY_LEDGE_ATTRIBUTE = 'data-overlay-ledge';
export const OVERLAY_WALL_ATTRIBUTE = 'data-overlay-wall';

/*
 * The same as the extension API documents it (`defineCanvasOverlay`): `ledge` on what may be stood on, `wall` on what is
 * only walked up to, found under the box marked `CANVAS_OVERLAY_ATTRIBUTE` that a canvas's overlay is drawn in.
 */
export const CANVAS_FLOOR_ATTRIBUTE = 'data-canvas-floor';
// Set by `surface/CellOverlay.tsx`, which sits below this folder and so names it itself.
export const CANVAS_OVERLAY_ATTRIBUTE = 'data-canvas-overlay';
