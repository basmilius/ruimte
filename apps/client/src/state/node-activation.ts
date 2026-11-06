/*
 * A person opened a node: clicked it on a canvas, or picked it in the sidebar. Kept apart from the canvas
 * store, so what listens (`node-activity.ts`) never has to be imported by it.
 */
const listeners = new Set<(nodeId: string) => void>();

export function announceActivation(nodeId: string): void {
    for (const listener of listeners) {
        listener(nodeId);
    }
}

export function onNodeActivated(listener: (nodeId: string) => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
