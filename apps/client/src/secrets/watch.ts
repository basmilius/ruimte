import { useSecrets } from '@/secrets/secrets';
import { pool } from '@/transport';
import { joinWatches, snapshotWatch, watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The secret cards of every machine this client holds a socket for. The daemon tells every socket the
 * whole list whenever it changes; a socket that opens asks once.
 */
export function startSecretWatch(source: WatchablePool = pool): () => void {
    return watchPool(
        (link, endpointId) =>
            joinWatches(
                snapshotWatch(link, 'secret.requests', 'secret.requests', (payload) => useSecrets.getState().setRequests(endpointId, payload.requests)),
                { subscriptions: [() => useSecrets.getState().forget(endpointId)] }
            ),
        source
    );
}
