/*
 * How what is drawn over a canvas finds what is around it, as the extension API documents it (`defineCanvasOverlay`):
 * `ledge` on what may be stood on, such as the dock, `wall` on what is only walked up to, such as the minimap, found
 * under the box marked `CANVAS_OVERLAY_ATTRIBUTE` that a canvas's overlay is drawn in.
 */
export const CANVAS_FLOOR_ATTRIBUTE = 'data-canvas-floor';
// Set by `surface/CellOverlay.tsx`, which sits below this folder and so names it itself.
export const CANVAS_OVERLAY_ATTRIBUTE = 'data-canvas-overlay';
