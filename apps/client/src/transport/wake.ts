import type { ConnectionState } from './transport';

/* The part of the pool a wake-up needs. */
export interface WakePool {
    ids(): string[];
    statusOf(endpointId: string): ConnectionState;
    reconnect(endpointId: string): void;
}

/*
 * The machines worth a new attempt right away: closed, or waiting out a backoff. One that is already
 * trying keeps its attempt, and one that is open is left alone; a link that died quietly is noticed by
 * its own liveness check.
 */
export const reconnectStale = (pool: WakePool): string[] => {
    const stale = pool.ids().filter((endpointId) => {
        const connection = pool.statusOf(endpointId);
        return connection.status === 'closed' || (connection.status === 'connecting' && connection.retryAt !== null);
    });
    for (const endpointId of stale) {
        pool.reconnect(endpointId);
    }
    return stale;
};

/*
 * Safari on iOS and iPadOS stops a page's timers and sockets while it is in the background or the
 * screen is locked. A backoff that was counting when that happened can still have half a minute to
 * go when the person comes back, so a page that turns visible tries again at once.
 */
export const startWakeReconnect = (
    pool: WakePool,
    doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document
): (() => void) => {
    const onChange = (): void => {
        if (doc.visibilityState === 'visible') {
            reconnectStale(pool);
        }
    };
    doc.addEventListener('visibilitychange', onChange);
    return () => doc.removeEventListener('visibilitychange', onChange);
};
