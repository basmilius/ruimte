/*
 * When an agent last asked something of a page this client holds (`browser/page-hold.ts`), by the page's
 * key. The ask names the page and not the agent, so a pet finds its pages by the lines between them.
 * Only this window's pages, kept for the page: nothing here outlives a reload.
 */
const asks = new Map<string, number>();
const listeners = new Set<() => void>();

export function notePageAsk(pageKey: string, at: number): void {
    asks.set(pageKey, at);

    for (const listener of [...listeners]) {
        listener();
    }
}

export function lastPageAsk(pageKey: string): number | undefined {
    return asks.get(pageKey);
}

export function subscribePageAsks(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
