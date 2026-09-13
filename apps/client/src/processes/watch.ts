import { useProcessWarnings } from '@/state/processes';
import { pool } from '@/transport';

/*
 * The process warnings of every machine this client holds a socket for, panel open or not: they are
 * what puts a dot on a node and on its sidebar row. The daemon pushes a change to every socket; a
 * socket that opens asks once, since what changed while it was closed was pushed to nobody.
 */
export const startProcessWarnings = (): (() => void) => {
    const watching = new Map<string, () => void>();

    const sync = (): void => {
        const ids = new Set(pool.ids());
        for (const [endpointId, stop] of watching) {
            if (!ids.has(endpointId)) {
                stop();
                watching.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            const link = watching.has(endpointId) ? null : pool.peek(endpointId);
            if (!link) {
                continue;
            }
            const ask = (): void => {
                // A daemon older than the panel does not know the request; it simply has no warnings.
                link.request('processes.listAlerts', {})
                    .then((result) => useProcessWarnings.getState().setAlerts(endpointId, result.alerts))
                    .catch(() => undefined);
            };
            if (link.status === 'open') {
                ask();
            }
            const offAlerts = link.on('processes.alerts', (payload) => useProcessWarnings.getState().setAlerts(endpointId, payload.alerts));
            const offStatus = link.subscribeStatus((status) => {
                if (status === 'open') {
                    ask();
                }
            });
            watching.set(endpointId, () => {
                offAlerts();
                offStatus();
            });
        }
    };

    sync();
    const off = pool.subscribe(sync);
    return () => {
        off();
        for (const stop of watching.values()) {
            stop();
        }
        watching.clear();
    };
};
