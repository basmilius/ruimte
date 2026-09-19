import { useProcessWarnings } from '@/state/processes';
import { watchPool } from '@/transport/pool-watch';

/*
 * The process warnings of every machine this client holds a socket for, panel open or not: they are
 * what puts a dot on a node and on its sidebar row. The daemon pushes a change to every socket; a
 * socket that opens asks once, since what changed while it was closed was pushed to nobody.
 */
export const startProcessWarnings = (): (() => void) =>
    watchPool((link, endpointId) => ({
        onOpen: () => {
            // A daemon older than the panel does not know the request; it simply has no warnings.
            link.request('processes.listAlerts', {})
                .then((result) => useProcessWarnings.getState().setAlerts(endpointId, result.alerts))
                .catch(() => undefined);
        },
        subscriptions: [link.on('processes.alerts', (payload) => useProcessWarnings.getState().setAlerts(endpointId, payload.alerts))]
    }));
