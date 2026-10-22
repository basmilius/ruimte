import { useProjectSwitch } from '@/project/open';
import { machineLost } from '@/shell/machine-lost';
import { useEndpointId } from '@/state/keys';
import { useEndpointConnection } from '@/transport/status';

/* Whether the lost screen stands over the workspace now; a switch has a screen of its own, which says more about the same wait. */
export function useMachineLost(): boolean {
    const connection = useEndpointConnection(useEndpointId());
    const switching = useProjectSwitch((s) => s.kind !== 'idle');
    return !switching && machineLost(connection);
}
