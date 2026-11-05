/*
 * How far out a canvas keeps drawing its costly bodies live: a page, a file, a diagram and a device.
 * Below the line such a node shows its plate. Zooming out alone saves nothing, since Chromium still
 * draws a page at its own size under the camera's scale; only a body that stops drawing does.
 *
 * No distance is stricter than `standard`, which is the zoom attention counts as seen
 * (`SEEN_ZOOM` in `state/in-sight.ts`): a node a person counts as having seen is always drawn live.
 * Nothing sits between `far` and `unlimited` near 0.1 either, since the camera stops there
 * (`clampZoom` in `canvas/math.ts`) and such a distance would be `unlimited` under another name.
 */
export const RENDER_DISTANCES = ['standard', 'far', 'unlimited'] as const;

export type RenderDistance = (typeof RENDER_DISTANCES)[number];

export const RENDER_DISTANCE_ZOOM: Record<RenderDistance, number> = {
    standard: 0.4,
    far: 0.2,
    unlimited: 0
};

/* Anything a client stored that is no distance this version knows reads as the default. */
export function renderDistanceFrom(stored: unknown): RenderDistance {
    return RENDER_DISTANCES.find((distance) => distance === stored) ?? 'standard';
}

/* On the line itself the body stays live, so a camera resting exactly there never flips it. */
export function rendersAtZoom(distance: RenderDistance, zoom: number): boolean {
    return zoom >= RENDER_DISTANCE_ZOOM[distance];
}
