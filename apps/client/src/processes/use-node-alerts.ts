import type { ProcessAlert } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { useProcessAlerts } from '@/state/processes';

export const useNodeAlerts = (nodeId: string): ProcessAlert[] => {
    const alerts = useProcessAlerts(useEndpointId());
    return alerts.filter((alert) => alert.nodeId === nodeId);
};
