/* Tells a key or a press meant for a node's content (`data-node-body`) from one meant for the canvas around it. */
export function isInNodeBody(el: EventTarget | null): boolean {
    return el instanceof HTMLElement && el.closest('[data-node-body]') !== null;
}
