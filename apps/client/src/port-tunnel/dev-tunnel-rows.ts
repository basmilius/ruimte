import type { TunnelRow } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { transportFor } from '@/transport';
import { fireAndForget } from '@/transport-api/transport';
import { useEndpointConnection } from '@/transport/status';

/*
 * The dev server hostnames of the machine's tunnels (RP-114), so a port that has one can hand out its public address.
 * A hostname is its own choice and makes no grant, and a grant makes no hostname; this only reads the rows.
 */
export function useDevTunnelRows(endpointId: string, enabled: boolean): readonly TunnelRow[] {
    const connection = useEndpointConnection(endpointId);
    const answers = connection.features?.includes('tunnel.state') ?? false;
    const [rows, setRows] = useState<readonly TunnelRow[]>([]);

    useEffect(() => {
        if (!enabled || connection.status !== 'open' || !answers) {
            return;
        }

        const load = (): void => {
            void fireAndForget(
                'tunnel.state',
                transportFor(endpointId)
                    ?.request('tunnel.state', {})
                    .then((state) => setRows(state.rows.filter((row) => row.kind === 'dev')))
            );
        };

        load();

        return transportFor(endpointId)?.on('tunnel.changed', load);
    }, [enabled, connection.status, answers, endpointId]);

    return rows;
}

/* The address a visitor outside Ruimte uses for the port, or null while no running hostname points at it. */
export function publicAddressOf(rows: readonly TunnelRow[], port: number): string | null {
    const row = rows.find((entry) => entry.port === port && entry.enabled);

    return row === undefined ? null : `https://${row.hostname}`;
}
