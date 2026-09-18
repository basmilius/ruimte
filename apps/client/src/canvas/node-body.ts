/*
 * The keystroke or the press happened inside a node's content, which the frame marks with
 * `data-node-body`. With the selection as the only state a canvas has, that is what tells a press
 * meant for a terminal or a thread from one meant for the canvas around it.
 */
export const isInNodeBody = (el: EventTarget | null): boolean => el instanceof HTMLElement && el.closest('[data-node-body]') !== null;
