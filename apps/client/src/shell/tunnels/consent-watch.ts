import { machineMode } from '@/desktop/bridge';
import { useConsent } from '@/state/consent';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { pool } from '@/transport';
import { machineAnswers } from '@/transport/features';
import { watchPool, type LinkWatch, type WatchablePool } from '@/transport/pool-watch';

/*
 * The clients elsewhere that wait for approval on the machine this app runs, and only there: the local secret answers the
 * list, and a window on another machine has nobody to approve for. The machine says when the list moved; the window asks again.
 */
export function startConsentWatch(source: WatchablePool = pool): () => void {
    return watchPool((link, endpointId): LinkWatch => {
        if (endpointId !== LOCAL_ENDPOINT_ID || machineMode() !== 'local') {
            return { subscriptions: [] };
        }

        const load = (): void => {
            if (!machineAnswers(link.connection, 'consent.list')) {
                return;
            }

            link.request('consent.list', {})
                .then((answer) => useConsent.getState().setRequests(answer.requests))
                .catch(() => undefined);
        };

        return { onOpen: load, subscriptions: [link.on('consent.changed', load), () => useConsent.getState().setRequests([])] };
    }, source);
}
