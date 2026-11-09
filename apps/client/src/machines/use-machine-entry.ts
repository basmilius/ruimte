import { mergeMachines, type MachineEntry } from '@/machines/machine-list';
import { useEndpoints } from '@/state/endpoints';
import { usePulsarMachines } from '@/state/pulsar-machines';

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
