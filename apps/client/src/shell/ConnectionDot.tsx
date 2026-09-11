import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Tooltip } from '@/ui/Tooltip';
import { describeConnection, describeMachine, describePing, describeVersion } from '@/shell/connection-info';
import { useConnectedEndpoints, useConnection, useEndpointConnection } from '@/transport/status';
import { pingNow, useLatency } from '@/transport/ping';
import { SLOW_PING_MS } from '@/transport/ping-monitor';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServer } from '@/state/server';
import type { ConnectionState, TransportStatus } from '@/transport';

const COLOR: Record<TransportStatus, string> = {
    open: 'bg-status-idle',
    connecting: 'bg-status-needs-you',
    closed: 'bg-status-error'
};

/* One tick a second while a retry is waiting, which is what makes the countdown count. */
function useCountdown(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return;
        }
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

/* One of the machines this client holds a socket for: whether it is up, and how far away it is. */
function MachineRow({ endpoint }: { endpoint: Endpoint }) {
    const connection = useEndpointConnection(endpoint.id);
    const latency = useLatency(endpoint.id);

    return (
        <span className="flex w-full items-center gap-1.5">
            <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', COLOR[connection.status])} />
            <span className="min-w-0 grow truncate text-text-muted">{endpoint.label}</span>
            <span className="shrink-0 text-text-faint">{describePing(latency)}</span>
        </span>
    );
}

/* The tooltip's body. It only mounts while the tooltip is open, so the extra measurement it asks
   for on mount is one per look, not one per render of the dot. */
function ConnectionDetails({ connection }: { connection: ConnectionState }) {
    const activeId = useEndpoints((s) => s.activeId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const connected = useConnectedEndpoints();
    const latency = useLatency(activeId);
    const endpointLabel = endpoints.find((entry) => entry.id === activeId)?.label ?? 'This machine';
    const machineLabel = useServer((s) => s.label);
    const reachability = useServer((s) => s.reachability);
    const platform = useServer((s) => s.platform);
    const version = useServer((s) => s.version);
    const now = useCountdown(connection.retryAt !== null);

    useEffect(() => {
        pingNow();
    }, []);

    // Every machine with a socket, so "is my other daemon still up" is answerable without opening settings.
    const machines = endpoints.filter((endpoint) => connected.includes(endpoint.id));

    return (
        <span className="flex flex-col items-start gap-0.5">
            <span>{describeConnection(connection, now)}</span>
            <span className="text-text-muted">{describeMachine({ endpointLabel, machineLabel, reachability, platform })}</span>
            <span className="text-text-muted">{describeVersion(version)}</span>
            <span className="text-text-muted">{describePing(latency)}</span>
            {machines.length > 1 && (
                <span className="mt-1 flex w-full flex-col items-start gap-0.5 border-t border-border pt-1">
                    {machines.map((endpoint) => (
                        <MachineRow key={endpoint.id} endpoint={endpoint} />
                    ))}
                </span>
            )}
        </span>
    );
}

export function ConnectionDot() {
    const connection = useConnection();
    const activeId = useEndpoints((s) => s.activeId);
    const latency = useLatency(activeId);
    const slow = connection.status === 'open' && latency !== null && latency > SLOW_PING_MS;

    return (
        <Tooltip label={<ConnectionDetails connection={connection} />}>
            <span
                className="grid h-8 w-5 shrink-0 place-items-center"
                role="status"
                aria-label={`${describeConnection(connection, null)}. ${describePing(latency)}`}
            >
                {/* A ring instead of another color: the state keeps the dot, a slow line only halos it. */}
                <span className={clsx('h-2 w-2 rounded-full', COLOR[connection.status], slow && 'ring-2 ring-status-needs-you/40')} />
            </span>
        </Tooltip>
    );
}
