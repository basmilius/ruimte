// Portals sit outside their focused canvas node; treating them as canvas clicks would steal their pointer event.
const FLOATING_LAYERS = '[data-base-ui-portal], .popup-layer, .tooltip-popup, .dialog-popup, .dialog-backdrop';

export const isInFloatingLayer = (target: EventTarget | null): boolean => target instanceof Element && target.closest(FLOATING_LAYERS) !== null;

/* A popup is portaled out of its trigger's element but not out of React's tree, so its events still bubble to that trigger. */
export const cameThroughPortal = (event: { currentTarget: Element; target: EventTarget }): boolean =>
    !(event.target instanceof Node && event.currentTarget.contains(event.target));
