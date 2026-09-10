/* The box a page's host ended up with, the part of `getBoundingClientRect` this needs. */
export interface HostRect {
    left: number;
    top: number;
}

export interface MenuPoint {
    /* Where the menu opens, in the window's coordinates: what `clientX`/`clientY` carry. */
    window: { x: number; y: number };
    /* The same click in the page's own coordinates, which is what a guest's commands take. */
    guest: { x: number; y: number };
}

/*
 * Where a right-click inside a browser page landed, in the two spaces the app needs it in.
 *
 * Electron reports a `<webview>` guest's `context-menu` in the coordinates of the window that
 * embeds it, not of the guest: a guest is composited into the embedder's surface, and Chromium
 * transforms the point into that root space before the event leaves the browser process. So the
 * window point is the reported point, whatever the host's place on screen is, and adding the
 * host's box on top moves the menu right by the sidebar and down by the toolbar.
 *
 * The guest point is the way back, for the rows the shell runs on the page itself (its own copy of
 * an image, the inspector). The host is drawn with `transform: scale(camera.zoom)` on the canvas
 * and one to one in a browser view, and the guest is laid out at the unscaled size, so the offset
 * from the host's corner divides by that scale. Whole pixels, because a page coordinate is one.
 */
export const menuPointFor = (params: { x: number; y: number }, hostRect: HostRect, zoom: number): MenuPoint => {
    const scale = zoom > 0 ? zoom : 1;
    return {
        window: { x: params.x, y: params.y },
        guest: {
            x: Math.round((params.x - hostRect.left) / scale),
            y: Math.round((params.y - hostRect.top) / scale)
        }
    };
};
