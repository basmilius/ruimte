export type Listener = () => void;

export function subscribe(listeners: Set<Listener>, listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/* Over a copy, so a listener that unsubscribes itself does not skip the next one. */
export function emit(listeners: Set<Listener>): void {
    for (const listener of [...listeners]) {
        listener();
    }
}
