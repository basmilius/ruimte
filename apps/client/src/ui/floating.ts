/*
 * Menus, selects, popovers, tooltips and dialogs are portaled to <body>, outside the node that
 * opened them, but React still routes their events through that node's place in the React tree.
 * The canvas asks whether a target sits inside the focused node and, for a portaled popup, gets no.
 * Without this check a press on a popup reads as a press on empty canvas, which ends node mode and
 * captures the pointer, so the popup never sees the click that follows.
 *
 * `[data-base-ui-portal]` is the root every Base UI portal renders. The classes cover the layers
 * `styles.css` defines, so a floating layer that is not Base UI's is caught as well.
 */
const FLOATING_LAYERS = '[data-base-ui-portal], .popup-layer, .tooltip-popup, .dialog-popup, .dialog-backdrop';

/**
 * Whether an event target sits inside a floating layer, and so belongs to whatever opened it
 * rather than to the canvas the portal happens to render next to.
 */
export const isInFloatingLayer = (target: EventTarget | null): boolean => target instanceof Element && target.closest(FLOATING_LAYERS) !== null;
