type PageAskListener = (pageKey: string, at: number) => void;

const listeners = new Set<PageAskListener>();

/* An agent asked something of a page this client holds. Built-ins listen, so the browser knows none of them. */
export function reportPageAsk(pageKey: string, at: number): void {
    for (const listener of [...listeners]) {
        listener(pageKey, at);
    }
}

export function onPageAsk(listener: PageAskListener): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
