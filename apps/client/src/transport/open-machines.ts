import type { ConnectionState } from './transport';

/* What the watch reads of the pool, so a test can hand it a pool in memory. */
export interface OpenMachineSource {
    ids(): string[];
    statusOf(endpointId: string): ConnectionState;
    subscribe(handler: () => void): () => void;
    /* Listens for `endpoint.changed` on a machine's link; null when it has none. */
    onChanged(endpointId: string, handler: () => void): (() => void) | null;
}

/*
 * Calls `load` for every machine whose link opens, once per time it opens, and again whenever that
 * machine says it changed. Every open machine rather than the active one, since what a machine says
 * about itself feeds lists of every machine (its icon, its broker, the key its account record is
 * compared on), and a machine that is not active would otherwise answer only after a switch to it.
 */
export const watchOpenMachines = (source: OpenMachineSource, load: (endpointId: string) => void): (() => void) => {
    const open = new Set<string>();
    const changed = new Map<string, () => void>();

    const sync = (): void => {
        const ids = new Set(source.ids());
        for (const endpointId of [...open]) {
            if (!ids.has(endpointId)) {
                open.delete(endpointId);
            }
        }
        for (const [endpointId, off] of changed) {
            if (!ids.has(endpointId)) {
                off();
                changed.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            if (!changed.has(endpointId)) {
                const off = source.onChanged(endpointId, () => load(endpointId));
                if (off) {
                    changed.set(endpointId, off);
                }
            }
            if (source.statusOf(endpointId).status !== 'open') {
                open.delete(endpointId);
            } else if (!open.has(endpointId)) {
                open.add(endpointId);
                load(endpointId);
            }
        }
    };

    sync();
    const off = source.subscribe(sync);
    return () => {
        off();
        for (const stop of changed.values()) {
            stop();
        }
        changed.clear();
    };
};
