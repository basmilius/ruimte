import { create } from 'zustand';
import { transport } from '@/transport';
import { PingMonitor } from './ping-monitor';

interface PingStore {
    /* Round trip of the last answered `server.ping`, in ms; null while it is unknown. */
    latency: number | null;
    setLatency(latency: number | null): void;
}

export const usePing = create<PingStore>((set) => ({
    latency: null,
    setLatency(latency) {
        set({ latency });
    }
}));

const monitor = new PingMonitor({
    // The reply carries the daemon's clock, which two machines never share; only the round trip is ours to read.
    send: () => transport.request('server.ping', {}),
    report: (latency) => usePing.getState().setLatency(latency)
});

/* Measures while the socket is open, and never while it is not: a closed socket has nothing to time. */
export const startPing = (): (() => void) => {
    if (transport.status === 'open') {
        monitor.start();
    }
    const unsubscribe = transport.subscribeStatus((status) => {
        if (status === 'open') {
            monitor.start();
        } else {
            monitor.stop();
        }
    });
    return () => {
        unsubscribe();
        monitor.stop();
    };
};

/* An extra measurement for whoever is about to read the value. */
export const pingNow = (): void => {
    if (transport.status === 'open') {
        void monitor.measure();
    }
};
