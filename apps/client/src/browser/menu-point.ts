export interface HostRect {
    left: number;
    top: number;
}

export interface MenuPoint {
    window: { x: number; y: number };
    guest: { x: number; y: number };
}

/*
 * Electron reports a webview context menu in embedder-window coordinates. Guest actions need that
 * point translated from the scaled host back into the guest's unscaled CSS pixels.
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
