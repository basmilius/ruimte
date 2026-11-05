import type { Transport } from '@/transport-api/transport';

/*
 * What a machine says about its language servers, as a snapshot a store reads with
 * `useSyncExternalStore`. A link that comes back after it was down asks for the standing answer again.
 */
export abstract class SnapshotTracker<T> {
    protected readonly transport: Transport;
    protected readonly subscriptions: Array<() => void> = [];
    protected snapshot: T;
    private readonly listeners = new Set<() => void>();
    private linkWasDown: boolean;

    constructor(transport: Transport, initial: T) {
        this.transport = transport;
        this.snapshot = initial;
        this.linkWasDown = transport.status !== 'open';
        this.subscriptions.push(
            transport.subscribeStatus((status) => {
                if (status !== 'open') {
                    this.linkWasDown = true;
                } else if (this.linkWasDown) {
                    this.linkWasDown = false;
                    void this.refresh().catch(() => undefined);
                }
            })
        );
    }

    abstract refresh(): Promise<void>;

    getSnapshot(): T {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        for (const unsubscribe of this.subscriptions.splice(0)) {
            unsubscribe();
        }
        this.listeners.clear();
    }

    protected replace(next: T): void {
        this.snapshot = next;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

/* The list with `item` in place of the entry `same` finds, or added at the end. */
export function upsert<T>(list: readonly T[], item: T, same: (candidate: T) => boolean): T[] {
    return list.some(same) ? list.map((candidate) => (same(candidate) ? item : candidate)) : [...list, item];
}
