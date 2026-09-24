import { create } from 'zustand';
import { useEndpoints } from '@/state/endpoints';
import { pool } from '@/transport';
import { PingMonitor } from './ping-monitor';

interface PingStore {
    /* Round trip of the last answered `server.ping` per daemon, in ms; null while it is unknown. */
    byEndpoint: Record<string, number | null>;
    setLatency(endpointId: string, latency: number | null): void;
}

export const usePing = create<PingStore>((set, get) => ({
    byEndpoint: {},
    setLatency(endpointId, latency) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: latency } });
    }
}));

/* What the round trip to one machine is, as a component reads it. */
export const useLatency = (endpointId: string): number | null => usePing((s) => s.byEndpoint[endpointId] ?? null);

const monitors = new Map<string, PingMonitor>();

const start = (endpointId: string): void => {
    const monitor = new PingMonitor({
        // The reply carries the daemon's clock, which two machines never share; only the round trip is ours to read.
        send: () => pool.peek(endpointId)?.request('server.ping', {}) ?? Promise.reject(new Error('no socket')),
        report: (latency) => usePing.getState().setLatency(endpointId, latency),
        // A socket can stay open for minutes after sleep or a network change while nothing reaches the daemon.
        stalled: () => pool.reconnect(endpointId)
    });
    monitors.set(endpointId, monitor);
    monitor.start();
};

/* One measurement loop per daemon that answers. A latency belongs to a machine, not to the client. */
const sync = (): void => {
    for (const [endpointId, monitor] of [...monitors]) {
        if (pool.statusOf(endpointId).status !== 'open') {
            monitor.stop();
            monitors.delete(endpointId);
        }
    }
    for (const endpointId of pool.ids()) {
        if (!monitors.has(endpointId) && pool.statusOf(endpointId).status === 'open') {
            start(endpointId);
        }
    }
};

/* Measures while a socket is open, and never while it is not. A closed socket has nothing to time. */
export const startPing = (): (() => void) => {
    const unsubscribe = pool.subscribe(sync);
    sync();
    return () => {
        unsubscribe();
        for (const monitor of monitors.values()) {
            monitor.stop();
        }
        monitors.clear();
    };
};

/* An extra measurement of the active machine, for whoever is about to read the value. */
export const pingNow = (): void => {
    void monitors.get(useEndpoints.getState().activeId)?.measure();
};
