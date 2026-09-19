import { pool } from '@/transport';
import type { Transport } from './transport';

export interface LinkWatch {
    /*
     * Asks the machine what this watch cannot be told. It runs on an open link and again after every
     * reconnect, never on a closed one, since what changed while the socket was down was pushed to nobody.
     */
    onOpen?: () => void;
    /* Everything this watch listens to for as long as the link is in the pool, as the calls that end it. */
    subscriptions: (() => void)[];
}

/* What a watch asks of the pool, so a test can hand it links without opening a socket. */
export interface WatchablePool {
    ids(): string[];
    peek(endpointId: string): Transport | null;
    subscribe(handler: () => void): () => void;
}

/*
 * One watch over every link the pool holds, opened as a link turns up and ended as it goes. Nothing
 * here opens a link: a watch follows the sockets a hold already brought up.
 */
export const watchPool = (attach: (link: Transport, endpointId: string) => LinkWatch, source: WatchablePool = pool): (() => void) => {
    const watching = new Map<string, () => void>();

    const sync = (): void => {
        const ids = new Set(source.ids());
        for (const [endpointId, stop] of watching) {
            if (!ids.has(endpointId)) {
                stop();
                watching.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            const link = watching.has(endpointId) ? null : source.peek(endpointId);
            if (!link) {
                continue;
            }
            const watch = attach(link, endpointId);
            const offStatus = link.subscribeStatus((status) => {
                if (status === 'open') {
                    watch.onOpen?.();
                }
            });
            if (link.status === 'open') {
                watch.onOpen?.();
            }
            watching.set(endpointId, () => {
                offStatus();
                for (const off of watch.subscriptions) {
                    off();
                }
            });
        }
    };

    sync();
    const offPool = source.subscribe(sync);
    return () => {
        offPool();
        for (const stop of watching.values()) {
            stop();
        }
        watching.clear();
    };
};
