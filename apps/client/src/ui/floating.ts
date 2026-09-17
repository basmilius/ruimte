// Portals sit outside their focused canvas node; treating them as canvas clicks would steal their pointer event.
const FLOATING_LAYERS = '[data-base-ui-portal], .popup-layer, .tooltip-popup, .dialog-popup, .dialog-backdrop';

export const isInFloatingLayer = (target: EventTarget | null): boolean => target instanceof Element && target.closest(FLOATING_LAYERS) !== null;
