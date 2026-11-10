import { machineIdOf, type MachineEntry } from '@/machines/machine-list';
import { useMachineEntries } from '@/machines/use-machine-entries';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useWorkspace } from '@/workspace/connections';

export function useOtherMachines(): MachineEntry[] {
    const workspace = useWorkspace();
    const endpoints = useEndpoints((s) => s.endpoints);
    const entries = useMachineEntries();
    const own = workspace === null ? undefined : endpoints.find((endpoint) => endpoint.id === workspace.connection.endpointId);
    return entries.filter((entry) => !isOwn(entry, own));
}

function isOwn(entry: MachineEntry, own: Endpoint | undefined): boolean {
    return entry.endpoint?.id === own?.id || (own !== undefined && entry.id === machineIdOf(own));
}
