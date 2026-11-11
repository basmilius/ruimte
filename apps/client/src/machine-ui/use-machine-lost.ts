import { useSyncExternalStore } from 'react';
import { DropGrace } from '@/machines/drop-grace';
import { machineLost } from '@/machines/machine-lost';
import { useProjectSwitch } from '@/project/open';
import { useEndpointId } from '@/state/current-endpoint';
import { pool } from '@/transport/index';
import { useEndpointConnection } from '@/transport/status';

const dropGrace = new DropGrace({
    connection: (endpointId) => pool.statusOf(endpointId),
    subscribe: (endpointId, onChange) => pool.subscribeStatus(endpointId, onChange)
});

/* Whether one machine's link is down for real, rather than dropped and on its way back (`machineLost`). */
export function useLinkLost(endpointId: string): boolean {
    const connection = useEndpointConnection(endpointId);
    const downPastGrace = useSyncExternalStore(
        (onChange: () => void) => dropGrace.watch(endpointId, onChange),
        () => dropGrace.overdue(endpointId)
    );
    return machineLost(connection, downPastGrace);
}

/* Whether the lost screen stands over the workspace now; a switch has a screen of its own, which says more about the same wait. */
export function useMachineLost(): boolean {
    const lost = useLinkLost(useEndpointId());
    const switching = useProjectSwitch((s) => s.kind !== 'idle');
    return !switching && lost;
}
