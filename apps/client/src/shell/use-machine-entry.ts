import { useMemo } from 'react';
import { usePulsarMachines } from '@/pulsar/machines';
import { mergeMachines, type MachineEntry } from '@/shell/settings/machine-list';
import { useEndpoints } from '@/state/endpoints';

/* A machine as the Machines pane knows it: a paired row, or only the account's record. */
export const useMachineEntry = (endpointId: string): MachineEntry => {
    const endpoints = useEndpoints((s) => s.endpoints);
    const machines = usePulsarMachines((s) => s.machines);
    return useMemo(
        () =>
            mergeMachines({ endpoints, accountMachines: machines, showLocal: true }).find(
                (entry) => entry.id === endpointId || entry.endpoint?.id === endpointId
            ) ?? {
                id: endpointId,
                endpoint: null,
                machine: null,
                local: false,
                paired: false,
                onAccount: false
            },
        [endpointId, endpoints, machines]
    );
};
