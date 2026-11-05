import { useEndpoints } from '@/state/endpoints';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { mergeMachines, type MachineEntry } from '@/surface/settings/machine-list';

/* A machine as the Machines pane knows it: a row of this client, or only the account's record. */
export function useMachineEntry(endpointId: string): MachineEntry {
    const endpoints = useEndpoints((s) => s.endpoints);
    const machines = usePulsarMachines((s) => s.machines);
    return (
        mergeMachines({ endpoints, accountMachines: machines, showLocal: true }).find(
            (entry) => entry.id === endpointId || entry.endpoint?.id === endpointId
        ) ?? {
            id: endpointId,
            endpoint: null,
            machine: null,
            local: false,
            onAccount: false
        }
    );
}
