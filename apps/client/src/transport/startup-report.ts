import { USAGE_MAX_STARTUP_MS } from '@ruimte/pulsar';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { fireAndForget } from '@/transport-api/transport';
import { machineAnswers } from './features';
import { watchPool, type WatchablePool } from './pool-watch';

/*
 * Tells the machine this app runs how long the app took to its first connection, for the machine's
 * anonymous usage counts. The shell hands the number out once per start, so a second window sends none.
 */
export function startStartupReport(take = desktop()?.takeStartupMs, source?: WatchablePool): () => void {
    if (take === undefined) {
        return () => undefined;
    }
    let asked = false;
    return watchPool(
        (link, endpointId) => ({
            onOpen: () => {
                if (asked || endpointId !== LOCAL_ENDPOINT_ID || !machineAnswers(link.connection, 'usage.startup')) {
                    return;
                }
                asked = true;
                void fireAndForget(
                    'usage.startup',
                    take().then((ms) =>
                        ms !== null && ms >= 1 && ms <= USAGE_MAX_STARTUP_MS ? link.request('usage.startup', { ms: Math.round(ms) }) : undefined
                    )
                );
            },
            subscriptions: []
        }),
        source
    );
}
