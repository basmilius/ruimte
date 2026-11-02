import { useConnection } from '@/transport/status';
import { useLatency } from '@/transport/ping';
import { SLOW_PING_MS } from '@/transport/ping-monitor';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import type { ConnectionState } from '@/transport';

export function isSlowLine(connection: ConnectionState, latency: number | null): boolean {
    return connection.status === 'open' && latency !== null && latency > SLOW_PING_MS;
}

/* The machine this app runs on is up by definition, so the dot only speaks when something is wrong. */
export function useConnectionDotShown(): boolean {
    const connection = useConnection();
    const activeId = useEndpoints((s) => s.activeId);
    const slow = isSlowLine(connection, useLatency(activeId));

    return !(activeId === LOCAL_ENDPOINT_ID && connection.status === 'open' && connection.noLink !== true && !slow);
}
