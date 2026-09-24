import type { ProcessAlert } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { useProcessAlerts } from '@/state/processes';

/* The warnings about one node, for the mark on its header and on its sidebar row. */
export const useNodeAlerts = (nodeId: string): ProcessAlert[] => {
    const alerts = useProcessAlerts(useEndpointId());
    return alerts.filter((alert) => alert.nodeId === nodeId);
};
