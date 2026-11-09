import { mergeMachines, type MachineEntry } from '@/machines/machine-list';
import { usePulsarAccount } from '@/pulsar/account';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { usePulsarMachines } from '@/state/pulsar-machines';

/* Every machine this client knows, joined the way the Machines pane joins them: the account's machines count only while someone is signed in. */
export function useMachineEntries(): MachineEntry[] {
    const endpoints = useEndpoints((s) => s.endpoints);
    const status = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    return mergeMachines({ endpoints, accountMachines: status === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() });
}

export function liveMachineEntries(): MachineEntry[] {
    const account = usePulsarAccount.getState().status === 'signed-in' ? usePulsarMachines.getState().machines : null;
    return mergeMachines({ endpoints: useEndpoints.getState().endpoints, accountMachines: account, showLocal: hasLocalMachine() });
}
